"""
レコード差分ジョブ管理
バックグラウンドスレッドでレコード差分計算を実行し、進捗を管理する

【メモリ最適化】set_based アルゴリズムにストリーミング差分計算を採用。
従来は左右のレコードを全件メモリに展開（10M行 × 2 = 20GB超）していたが、
新実装では：
  1. 左DBをストリーミングしながら left_map（pk → 直列化済み値）を構築
  2. 右DBをストリーミングしながら left_map.pop() で突き合わせ
  3. equal レコードは RecordDiffItem を生成せず、ディスク上の SQLite に逐次書き出し
     （EqualRecordStore）→ RAM 消費を増やさず値も保持できる
  4. left_map の残存エントリが削除レコード
ピークメモリ: ~20GB → ~3-4GB に削減（equal の値もディスク経由で参照可能）
"""
import gc
import json
import logging
import os
import sqlite3
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

from models import Connection
from schemas import DiffAlgorithm, DiffSummaryStats, RecordDiffItem, RecordDiffResult
from services.diff_engine import compute_record_diff_with_algorithm
from services.db_client import (
    count_records, fetch_all_records,
    get_column_definitions, get_primary_keys,
    stream_records,
)
from utils.json_logger import JobTimer, get_logger

logger = get_logger(__name__)

# ストリーミング処理のバッチサイズ（OFFSETページネーションより大きくしてDB往復回数を減らす）
_STREAM_BATCH = 5000


# ============================================================
# equal レコード用ディスクバックドストア
# ============================================================

