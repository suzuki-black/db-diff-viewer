"""
差分計算エンジン
テーブル一覧差分・カラム定義差分・レコード差分を計算する
"""
import difflib
from typing import Any, Callable, Optional

from schemas import (
    ColumnDiffItem, ColumnInfo, DiffSummaryStats,
    IndexDiffItem, RecordDiffItem, RecordDiffResult,
    SchemaDiffResult, SchemaDiffSummary,
    TableDiffItem, TableDiffResult, TableDiffSummary,
)


# ============================================================
# テーブル一覧差分
# ============================================================

def compute_table_diff(
    left_tables: list[str],
    right_tables: list[str],
    left_column_defs: dict[str, list[dict]],
    right_column_defs: dict[str, list[dict]],
    left_counts: Optional[dict[str, int]] = None,
    right_counts: Optional[dict[str, int]] = None,
) -> TableDiffResult:
    """
    テーブル一覧の差分を計算する

    Args:
        left_tables: 左DBのテーブル名一覧
        right_tables: 右DBのテーブル名一覧
        left_column_defs: テーブル名をキーとする左DBのカラム定義dict
        right_column_defs: テーブル名をキーとする右DBのカラム定義dict
        left_counts: テーブル名をキーとする左DBの近似レコード数（省略可）
        right_counts: テーブル名をキーとする右DBの近似レコード数（省略可）
    """
    left_set = set(left_tables)
    right_set = set(right_tables)

    added_tables = right_set - left_set       # 右DBにのみ存在
    deleted_tables = left_set - right_set     # 左DBにのみ存在
    common_tables = left_set & right_set      # 両方に存在

    _lc = left_counts or {}
    _rc = right_counts or {}

    items: list[TableDiffItem] = []

    # 削除されたテーブル（左DBにのみ存在）
    for t in sorted(deleted_tables):
        items.append(TableDiffItem(
            status="deleted", left_table=t, right_table=None,
            left_count=_lc.get(t),
        ))

    # 追加されたテーブル（右DBにのみ存在）
    for t in sorted(added_tables):
        items.append(TableDiffItem(
            status="added", left_table=None, right_table=t,
            right_count=_rc.get(t),
        ))

    # 両方に存在するテーブル → カラム差分を確認
    for t in sorted(common_tables):
        left_cols = left_column_defs.get(t, [])
        right_cols = right_column_defs.get(t, [])
        diff_summary = _column_diff_summary(left_cols, right_cols)
        has_diff = (
            diff_summary.columns_added > 0
            or diff_summary.columns_deleted > 0
            or diff_summary.columns_modified > 0
        )
        status = "modified" if has_diff else "equal"
        items.append(
            TableDiffItem(
                status=status,
                left_table=t,
                right_table=t,
                diff_summary=diff_summary if has_diff else None,
                left_count=_lc.get(t),
                right_count=_rc.get(t),
            )
        )

    # WinMerge風の並び順: 対応するテーブルを同じ行に表示するため name 順で merge
    items = _merge_table_items(items)

    # サマリ集計
    summary = DiffSummaryStats(
        total=len(items),
        equal=sum(1 for i in items if i.status == "equal"),
        added=sum(1 for i in items if i.status == "added"),
        deleted=sum(1 for i in items if i.status == "deleted"),
        modified=sum(1 for i in items if i.status == "modified"),
    )

    return TableDiffResult(tables=items, summary=summary)


def _column_diff_summary(
    left_cols: list[dict],
    right_cols: list[dict],
) -> TableDiffSummary:
    """カラム定義の差分サマリを計算する"""
    left_names = {c["COLUMN_NAME"]: c for c in left_cols}
    right_names = {c["COLUMN_NAME"]: c for c in right_cols}

    added = len(set(right_names) - set(left_names))
    deleted = len(set(left_names) - set(right_names))
    modified = sum(
        1 for name in set(left_names) & set(right_names)
        if _col_changed(left_names[name], right_names[name])
    )
    return TableDiffSummary(
        columns_added=added,
        columns_deleted=deleted,
        columns_modified=modified,
    )


def _col_changed(left: dict, right: dict) -> bool:
    """カラム定義が変更されているかを判定する"""
    check_keys = ["COLUMN_TYPE", "IS_NULLABLE", "COLUMN_DEFAULT", "EXTRA", "COLUMN_COMMENT"]
    return any(left.get(k) != right.get(k) for k in check_keys)


