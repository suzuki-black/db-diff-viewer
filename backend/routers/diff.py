"""
差分比較 API
"""
import logging
import traceback
import threading
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from database import get_db
from models import Connection
from schemas import (
    RecordDiffJobRequest, RecordDiffJobStatus,
    RecordDiffMeta, RecordDiffPageResponse,
    RecordDiffRequest, RecordDiffResult,
    SchemaDiffRequest, SchemaDiffResult,
    TableDiffRequest, TableDiffResult,
)
from services.diff_engine import (
    compute_record_diff, compute_schema_diff, compute_table_diff,
)
from services.diff_jobs import (
    cancel_job, cleanup_old_jobs, create_job, get_job, start_record_diff_job,
)
from services.db_client import (
    count_records, fetch_records,
    get_all_column_definitions, get_column_definitions, get_index_definitions,
    get_primary_keys, get_table_names,
    get_table_row_counts,
)

router = APIRouter()

# 定期クリーンアップ（初回呼び出し時に旧ジョブを削除）
_cleanup_done = False
_cleanup_lock = threading.Lock()


def _lazy_cleanup() -> None:
    global _cleanup_done
    with _cleanup_lock:
        if not _cleanup_done:
            cleanup_old_jobs()
            _cleanup_done = True


def _get_connections(db: Session, left_id: int, right_id: int) -> tuple[Connection, Connection]:
    left = db.get(Connection, left_id)
    right = db.get(Connection, right_id)
    if left is None:
        raise HTTPException(status_code=404, detail=f"左DBの接続設定 ID={left_id} が見つかりません")
    if right is None:
        raise HTTPException(status_code=404, detail=f"右DBの接続設定 ID={right_id} が見つかりません")
    return left, right


@router.post("/tables", response_model=TableDiffResult)
def get_table_diff(body: TableDiffRequest, db: Session = Depends(get_db)):
    """テーブル一覧差分を取得する"""
    left_conn, right_conn = _get_connections(db, body.left_connection_id, body.right_connection_id)

    try:
        left_tables = get_table_names(left_conn)
        right_tables = get_table_names(right_conn)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"DB接続エラー: {e}") from e

    all_tables = list(set(left_tables) | set(right_tables))
    common = sorted(set(left_tables) & set(right_tables))

    # SSH接続の場合、テーブルごとにトンネルを開くと n 本の接続が発生してタイムアウトする。
    # 1回の接続で全テーブルのカラム定義をまとめて取得する。
    try:
        left_col_defs = get_all_column_definitions(left_conn, common)
        right_col_defs = get_all_column_definitions(right_conn, common)
    except Exception as e:
        logger.error("カラム定義取得エラー詳細:\n%s", traceback.format_exc())
        raise HTTPException(status_code=502, detail=f"カラム定義取得エラー: {e}") from e

    # テーブルのレコード数を information_schema から一括取得（近似値・高速）
    try:
        left_counts = get_table_row_counts(left_conn, [t for t in all_tables if t in set(left_tables)])
        right_counts = get_table_row_counts(right_conn, [t for t in all_tables if t in set(right_tables)])
    except Exception:
        # レコード数取得に失敗しても差分比較は継続する
        left_counts = {}
        right_counts = {}

    return compute_table_diff(left_tables, right_tables, left_col_defs, right_col_defs, left_counts, right_counts)


@router.post("/records", response_model=RecordDiffResult)
def get_record_diff(body: RecordDiffRequest, db: Session = Depends(get_db)):
    """レコード差分を取得する（小規模向け同期API）"""
    left_conn, right_conn = _get_connections(db, body.left_connection_id, body.right_connection_id)

    try:
        primary_keys = body.primary_keys or get_primary_keys(left_conn, body.table_name)
        if not primary_keys:
            cols_info = get_column_definitions(left_conn, body.table_name)
            primary_keys = [c["COLUMN_NAME"] for c in cols_info[:1]]
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"主キー取得エラー: {e}") from e

    try:
        total_left = count_records(left_conn, body.table_name)
        total_right = count_records(right_conn, body.table_name)
        left_cols, left_records = fetch_records(
            left_conn, body.table_name, primary_keys, body.offset, body.limit
        )
        right_cols, right_records = fetch_records(
            right_conn, body.table_name, primary_keys, body.offset, body.limit
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"レコード取得エラー: {e}") from e

    columns = left_cols or right_cols
    return compute_record_diff(
        columns, left_records, right_records, primary_keys, total_left, total_right
    )