class EqualRecordStore:
    """
    equal レコードをディスク上の SQLite 一時ファイルに逐次書き出すクラス。

    8M+ 件の equal レコードを Python オブジェクトとして RAM に保持せず
    ディスクに書き出すことでピークメモリを抑制しつつ、値の参照も可能にする。

    スレッド安全性:
      - write() / finalize() はジョブスレッド（シングルライタ）から呼ぶ
      - read_page() は API スレッドから都度新コネクションで読む（WAL モードで共存可）
      - cleanup() はクリーンアップスレッドから呼ぶ（ファイル削除のみ）
    """

    _WRITE_BATCH = 2_000   # executemany のバッファサイズ
    # flush が遅い場合にログ警告するしきい値（秒）
    _SLOW_FLUSH_WARN_S = 1.0

    def __init__(self) -> None:
        fd, self._path = tempfile.mkstemp(suffix=".db", prefix="diffequal_")
        os.close(fd)
        self._wconn = sqlite3.connect(self._path)
        self._wconn.execute("PRAGMA page_size=4096")
        self._wconn.execute("PRAGMA journal_mode=WAL")
        self._wconn.execute("PRAGMA synchronous=NORMAL")
        # WAL 自動チェックポイントを無効化（明示的な close() でもチェックポイントが
        # 走らないよう設定。ファイルは cleanup() で直接削除するため不要）
        self._wconn.execute("PRAGMA wal_autocheckpoint=0")
        self._wconn.execute(
            "CREATE TABLE eq (pk TEXT NOT NULL, vals TEXT NOT NULL)"
        )
        self._wconn.commit()
        self._buf: list[tuple[str, str]] = []
        self._count = 0
        self._flush_count = 0
        self._total_flush_s = 0.0
        self._eq_logger = get_logger(f"{__name__}.EqualRecordStore")

    # ── 書き込み ─────────────────────────────────────────────

    def write(self, pk: str, vals: dict) -> None:
        """equal レコードを1件書き出す（内部バッファリングあり）"""
        self._buf.append((pk, json.dumps(vals, ensure_ascii=False)))
        self._count += 1
        if len(self._buf) >= self._WRITE_BATCH:
            self._flush()

    def _flush(self) -> None:
        if self._buf:
            t0 = time.perf_counter()
            self._wconn.executemany("INSERT INTO eq VALUES (?,?)", self._buf)
            self._wconn.commit()
            elapsed = time.perf_counter() - t0
            self._flush_count += 1
            self._total_flush_s += elapsed
            self._buf.clear()
            # 遅いフラッシュは警告ログ（ディスク I/O 問題の検出用）
            if elapsed >= self._SLOW_FLUSH_WARN_S:
                self._eq_logger.warning(
                    "slow_equal_flush",
                    extra={
                        "elapsed_s":    round(elapsed, 3),
                        "flush_count":  self._flush_count,
                        "total_count":  self._count,
                        "db_path":      self._path,
                    },
                )

    def finalize(self) -> None:
        """書き込みを完了する。

        バッファをフラッシュして全データをコミットする。
        コネクションは意図的にクローズしない。

        【理由】SQLite WAL モードでは「最後のコネクションが close() されると
        WAL ファイル全体をメイン DB にチェックポイント（書き戻し）する」仕様がある。
        5.4M 件規模では WAL が数百 MB に達し、このチェックポイントが GIL を保持
        したまま数十秒以上ブロックする。
        一時ファイルは cleanup() で直接削除するためチェックポイントは不要。
        また wal_autocheckpoint=0 を設定済みなので自動チェックポイントも発生しない。
        """
        self._flush()
        # self._wconn は意図的にクローズしない（WAL チェックポイント回避）
        try:
            db_size = os.path.getsize(self._path)
            wal_size = 0
            wal_path = self._path + "-wal"
            if os.path.exists(wal_path):
                wal_size = os.path.getsize(wal_path)
        except OSError:
            db_size = wal_size = -1
        self._eq_logger.info(
            "equal_store_finalized",
            extra={
                "total_count":    self._count,
                "flush_count":    self._flush_count,
                "total_flush_s":  round(self._total_flush_s, 3),
                "avg_flush_ms":   round(self._total_flush_s / max(1, self._flush_count) * 1000, 1),
                "db_size_mb":     round(db_size / 1024 / 1024, 2),
                "wal_size_mb":    round(wal_size / 1024 / 1024, 2),
                "db_path":        self._path,
            },
        )

    # ── 読み込み ─────────────────────────────────────────────

    def read_page(self, offset: int, limit: int) -> "list[RecordDiffItem]":
        """指定範囲の equal レコードを RecordDiffItem リストとして返す。

        【パフォーマンス最適化】
        SQLite の LIMIT ? OFFSET N は O(N) のフルスキャンとなり、大きなオフセット
        （例: OFFSET 479800）では数秒かかってブラウザを固まらせる。
        append-only テーブルは rowid が連番（1, 2, 3, ...）になるため
        「WHERE rowid > offset LIMIT limit」で O(log N) の B-tree インデックスルックアップに
        置き換えられる。
        """
        conn = sqlite3.connect(self._path)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            # rowid ベースのキーセットページネーション（O(log N)）
            # append-only テーブルなので rowid = 1-indexed row position が保証される。
            # WHERE rowid > offset → 0-indexed 位置 offset 以降の行を返す。
            rows = conn.execute(
                "SELECT pk, vals FROM eq WHERE rowid > ? ORDER BY rowid LIMIT ?",
                (offset, limit),
            ).fetchall()
        finally:
            conn.close()
        result = []
        for pk, vals_json in rows:
            vals = json.loads(vals_json)
            result.append(RecordDiffItem(
                status="equal",
                primary_key_value=pk,
                left_values=vals,
                right_values=vals,
                diff_columns=[],
            ))
        return result

    def count(self) -> int:
        return self._count

    # ── クリーンアップ ────────────────────────────────────────

    def cleanup(self) -> None:
        """一時 SQLite ファイルおよび WAL/SHM ファイルを削除する。

        コネクションをクローズせずに直接ファイルを削除する。
        Linux ではオープン中のファイルを削除してもファイルディスクリプタは
        有効なため問題ない（inode の参照カウントが 0 になった時点で解放）。
        WAL ファイル（-wal）と共有メモリファイル（-shm）も合わせて削除する。
        """
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(self._path + suffix)
            except Exception:
                pass


# ============================================================
# ジョブデータクラス
# ============================================================