def _merge_table_items(items: list[TableDiffItem]) -> list[TableDiffItem]:
    """テーブル差分アイテムをWinMerge風に並べ替える"""
    # 全テーブル名をソートして順序を統一
    all_names: set[str] = set()
    for item in items:
        if item.left_table:
            all_names.add(item.left_table)
        if item.right_table:
            all_names.add(item.right_table)

    name_to_item: dict[str, TableDiffItem] = {}
    for item in items:
        key = item.left_table or item.right_table or ""
        name_to_item[key] = item

    return [name_to_item[name] for name in sorted(all_names) if name in name_to_item]


# ============================================================
# レコード差分
# ============================================================

def compute_record_diff(
    columns: list[str],
    left_records: list[dict[str, Any]],
    right_records: list[dict[str, Any]],
    primary_keys: list[str],
    total_left: int,
    total_right: int,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> RecordDiffResult:
    """
    レコード差分を計算する

    主キーをキーとしてレコードを突き合わせ、差分を検出する
    """
    def pk_val(row: dict) -> str:
        return "||".join(str(row.get(k, "")) for k in primary_keys)

    left_map = {pk_val(r): r for r in left_records}
    right_map = {pk_val(r): r for r in right_records}

    all_keys = sorted(set(left_map) | set(right_map))
    items: list[RecordDiffItem] = []
    total_keys = len(all_keys)

    for idx, pk in enumerate(all_keys):
        if progress_callback and idx % 500 == 0:
            progress_callback(idx, total_keys)
        left_row = left_map.get(pk)
        right_row = right_map.get(pk)

        if left_row is None:
            items.append(RecordDiffItem(
                status="added",
                primary_key_value=pk,
                left_values=None,
                right_values=_serialize_row(right_row),
                diff_columns=columns,
            ))
        elif right_row is None:
            items.append(RecordDiffItem(
                status="deleted",
                primary_key_value=pk,
                left_values=_serialize_row(left_row),
                right_values=None,
                diff_columns=columns,
            ))
        else:
            diff_cols = [
                col for col in columns
                if str(left_row.get(col)) != str(right_row.get(col))
            ]
            status = "modified" if diff_cols else "equal"
            items.append(RecordDiffItem(
                status=status,
                primary_key_value=pk,
                left_values=_serialize_row(left_row),
                right_values=_serialize_row(right_row),
                diff_columns=diff_cols,
            ))

    if progress_callback:
        progress_callback(total_keys, total_keys)

    summary = DiffSummaryStats(
        total=len(items),
        equal=sum(1 for i in items if i.status == "equal"),
        added=sum(1 for i in items if i.status == "added"),
        deleted=sum(1 for i in items if i.status == "deleted"),
        modified=sum(1 for i in items if i.status == "modified"),
    )

    return RecordDiffResult(
        columns=columns,
        records=items,
        total_left=total_left,
        total_right=total_right,
        summary=summary,
    )


def _serialize_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
    """MySQL行データをJSONシリアライズ可能な形式に変換する"""
    if row is None:
        return None
    result = {}
    for k, v in row.items():
        if v is None:
            result[k] = None
        elif hasattr(v, "isoformat"):
            result[k] = v.isoformat()
        else:
            result[k] = str(v)
    return result


# ============================================================
# テーブル構造差分（スキーマ差分）
# ============================================================

def compute_schema_diff(
    left_cols: list[dict],
    right_cols: list[dict],
    left_indexes: list[dict],
    right_indexes: list[dict],
) -> SchemaDiffResult:
    """テーブル構造差分を計算する"""
    left_col_map = {c["COLUMN_NAME"]: c for c in left_cols}
    right_col_map = {c["COLUMN_NAME"]: c for c in right_cols}

    all_col_names = sorted(set(left_col_map) | set(right_col_map))
    column_diffs: list[ColumnDiffItem] = []

    for name in all_col_names:
        left_c = left_col_map.get(name)
        right_c = right_col_map.get(name)

        if left_c is None:
            column_diffs.append(ColumnDiffItem(
                status="added", column_name=name,
                left_column=None,
                right_column=_to_column_info(right_c),
            ))
        elif right_c is None:
            column_diffs.append(ColumnDiffItem(
                status="deleted", column_name=name,
                left_column=_to_column_info(left_c),
                right_column=None,
            ))
        else:
            check_keys = ["COLUMN_TYPE", "IS_NULLABLE", "COLUMN_DEFAULT", "EXTRA", "COLUMN_COMMENT"]
            changed = [k for k in check_keys if left_c.get(k) != right_c.get(k)]
            status = "modified" if changed else "equal"
            column_diffs.append(ColumnDiffItem(
                status=status,
                column_name=name,
                left_column=_to_column_info(left_c),
                right_column=_to_column_info(right_c),
                changed_fields=[k.lower() for k in changed],
            ))

    # インデックス差分
    left_idx_map = _group_indexes(left_indexes)
    right_idx_map = _group_indexes(right_indexes)
    all_idx_names = sorted(set(left_idx_map) | set(right_idx_map))
    index_diffs: list[IndexDiffItem] = []

    for name in all_idx_names:
        left_i = left_idx_map.get(name)
        right_i = right_idx_map.get(name)
        if left_i is None:
            index_diffs.append(IndexDiffItem(status="added", index_name=name, left_index=None, right_index=right_i))
        elif right_i is None:
            index_diffs.append(IndexDiffItem(status="deleted", index_name=name, left_index=left_i, right_index=None))
        else:
            status = "modified" if left_i != right_i else "equal"
            index_diffs.append(IndexDiffItem(status=status, index_name=name, left_index=left_i, right_index=right_i))

    summary = SchemaDiffSummary(
        columns_added=sum(1 for c in column_diffs if c.status == "added"),
        columns_deleted=sum(1 for c in column_diffs if c.status == "deleted"),
        columns_modified=sum(1 for c in column_diffs if c.status == "modified"),
        indexes_added=sum(1 for i in index_diffs if i.status == "added"),
        indexes_deleted=sum(1 for i in index_diffs if i.status == "deleted"),
        indexes_modified=sum(1 for i in index_diffs if i.status == "modified"),
    )

    return SchemaDiffResult(columns=column_diffs, indexes=index_diffs, summary=summary)


def _to_column_info(col: dict) -> ColumnInfo:
    return ColumnInfo(
        name=col["COLUMN_NAME"],
        type=col["COLUMN_TYPE"],
        nullable=col["IS_NULLABLE"] == "YES",
        default_value=col.get("COLUMN_DEFAULT"),
        extra=col.get("EXTRA", ""),
        comment=col.get("COLUMN_COMMENT", ""),
    )


def _group_indexes(rows: list[dict]) -> dict[str, dict]:
    """インデックス行をインデックス名でグループ化する"""
    result: dict[str, dict] = {}
    for row in rows:
        name = row["INDEX_NAME"]
        if name not in result:
            result[name] = {
                "non_unique": row["NON_UNIQUE"],
                "index_type": row.get("INDEX_TYPE"),
                "columns": [],
            }
        result[name]["columns"].append(row["COLUMN_NAME"])
    return result


# ============================================================
# アルゴリズム選択付きレコード差分
# ============================================================


def compute_record_diff_with_algorithm(
    columns: list[str],
    left_records: list[dict[str, Any]],
    right_records: list[dict[str, Any]],
    primary_keys: list[str],
    total_left: int,
    total_right: int,
    algorithm: str = "set_based",
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> RecordDiffResult:
    """
    差分アルゴリズムを指定してレコード差分を計算する

    アルゴリズム説明:
        set_based   : 主キーでレコードを照合（推奨・デフォルト）
        ast_based   : 主キーで照合、値を型考慮で比較（数値 "1" と 1 を同値とみなす）
        myers       : シーケンスDiff（Myers アルゴリズム）主キー無しの場合に有効
        patience    : シーケンスDiff（Patience アルゴリズム）ユニーク行をアンカーとして使用
        histogram   : シーケンスDiff（Histogram ベース）繰り返し行が多い場合に有効
        greedy_lcs  : 高速 Greedy LCS 近似（大規模テーブル向け）
    """
    if algorithm in ("set_based",):
        return compute_record_diff(
            columns, left_records, right_records, primary_keys, total_left, total_right,
            progress_callback=progress_callback,
        )
    elif algorithm == "ast_based":
        return _compute_ast_based_diff(
            columns, left_records, right_records, primary_keys, total_left, total_right,
            progress_callback=progress_callback,
        )
    else:
        # myers / patience / histogram / greedy_lcs → シーケンスベース
        return _compute_sequence_diff(
            columns, left_records, right_records, total_left, total_right, algorithm,
            progress_callback=progress_callback,
        )


def _compute_ast_based_diff(
    columns: list[str],
    left_records: list[dict[str, Any]],
    right_records: list[dict[str, Any]],
    primary_keys: list[str],
    total_left: int,
    total_right: int,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> RecordDiffResult:
    """
    主キーで照合し、値を型考慮で比較する
    例: "1.0" と "1" は同値、"True" と "1" は同値と判定
    """
    def pk_val(row: dict) -> str:
        return "||".join(str(row.get(k, "")) for k in primary_keys)

    def _coerce(v: Any) -> Any:
        """型を統一して比較可能にする"""
        if v is None:
            return None
        s = str(v).strip()
        try:
            f = float(s)
            return int(f) if f == int(f) else f
        except (ValueError, OverflowError):
            pass
        return s.lower()

    left_map = {pk_val(r): r for r in left_records}
    right_map = {pk_val(r): r for r in right_records}
    all_keys = sorted(set(left_map) | set(right_map))
    items: list[RecordDiffItem] = []
    total_keys = len(all_keys)

    for idx, pk in enumerate(all_keys):
        if progress_callback and idx % 500 == 0:
            progress_callback(idx, total_keys)
        left_row = left_map.get(pk)
        right_row = right_map.get(pk)

        if left_row is None:
            items.append(RecordDiffItem(
                status="added", primary_key_value=pk,
                left_values=None, right_values=_serialize_row(right_row),
                diff_columns=columns,
            ))
        elif right_row is None:
            items.append(RecordDiffItem(
                status="deleted", primary_key_value=pk,
                left_values=_serialize_row(left_row), right_values=None,
                diff_columns=columns,
            ))
        else:
            diff_cols = [
                col for col in columns
                if _coerce(left_row.get(col)) != _coerce(right_row.get(col))
            ]
            status = "modified" if diff_cols else "equal"
            items.append(RecordDiffItem(
                status=status, primary_key_value=pk,
                left_values=_serialize_row(left_row),
                right_values=_serialize_row(right_row),
                diff_columns=diff_cols,
            ))

    if progress_callback:
        progress_callback(total_keys, total_keys)

    summary = DiffSummaryStats(
        total=len(items),
        equal=sum(1 for i in items if i.status == "equal"),
        added=sum(1 for i in items if i.status == "added"),
        deleted=sum(1 for i in items if i.status == "deleted"),
        modified=sum(1 for i in items if i.status == "modified"),
    )
    return RecordDiffResult(
        columns=columns, records=items,
        total_left=total_left, total_right=total_right, summary=summary,
    )


def _compute_sequence_diff(
    columns: list[str],
    left_records: list[dict[str, Any]],
    right_records: list[dict[str, Any]],
    total_left: int,
    total_right: int,
    algorithm: str,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> RecordDiffResult:
    """
    シーケンスベースの差分計算（Myers/Patience/Histogram/GreedyLCS）
    レコードを文字列としてハッシュ化し、行ベースの diff として計算する
    """

    def fingerprint(row: dict) -> str:
        return "||".join(f"{k}={row.get(k)}" for k in sorted(row.keys()))

    left_fps = [fingerprint(r) for r in left_records]
    right_fps = [fingerprint(r) for r in right_records]

    if algorithm == "greedy_lcs":
        opcodes = _greedy_lcs_opcodes(left_fps, right_fps)
    else:
        # myers=autojunk=True, patience/histogram=autojunk=False
        autojunk = algorithm == "myers"
        matcher = difflib.SequenceMatcher(None, left_fps, right_fps, autojunk=autojunk)
        opcodes = matcher.get_opcodes()

    items: list[RecordDiffItem] = []
    total_ops = len(opcodes)

    for op_idx, (tag, i1, i2, j1, j2) in enumerate(opcodes):
        if progress_callback and op_idx % 100 == 0:
            progress_callback(op_idx, total_ops)
        if tag == "equal":
            for li, ri in zip(range(i1, i2), range(j1, j2)):
                items.append(RecordDiffItem(
                    status="equal",
                    primary_key_value=str(li),
                    left_values=_serialize_row(left_records[li]),
                    right_values=_serialize_row(right_records[ri]),
                    diff_columns=[],
                ))
        elif tag == "replace":
            pairs = list(zip(range(i1, i2), range(j1, j2)))
            for li, ri in pairs:
                diff_cols = [
                    col for col in columns
                    if str(left_records[li].get(col)) != str(right_records[ri].get(col))
                ]
                items.append(RecordDiffItem(
                    status="modified" if diff_cols else "equal",
                    primary_key_value=str(li),
                    left_values=_serialize_row(left_records[li]),
                    right_values=_serialize_row(right_records[ri]),
                    diff_columns=diff_cols,
                ))
            for li in range(i1 + len(pairs), i2):
                items.append(RecordDiffItem(
                    status="deleted", primary_key_value=f"L{li}",
                    left_values=_serialize_row(left_records[li]), right_values=None,
                    diff_columns=columns,
                ))
            for ri in range(j1 + len(pairs), j2):
                items.append(RecordDiffItem(
                    status="added", primary_key_value=f"R{ri}",
                    left_values=None, right_values=_serialize_row(right_records[ri]),
                    diff_columns=columns,
                ))
        elif tag == "delete":
            for li in range(i1, i2):
                items.append(RecordDiffItem(
                    status="deleted", primary_key_value=f"L{li}",
                    left_values=_serialize_row(left_records[li]), right_values=None,
                    diff_columns=columns,
                ))
        elif tag == "insert":
            for ri in range(j1, j2):
                items.append(RecordDiffItem(
                    status="added", primary_key_value=f"R{ri}",
                    left_values=None, right_values=_serialize_row(right_records[ri]),
                    diff_columns=columns,
                ))

    if progress_callback:
        progress_callback(total_ops, total_ops)

    summary = DiffSummaryStats(
        total=len(items),
        equal=sum(1 for i in items if i.status == "equal"),
        added=sum(1 for i in items if i.status == "added"),
        deleted=sum(1 for i in items if i.status == "deleted"),
        modified=sum(1 for i in items if i.status == "modified"),
    )
    return RecordDiffResult(
        columns=columns, records=items,
        total_left=total_left, total_right=total_right, summary=summary,
    )


def _greedy_lcs_opcodes(
    left: list[str],
    right: list[str],
) -> list[tuple[str, int, int, int, int]]:
    """
    Greedy LCS: ハッシュマップを使った O(n) 近似 LCS
    完全一致するレコードを貪欲にマッチングし、残りを added/deleted として処理する
    """
    right_index: dict[str, list[int]] = {}
    for i, fp in enumerate(right):
        right_index.setdefault(fp, []).append(i)

    used_right: set[int] = set()
    matches: list[tuple[int, int]] = []

    for li, fp in enumerate(left):
        candidates = [ri for ri in right_index.get(fp, []) if ri not in used_right]
        if candidates:
            ri = candidates[0]
            matches.append((li, ri))
            used_right.add(ri)

    # matches を opcode 列に変換
    opcodes: list[tuple[str, int, int, int, int]] = []
    prev_li, prev_ri = 0, 0

    for li, ri in sorted(matches):
        if prev_li < li or prev_ri < ri:
            # delete from left / insert from right
            if prev_li < li and prev_ri < ri:
                opcodes.append(("replace", prev_li, li, prev_ri, ri))
            elif prev_li < li:
                opcodes.append(("delete", prev_li, li, prev_ri, prev_ri))
            else:
                opcodes.append(("insert", prev_li, prev_li, prev_ri, ri))
        opcodes.append(("equal", li, li + 1, ri, ri + 1))
        prev_li, prev_ri = li + 1, ri + 1

    n, m = len(left), len(right)
    if prev_li < n or prev_ri < m:
        if prev_li < n and prev_ri < m:
            opcodes.append(("replace", prev_li, n, prev_ri, m))
        elif prev_li < n:
            opcodes.append(("delete", prev_li, n, prev_ri, prev_ri))
        else:
            opcodes.append(("insert", prev_li, prev_li, prev_ri, m))

    return opcodes