# ============================================================
# バックグラウンドジョブ API
# ============================================================

@router.post("/records/jobs", response_model=RecordDiffJobStatus, status_code=202)
def start_job(body: RecordDiffJobRequest, db: Session = Depends(get_db)):
    """レコード差分計算ジョブを開始する（非同期・大規模向け）"""
    _lazy_cleanup()
    left_conn, right_conn = _get_connections(db, body.left_connection_id, body.right_connection_id)

    # どちらのDBにテーブルが存在するか確認
    try:
        left_tables = get_table_names(left_conn)
        right_tables = get_table_names(right_conn)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"テーブル一覧取得エラー: {e}") from e

    table_exists_left = body.table_name in left_tables
    table_exists_right = body.table_name in right_tables

    if not table_exists_left and not table_exists_right:
        raise HTTPException(
            status_code=404,
            detail=f"テーブル '{body.table_name}' は左右どちらのDBにも存在しません",
        )

    # 主キーはテーブルが存在する側から取得
    try:
        if body.primary_keys:
            primary_keys = body.primary_keys
        elif table_exists_left:
            primary_keys = get_primary_keys(left_conn, body.table_name)
            if not primary_keys:
                cols_info = get_column_definitions(left_conn, body.table_name)
                primary_keys = [c["COLUMN_NAME"] for c in cols_info[:1]]
        else:
            primary_keys = get_primary_keys(right_conn, body.table_name)
            if not primary_keys:
                cols_info = get_column_definitions(right_conn, body.table_name)
                primary_keys = [c["COLUMN_NAME"] for c in cols_info[:1]]
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"主キー取得エラー: {e}") from e

    job = create_job()
    start_record_diff_job(
        job=job,
        left_conn=left_conn,
        right_conn=right_conn,
        table_name=body.table_name,
        primary_keys=primary_keys,
        algorithm=body.algorithm,
        batch_size=body.batch_size,
        table_exists_left=table_exists_left,
        table_exists_right=table_exists_right,
    )

    return RecordDiffJobStatus(
        job_id=job.job_id,
        status=job.status,
        phase=job.phase,
        table_exists_left=table_exists_left,
        table_exists_right=table_exists_right,
    )


@router.get("/records/jobs/{job_id}", response_model=RecordDiffJobStatus)
def get_job_status(job_id: str):
    """ジョブの進捗・メタ情報を取得する（ポーリング用）。レコード本体は /result エンドポイントで取得。"""
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"ジョブ ID={job_id} が見つかりません")

    result_meta: RecordDiffMeta | None = None
    if job.result is not None:
        r = job.result
        result_meta = RecordDiffMeta(
            columns=r.columns,
            total_left=r.total_left,
            total_right=r.total_right,
            summary=r.summary,
            is_partial=r.is_partial,
            partial_note=r.partial_note,
        )

    return RecordDiffJobStatus(
        job_id=job.job_id,
        status=job.status,
        phase=job.phase,
        left_progress=job.left_progress,
        left_total=job.left_total,
        right_progress=job.right_progress,
        right_total=job.right_total,
        compute_progress=job.compute_progress,
        compute_total=job.compute_total,
        finalize_progress=job.finalize_progress,
        finalize_total=job.finalize_total,
        result_meta=result_meta,
        error=job.error,
        table_exists_left=job.table_exists_left,
        table_exists_right=job.table_exists_right,
    )