@dataclass
class DiffJob:
    job_id: str
    created_at: datetime = field(default_factory=datetime.now)
    status: str = "pending"   # pending, running, done, cancelled, error
    phase: str = "pending"    # pending, counting, fetching_left, computing, done, cancelled, error
    left_progress: int = 0
    left_total: int = 0
    right_progress: int = 0
    right_total: int = 0
    compute_progress: int = 0
    compute_total: int = 0
    result: Optional[RecordDiffResult] = None
    # ステータス別インデックス（ページネーション高速化）
    status_index: dict = field(default_factory=dict)
    # equal レコードのディスクバックドストア（set_based ストリーミング時のみ使用）
    equal_store: Optional[EqualRecordStore] = field(default=None)
    # finalizing フェーズ進捗（インデックス構築）
    finalize_progress: int = 0
    finalize_total: int = 0
    error: Optional[str] = None
    cancel_requested: bool = False
    table_exists_left: bool = True   # 左DBにテーブルが存在するか
    table_exists_right: bool = True  # 右DBにテーブルが存在するか


# ============================================================
# ジョブストア（インメモリ）
# ============================================================

_jobs: dict[str, DiffJob] = {}
_jobs_lock = threading.Lock()


def create_job() -> DiffJob:
    job = DiffJob(job_id=str(uuid.uuid4()))
    with _jobs_lock:
        _jobs[job.job_id] = job
    return job


def get_job(job_id: str) -> Optional[DiffJob]:
    with _jobs_lock:
        return _jobs.get(job_id)


def cancel_job(job_id: str) -> bool:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job and job.status in ("pending", "running"):
            job.cancel_requested = True
            return True
    return False


def cleanup_old_jobs() -> None:
    """1時間以上前のジョブを削除する（equal_store の一時ファイルも削除）"""
    cutoff = datetime.now().timestamp() - 3600
    with _jobs_lock:
        to_remove = [
            jid for jid, j in _jobs.items()
            if j.created_at.timestamp() < cutoff
        ]
        for jid in to_remove:
            job = _jobs[jid]
            if job.equal_store is not None:
                job.equal_store.cleanup()
            del _jobs[jid]


# ============================================================
# 直列化ヘルパー
# ============================================================

def _serialize_val(v: Any) -> Any:
    """MySQL 値を JSON シリアライズ可能な文字列に変換する"""
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)


def _serialize_row(row: dict[str, Any]) -> dict[str, Any]:
    return {k: _serialize_val(v) for k, v in row.items()}


def _pk_str(row: dict[str, Any], primary_keys: list[str]) -> str:
    return "||".join(str(row.get(k, "")) for k in primary_keys)


# ============================================================
# ジョブ実行（バックグラウンドスレッド）
# ============================================================

def start_record_diff_job(
    job: DiffJob,
    left_conn: Connection,
    right_conn: Connection,
    table_name: str,
    primary_keys: list[str],
    algorithm: DiffAlgorithm,
    batch_size: int,
    table_exists_left: bool = True,
    table_exists_right: bool = True,
) -> None:
    """バックグラウンドスレッドでジョブを開始する"""
    job.table_exists_left = table_exists_left
    job.table_exists_right = table_exists_right
    thread = threading.Thread(
        target=_run_job,
        args=(job, left_conn, right_conn, table_name, primary_keys, algorithm, batch_size,
              table_exists_left, table_exists_right),
        daemon=True,
        name=f"diff-job-{job.job_id[:8]}",
    )
    thread.start()


def _run_job(
    job: DiffJob,
    left_conn: Connection,
    right_conn: Connection,
    table_name: str,
    primary_keys: list[str],
    algorithm: DiffAlgorithm,
    batch_size: int,
    table_exists_left: bool = True,
    table_exists_right: bool = True,
) -> None:
    timer = JobTimer(logger, job.job_id)
    timer.info(
        "job_start",
        table=table_name,
        algorithm=algorithm,
        primary_keys=primary_keys,
        table_exists_left=table_exists_left,
        table_exists_right=table_exists_right,
    )
    try:
        job.status = "running"

        # ── Phase 1: レコード数カウント ─────────────────────
        timer.phase("counting")
        job.phase = "counting"
        job.left_total  = count_records(left_conn, table_name) if table_exists_left else 0
        job.right_total = count_records(right_conn, table_name) if table_exists_right else 0
        timer.info("count_done", left_total=job.left_total, right_total=job.right_total)

        if job.cancel_requested:
            timer.warn("cancelled_after_count")
            _finish_streaming_cancelled(job, [], {}, 0, 0, "カウント完了前にキャンセルされました")
            return

        # set_based のみストリーミング実装を使用
        # （他のアルゴリズムは一括取得が必要なため従来実装を維持）
        if algorithm == "set_based":
            _run_streaming_set_based(
                job, left_conn, right_conn, table_name, primary_keys, timer,
                table_exists_left, table_exists_right,
            )
        else:
            _run_legacy(
                job, left_conn, right_conn, table_name, primary_keys, algorithm, batch_size,
                table_exists_left, table_exists_right,
            )

    except Exception as exc:
        logger.exception(
            "job_error",
            extra={
                "job_id": job.job_id,
                "phase":  job.phase,
                "error":  str(exc),
                "elapsed_total_s": timer._elapsed_total(),
            },
        )
        job.status = "error"
        job.phase = "error"
        job.error = str(exc)


# ============================================================
# ストリーミング差分計算（set_based アルゴリズム）
# ============================================================

def _run_streaming_set_based(
    job: DiffJob,
    left_conn: Connection,
    right_conn: Connection,
    table_name: str,
    primary_keys: list[str],
    timer: JobTimer,
    table_exists_left: bool = True,
    table_exists_right: bool = True,
) -> None:
    """
    set_based アルゴリズムのストリーミング実装。

    左DBを1件ずつ読み込みながら left_map を構築したあと、
    右DBをストリーミングしながら left_map.pop() で突き合わせることで、
    右レコードを全件メモリに展開することを回避する。
    equal レコードは RecordDiffItem を生成せず件数のみカウントするため
    メモリ使用量をさらに削減する。
    片側にテーブルが存在しない場合はそちらを空として扱い、
    存在する側のレコードをすべて added/deleted として返す。
    """
    columns: list[str] = []

    # ── Phase 2: 左DB → left_map 構築（ストリーミング）──────
    timer.phase("fetching_left")
    job.phase = "fetching_left"
    # pk_str → 直列化済み値dict を保持。raw dict は直接は不要なので変換後に破棄
    left_map: dict[str, dict[str, Any]] = {}
    left_batch_count = 0

    if table_exists_left:
        for batch_cols, batch_rows in stream_records(left_conn, table_name, primary_keys, _STREAM_BATCH):
            if job.cancel_requested:
                timer.warn("cancelled_fetching_left", left_map_size=len(left_map))
                _finish_streaming_cancelled(
                    job, columns or batch_cols, left_map, 0,
                    job.left_total, "左DB取得中にキャンセルされました",
                )
                return
            if not columns:
                columns = batch_cols
            for row in batch_rows:
                pk = _pk_str(row, primary_keys)
                left_map[pk] = _serialize_row(row)
            job.left_progress = len(left_map)
            left_batch_count += 1
            # 100バッチ（= 500k件）ごとにログ
            if left_batch_count % 100 == 0:
                timer.info(
                    "fetching_left_progress",
                    left_map_size=len(left_map),
                    batches=left_batch_count,
                )
    else:
        # 左DBにテーブルが存在しない場合: 右DBからカラム定義のみ取得する
        timer.info("fetching_left_skipped_table_missing")
        if table_exists_right:
            try:
                col_defs = get_column_definitions(right_conn, table_name)
                columns = [c["COLUMN_NAME"] for c in col_defs]
            except Exception:
                pass  # カラム取得失敗時は右ストリーミング中に自動補完される

    timer.info(
        "fetching_left_done",
        left_map_size=len(left_map),
        columns=len(columns),
        total_batches=left_batch_count,
    )

    # ── Phase 3+4: 右DBストリーミング + 差分計算（同時進行）─
    # 左右のフェッチと差分計算を1フェーズにまとめることで
    # 右レコードのリストをメモリに展開しない。
    # ステータス別バケットをストリーミング中に直接構築することで
    # 後段の O(n) finalizing ループを不要にし、done への遷移を高速化する。
    timer.phase("computing", left_map_size=len(left_map))
    job.phase = "computing"
    job.compute_total = job.left_total + job.right_total

    # ステータス別に直接バケット構築（status_index 兼用）
    modified_list: list[RecordDiffItem] = []
    added_list:    list[RecordDiffItem] = []
    # equal レコードはディスク上の SQLite に書き出す（RAM 非消費・値も保持）
    equal_store = EqualRecordStore()
    job.equal_store = equal_store  # エラー時もクリーンアップできるよう早期にセット
    right_consumed = 0
    right_batch_count = 0
    _LOG_INTERVAL = 100  # 100バッチ（=500k件）ごとにログ

    right_iter = (
        stream_records(right_conn, table_name, primary_keys, _STREAM_BATCH)
        if table_exists_right
        else iter([])  # 右DBにテーブルが存在しない場合: 空イテレータ
    )

    for batch_cols, batch_rows in right_iter:
        if job.cancel_requested:
            # 取得済み分で部分結果を確定する
            equal_store.finalize()
            timer.warn(
                "cancelled_computing",
                right_consumed=right_consumed,
                modified=len(modified_list),
                added=len(added_list),
                equal=equal_store.count(),
                left_map_remaining=len(left_map),
            )
            _finish_streaming_partial(
                job, columns, left_map, modified_list, added_list, equal_store,
                job.left_total, job.right_total,
                f"右DB処理中にキャンセルされました（右: {right_consumed}/{job.right_total}件処理済）",
            )
            return

        if not columns:
            columns = batch_cols

        for row in batch_rows:
            pk = _pk_str(row, primary_keys)
            right_vals = _serialize_row(row)
            right_consumed += 1

            if pk in left_map:
                left_vals = left_map.pop(pk)  # マッチ済みエントリを除去（削除判定に利用）
                diff_cols = [col for col in columns if left_vals.get(col) != right_vals.get(col)]
                if diff_cols:
                    modified_list.append(RecordDiffItem(
                        status="modified",
                        primary_key_value=pk,
                        left_values=left_vals,
                        right_values=right_vals,
                        diff_columns=diff_cols,
                    ))
                else:
                    # equal: 値をディスクに書き出し（RAM には保持しない）
                    equal_store.write(pk, left_vals)
            else:
                # 右DBにのみ存在 → added
                added_list.append(RecordDiffItem(
                    status="added",
                    primary_key_value=pk,
                    left_values=None,
                    right_values=right_vals,
                    diff_columns=columns,
                ))

        # 進捗更新（処理済みの左右合計で計算）
        job.right_progress = right_consumed
        job.compute_progress = job.left_progress + right_consumed
        right_batch_count += 1

        # 定期ログ（100バッチ = 500k 件ごと）
        if right_batch_count % _LOG_INTERVAL == 0:
            timer.info(
                "computing_progress",
                right_consumed=right_consumed,
                right_total=job.right_total,
                modified=len(modified_list),
                added=len(added_list),
                equal=equal_store.count(),
                left_map_remaining=len(left_map),
                batches=right_batch_count,
            )

    timer.info(
        "computing_stream_done",
        right_consumed=right_consumed,
        right_total=job.right_total,
        total_right_batches=right_batch_count,
        modified=len(modified_list),
        added=len(added_list),
        equal=equal_store.count(),
        left_map_remaining=len(left_map),
    )

    # ── Phase 5: finalizing ──────────────────────────────────
    # ストリーミング完了。即座に finalizing フェーズへ移行。
    # ステータス別バケットはストリーミング中に構築済み。
    # ここでは deleted_list 構築（left_map 残存分）と equal_store フラッシュのみ。
    timer.phase(
        "finalizing",
        left_map_remaining=len(left_map),
        modified=len(modified_list),
        added=len(added_list),
        equal=equal_store.count(),
    )
    job.phase = "finalizing"
    job.finalize_total    = max(1, len(left_map))
    job.finalize_progress = 0

    # left_map の残存エントリ = 右DBに存在しない → deleted
    # 大量の deleted がある場合に備え、50k ごとに GIL を手放してイベントループを生かす
    deleted_list: list[RecordDiffItem] = []
    _deleted_build_start = time.perf_counter()
    for i, (pk, left_vals) in enumerate(left_map.items()):
        deleted_list.append(RecordDiffItem(
            status="deleted",
            primary_key_value=pk,
            left_values=left_vals,
            right_values=None,
            diff_columns=columns,
        ))
        if i % 50_000 == 0 and i > 0:
            job.finalize_progress = i
            time.sleep(0)  # GIL を手放してイベントループがリクエストを処理できるようにする

    timer.info(
        "deleted_list_built",
        deleted_count=len(deleted_list),
        elapsed_s=round(time.perf_counter() - _deleted_build_start, 4),
    )

    with timer.timed("del_left_map", left_map_size_before_del=len(left_map)):
        del left_map          # メモリ解放（参照カウント方式のため即時解放）

    with timer.timed(
        "equal_store_finalize",
        equal_count=equal_store.count(),
        buf_remaining=len(equal_store._buf),
    ):
        equal_store.finalize()  # バッファフラッシュのみ（コネクションは閉じない → WAL checkpoint 回避）

    eq_count = equal_store.count()
    modified_count = len(modified_list)
    added_count    = len(added_list)
    deleted_count  = len(deleted_list)
    non_equal_total = modified_count + added_count + deleted_count

    # 0/0 を防ぐため最低 1 にする（完全一致テーブルでも 100% 表示）
    job.finalize_total    = max(1, non_equal_total)
    job.finalize_progress = max(1, non_equal_total)  # 即時完了

    timer.info(
        "finalizing_counts",
        modified=modified_count,
        added=added_count,
        deleted=deleted_count,
        equal=eq_count,
        total=non_equal_total + eq_count,
    )

    summary = DiffSummaryStats(
        total=non_equal_total + eq_count,
        equal=eq_count,
        added=added_count,
        deleted=deleted_count,
        modified=modified_count,
    )
    result = RecordDiffResult(
        columns=columns,
        records=[],   # レコード本体はページネーション API で提供（status_index 経由）
        total_left=job.left_total,
        total_right=job.right_total,
        summary=summary,
    )
    job.result = result
    job.status_index = {
        "modified": modified_list,
        "added":    added_list,
        "deleted":  deleted_list,
        "equal":    [],
    }

    job.phase = "done"
    job.status = "done"
    timer.phase("done")
    timer.info("job_complete", total_records=non_equal_total + eq_count)