@router.get("/records/jobs/{job_id}/result", response_model=RecordDiffPageResponse)
def get_job_result_page(
    job_id: str,
    offset: int = 0,
    limit: int = 200,
    statuses: str = "modified,added,deleted,equal",
):
    """差分レコードをページネーションで取得する。
    statuses: カンマ区切りで取得するステータス（例: modified,added,deleted,equal）

    equal レコードは set_based ストリーミング時は SQLite ファイル（equal_store）から、
    legacy アルゴリズム時は status_index から返す。
    順序: modified → added → deleted → equal（equal は常に末尾）
    """
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"ジョブ ID={job_id} が見つかりません")
    if job.status not in ("done", "cancelled"):
        raise HTTPException(status_code=409, detail=f"ジョブはまだ完了していません (status={job.status})")
    if job.result is None:
        raise HTTPException(status_code=404, detail="ジョブ結果がありません")

    # ステータスフィルタ解析（順序固定: modified, added, deleted, equal）
    requested = {s.strip() for s in statuses.split(",") if s.strip()}
    order = ["modified", "added", "deleted"]
    include_equal = "equal" in requested

    # ── RAM 上の非 equal レコードリスト ──────────────────────
    # legacy アルゴリズムで equal が status_index にある場合もここに含める
    use_equal_store = include_equal and job.equal_store is not None
    non_equal_list: list = []
    for s in order:
        if s in requested:
            non_equal_list.extend(job.status_index.get(s, []))
    if include_equal and not use_equal_store:
        # legacy: equal も status_index 経由（RAM）
        non_equal_list.extend(job.status_index.get("equal", []))

    ne_total = len(non_equal_list)
    eq_total = job.equal_store.count() if use_equal_store else 0
    total = ne_total + eq_total

    if offset >= total:
        return RecordDiffPageResponse(
            records=[], offset=offset, limit=limit, total=total,
            columns=job.result.columns,
        )

    end = min(offset + limit, total)

    # ── ページ範囲の振り分け ──────────────────────────────────
    if end <= ne_total:
        # 全て RAM から（非 equal のみ）
        page_records = non_equal_list[offset:end]

    elif offset >= ne_total:
        # 全て SQLite から（equal のみ）
        eq_offset = offset - ne_total
        eq_limit = end - offset
        page_records = job.equal_store.read_page(eq_offset, eq_limit)  # type: ignore[union-attr]

    else:
        # RAM と SQLite の境界をまたぐ
        from_ram = non_equal_list[offset:ne_total]
        eq_limit = end - ne_total
        from_sqlite = job.equal_store.read_page(0, eq_limit) if job.equal_store else []  # type: ignore[union-attr]
        page_records = from_ram + from_sqlite

    return RecordDiffPageResponse(
        records=page_records,
        offset=offset,
        limit=limit,
        total=total,
        columns=job.result.columns,
    )


@router.delete("/records/jobs/{job_id}", status_code=204)
def cancel_job_endpoint(job_id: str):
    """ジョブをキャンセルする（取得済み部分で部分差分を返す）"""
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"ジョブ ID={job_id} が見つかりません")
    cancel_job(job_id)


@router.post("/debug/log")
async def frontend_debug_log(request: Request):
    """フロントエンドからのデバッグログを受け取り uvicorn ログに出力する。
    ブラウザがクラッシュしても Docker ログに残るため根本原因調査に使う。"""
    try:
        body = await request.json()
    except Exception:
        return {"ok": False, "error": "invalid json"}
    event = body.get("event", "?")
    logger.warning("[FE_DEBUG] event=%s | %s", event, body)
    return {"ok": True}


@router.post("/schema", response_model=SchemaDiffResult)
def get_schema_diff(body: SchemaDiffRequest, db: Session = Depends(get_db)):
    """テーブル構造（カラム定義・インデックス）差分を取得する"""
    left_conn, right_conn = _get_connections(db, body.left_connection_id, body.right_connection_id)

    try:
        left_cols = get_column_definitions(left_conn, body.table_name)
        right_cols = get_column_definitions(right_conn, body.table_name)
        left_indexes = get_index_definitions(left_conn, body.table_name)
        right_indexes = get_index_definitions(right_conn, body.table_name)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"スキーマ取得エラー: {e}") from e

    return compute_schema_diff(left_cols, right_cols, left_indexes, right_indexes)