def _finish_streaming_partial(
    job: DiffJob,
    columns: list[str],
    remaining_left_map: dict[str, dict],
    modified_list: list[RecordDiffItem],
    added_list: list[RecordDiffItem],
    equal_store: EqualRecordStore,  # finalize() は呼び出し元で実施済み
    total_left: int,
    total_right: int,
    note: str,
) -> None:
    """ストリーミング中のキャンセル時に、取得済み分で部分的な差分を確定する"""
    # 未処理の left_map エントリはすべて deleted として扱う
    deleted_list: list[RecordDiffItem] = [
        RecordDiffItem(
            status="deleted",
            primary_key_value=pk,
            left_values=left_vals,
            right_values=None,
            diff_columns=columns,
        )
        for pk, left_vals in remaining_left_map.items()
    ]
    del remaining_left_map

    eq_count = equal_store.count()
    summary = DiffSummaryStats(
        total=len(modified_list) + len(added_list) + len(deleted_list) + eq_count,
        equal=eq_count,
        added=len(added_list),
        deleted=len(deleted_list),
        modified=len(modified_list),
    )
    result = RecordDiffResult(
        columns=columns,
        records=[],   # レコード本体はページネーション API で提供
        total_left=total_left,
        total_right=total_right,
        summary=summary,
        is_partial=True,
        partial_note=note,
    )
    job.result = result
    job.status_index = {
        "modified": modified_list,
        "added":    added_list,
        "deleted":  deleted_list,
        "equal":    [],
    }
    # job.equal_store は呼び出し元で設定済み

    job.status = "cancelled"
    job.phase = "cancelled"


def _finish_streaming_cancelled(
    job: DiffJob,
    columns: list[str],
    left_map: dict,
    equal_count: int,
    total_left: int,
    note: str,
) -> None:
    """左DB取得中のキャンセル。取得済みの left_map を deleted として扱う"""
    non_equal = [
        RecordDiffItem(
            status="deleted",
            primary_key_value=pk,
            left_values=left_vals,
            right_values=None,
            diff_columns=columns,
        )
        for pk, left_vals in left_map.items()
    ]
    del left_map

    summary = DiffSummaryStats(
        total=len(non_equal),
        equal=0,
        added=0,
        deleted=len(non_equal),
        modified=0,
    )
    result = RecordDiffResult(
        columns=columns,
        records=non_equal,
        total_left=total_left,
        total_right=0,
        summary=summary,
        is_partial=True,
        partial_note=note,
    )
    job.result = result

    idx: dict[str, list] = {"modified": [], "added": [], "deleted": non_equal, "equal": []}
    job.status_index = idx
    job.status = "cancelled"
    job.phase = "cancelled"


# ============================================================
# 従来実装（set_based 以外のアルゴリズム用）
# ============================================================

def _run_legacy(
    job: DiffJob,
    left_conn: Connection,
    right_conn: Connection,
    table_name: str,
    primary_keys: list[str],
    algorithm: DiffAlgorithm,
    batch_size: int,
    table_exists_left: bool = True,
    table_exists_right: bool = True,
) -> None:
    """set_based 以外のアルゴリズム用の従来実装（一括取得）"""

    # ── Phase 2: 左DBレコード取得 ────────────────────────────
    job.phase = "fetching_left"

    def left_progress_cb(n: int) -> None:
        job.left_progress = n

    if table_exists_left:
        left_columns, left_records, left_cancelled = fetch_all_records(
            conn=left_conn,
            table_name=table_name,
            order_by_columns=primary_keys,
            batch_size=batch_size,
            progress_callback=left_progress_cb,
            cancel_check=lambda: job.cancel_requested,
        )
        job.left_progress = len(left_records)
        if left_cancelled:
            note = f"左DB: {len(left_records)}/{job.left_total}件取得済みでキャンセルされました"
            _finish_cancelled(job, left_columns, left_records, [], job.left_total, job.right_total, note)
            return
    else:
        left_columns, left_records, left_cancelled = [], [], False

    # ── Phase 3: 右DBレコード取得 ────────────────────────────
    job.phase = "fetching_right"

    def right_progress_cb(n: int) -> None:
        job.right_progress = n

    if table_exists_right:
        right_columns, right_records, right_cancelled = fetch_all_records(
            conn=right_conn,
            table_name=table_name,
            order_by_columns=primary_keys,
            batch_size=batch_size,
            progress_callback=right_progress_cb,
            cancel_check=lambda: job.cancel_requested,
        )
        job.right_progress = len(right_records)
    else:
        right_columns, right_records, right_cancelled = [], [], False

    columns = left_columns or right_columns

    if right_cancelled:
        note = f"右DB: {len(right_records)}/{job.right_total}件取得済みでキャンセルされました（左DB: 全{len(left_records)}件取得済）"
        _finish_cancelled(
            job, columns, left_records, right_records,
            job.left_total, job.right_total, note,
        )
        return

    # ── Phase 4: 差分計算 ─────────────────────────────────────
    job.phase = "computing"
    job.compute_progress = 0
    job.compute_total = len(left_records) + len(right_records)

    def compute_progress_cb(done: int, total: int) -> None:
        job.compute_progress = done
        job.compute_total = total

    result = compute_record_diff_with_algorithm(
        columns=columns,
        left_records=left_records,
        right_records=right_records,
        primary_keys=primary_keys,
        total_left=job.left_total,
        total_right=job.right_total,
        algorithm=algorithm,
        progress_callback=compute_progress_cb,
    )
    job.result = result

    idx: dict[str, list] = {"modified": [], "added": [], "deleted": [], "equal": []}
    for r in result.records:
        idx[r.status].append(r)
    job.status_index = idx

    job.phase = "done"
    job.status = "done"


def _finish_cancelled(
    job: DiffJob,
    columns: list[str],
    left_records: list[dict],
    right_records: list[dict],
    total_left: int,
    total_right: int,
    note: str,
) -> None:
    """従来実装のキャンセル時に取得済みデータで部分的な差分を計算して保存する"""
    try:
        result = compute_record_diff_with_algorithm(
            columns=columns,
            left_records=left_records,
            right_records=right_records,
            primary_keys=[],
            total_left=total_left,
            total_right=total_right,
            algorithm="set_based",
        )
        result = result.model_copy(update={"is_partial": True, "partial_note": note})

        idx: dict[str, list] = {"modified": [], "added": [], "deleted": [], "equal": []}
        for r in result.records:
            idx[r.status].append(r)
        job.status_index = idx
    except Exception:
        result = None

    job.result = result
    job.status = "cancelled"
    job.phase = "cancelled"
