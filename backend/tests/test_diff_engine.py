"""
差分エンジン ユニットテスト
DB接続不要・ロジック単体をテスト
"""
import datetime
import pytest
from services.diff_engine import (
    compute_table_diff,
    compute_record_diff,
    compute_record_diff_with_algorithm,
    compute_schema_diff,
    _serialize_row,
    _greedy_lcs_opcodes,
)


# ============================================================
# テーブル一覧差分テスト
# ============================================================

class TestComputeTableDiff:
    """compute_table_diff のテスト"""

    def _col(self, name: str, col_type: str = "varchar(100)", nullable: str = "YES"):
        return {"COLUMN_NAME": name, "COLUMN_TYPE": col_type,
                "IS_NULLABLE": nullable, "COLUMN_DEFAULT": None,
                "EXTRA": "", "COLUMN_COMMENT": ""}

    def test_equal_tables(self):
        """両DBに同じテーブルが同じ定義で存在する場合 → equal"""
        cols = [self._col("id"), self._col("name")]
        result = compute_table_diff(["users"], ["users"], {"users": cols}, {"users": cols})
        assert len(result.tables) == 1
        assert result.tables[0].status == "equal"
        assert result.tables[0].left_table == "users"
        assert result.tables[0].right_table == "users"
        assert result.summary.equal == 1
        assert result.summary.total == 1

    def test_added_table(self):
        """右DBにのみ存在するテーブル → added"""
        result = compute_table_diff([], ["notifications"], {}, {"notifications": []})
        assert len(result.tables) == 1
        assert result.tables[0].status == "added"
        assert result.tables[0].left_table is None
        assert result.tables[0].right_table == "notifications"
        assert result.summary.added == 1

    def test_deleted_table(self):
        """左DBにのみ存在するテーブル → deleted"""
        result = compute_table_diff(["legacy_logs"], [], {"legacy_logs": []}, {})
        assert len(result.tables) == 1
        assert result.tables[0].status == "deleted"
        assert result.tables[0].left_table == "legacy_logs"
        assert result.tables[0].right_table is None
        assert result.summary.deleted == 1

    def test_modified_table_column_added(self):
        """右DBにカラムが追加されている → modified"""
        left_cols = [self._col("id"), self._col("name")]
        right_cols = [self._col("id"), self._col("name"), self._col("phone")]
        result = compute_table_diff(["users"], ["users"], {"users": left_cols}, {"users": right_cols})
        assert result.tables[0].status == "modified"
        assert result.tables[0].diff_summary is not None
        assert result.tables[0].diff_summary.columns_added == 1
        assert result.summary.modified == 1

    def test_mixed_tables(self):
        """複数テーブルの混在ケース"""
        left = ["categories", "legacy_logs", "orders", "products", "users"]
        right = ["categories", "notifications", "orders", "products", "users"]
        left_cols = {t: [self._col("id")] for t in left}
        right_cols = {t: [self._col("id")] for t in right}
        # ordersに差分を追加
        right_cols["orders"] = [self._col("id"), self._col("total_price")]

        result = compute_table_diff(left, right, left_cols, right_cols)

        statuses = {(i.left_table or i.right_table): i.status for i in result.tables}
        assert statuses["categories"] == "equal"
        assert statuses["legacy_logs"] == "deleted"
        assert statuses["notifications"] == "added"
        assert statuses["orders"] == "modified"
        assert statuses["products"] == "equal"
        assert statuses["users"] == "equal"
        assert result.summary.equal == 3
        assert result.summary.deleted == 1
        assert result.summary.added == 1
        assert result.summary.modified == 1
        assert result.summary.total == 6


# ============================================================
# レコード差分テスト
# ============================================================

class TestComputeRecordDiff:
    """compute_record_diff のテスト"""

    COLUMNS = ["id", "name", "email"]
    PK = ["id"]

    def _row(self, id_: int, name: str, email: str):
        return {"id": str(id_), "name": name, "email": email}

    def test_equal_records(self):
        """全レコード一致"""
        rows = [self._row(1, "Alice", "a@b.com"), self._row(2, "Bob", "b@b.com")]
        result = compute_record_diff(self.COLUMNS, rows, rows, self.PK, 2, 2)
        assert result.summary.equal == 2
        assert result.summary.modified == 0
        assert all(r.status == "equal" for r in result.records)

    def test_added_record(self):
        """右DBにのみ存在するレコード → added"""
        left = [self._row(1, "Alice", "a@b.com")]
        right = [self._row(1, "Alice", "a@b.com"), self._row(2, "Bob", "b@b.com")]
        result = compute_record_diff(self.COLUMNS, left, right, self.PK, 1, 2)
        assert result.summary.added == 1
        added = next(r for r in result.records if r.status == "added")
        assert added.primary_key_value == "2"
        assert added.left_values is None

    def test_deleted_record(self):
        """左DBにのみ存在するレコード → deleted"""
        left = [self._row(1, "Alice", "a@b.com"), self._row(2, "Bob", "b@b.com")]
        right = [self._row(1, "Alice", "a@b.com")]
        result = compute_record_diff(self.COLUMNS, left, right, self.PK, 2, 1)
        assert result.summary.deleted == 1
        deleted = next(r for r in result.records if r.status == "deleted")
        assert deleted.primary_key_value == "2"
        assert deleted.right_values is None

    def test_modified_record(self):
        """一部カラムが変更されたレコード → modified"""
        left = [self._row(1, "Alice", "old@b.com")]
        right = [self._row(1, "Alice", "new@b.com")]
        result = compute_record_diff(self.COLUMNS, left, right, self.PK, 1, 1)
        assert result.summary.modified == 1
        mod = result.records[0]
        assert mod.status == "modified"
        assert "email" in mod.diff_columns
        assert "name" not in mod.diff_columns

    def test_diff_columns_detected_correctly(self):
        """差分カラムが正確に検出される"""
        left = [{"id": "1", "name": "Alice", "email": "a@b.com", "age": "30"}]
        right = [{"id": "1", "name": "Alice", "email": "x@b.com", "age": "31"}]
        result = compute_record_diff(
            ["id", "name", "email", "age"], left, right, ["id"], 1, 1
        )
        mod = result.records[0]
        assert set(mod.diff_columns) == {"email", "age"}


# ============================================================
# スキーマ差分テスト
# ============================================================

class TestComputeSchemaDiff:
    """compute_schema_diff のテスト"""

    def _col(self, name: str, col_type: str = "varchar(100)", nullable: str = "YES",
             default: str | None = None, extra: str = "", comment: str = ""):
        return {"COLUMN_NAME": name, "COLUMN_TYPE": col_type,
                "IS_NULLABLE": nullable, "COLUMN_DEFAULT": default,
                "EXTRA": extra, "COLUMN_COMMENT": comment}

    def test_equal_columns(self):
        """完全一致のカラム定義"""
        cols = [self._col("id", "int", "NO"), self._col("name")]
        result = compute_schema_diff(cols, cols, [], [])
        assert all(c.status == "equal" for c in result.columns)
        assert result.summary.columns_added == 0
        assert result.summary.columns_modified == 0

    def test_added_column(self):
        """右DBにカラムが追加されている"""
        left = [self._col("id"), self._col("name")]
        right = [self._col("id"), self._col("name"), self._col("phone")]
        result = compute_schema_diff(left, right, [], [])
        statuses = {c.column_name: c.status for c in result.columns}
        assert statuses["phone"] == "added"
        assert result.summary.columns_added == 1

    def test_deleted_column(self):
        """左DBにのみ存在するカラム"""
        left = [self._col("id"), self._col("name"), self._col("legacy_field")]
        right = [self._col("id"), self._col("name")]
        result = compute_schema_diff(left, right, [], [])
        statuses = {c.column_name: c.status for c in result.columns}
        assert statuses["legacy_field"] == "deleted"
        assert result.summary.columns_deleted == 1

    def test_modified_column_type(self):
        """カラム型が変更されている"""
        left = [self._col("price", "decimal(8,2)")]
        right = [self._col("price", "decimal(12,2)")]
        result = compute_schema_diff(left, right, [], [])
        assert result.columns[0].status == "modified"
        assert "column_type" in result.columns[0].changed_fields

    def test_index_added(self):
        """インデックスが追加されている"""
        left_idx = []
        right_idx = [
            {"INDEX_NAME": "idx_email", "NON_UNIQUE": 0, "SEQ_IN_INDEX": 1,
             "COLUMN_NAME": "email", "INDEX_TYPE": "BTREE"},
        ]
        result = compute_schema_diff([], [], left_idx, right_idx)
        assert result.indexes[0].status == "added"
        assert result.summary.indexes_added == 1

    def test_index_deleted(self):
        """インデックスが削除されている"""
        left_idx = [
            {"INDEX_NAME": "idx_name", "NON_UNIQUE": 1, "SEQ_IN_INDEX": 1,
             "COLUMN_NAME": "name", "INDEX_TYPE": "BTREE"},
        ]
        result = compute_schema_diff([], [], left_idx, [])
        assert result.indexes[0].status == "deleted"
        assert result.summary.indexes_deleted == 1

    def test_index_equal(self):
        """インデックスが一致している"""
        idx = [
            {"INDEX_NAME": "idx_email", "NON_UNIQUE": 0, "SEQ_IN_INDEX": 1,
             "COLUMN_NAME": "email", "INDEX_TYPE": "BTREE"},
        ]
        result = compute_schema_diff([], [], idx, idx)
        assert result.indexes[0].status == "equal"
        assert result.summary.indexes_added == 0
        assert result.summary.indexes_deleted == 0
        assert result.summary.indexes_modified == 0

    def test_index_modified(self):
        """インデックスの定義が変更されている（UNIQUE → 非UNIQUE）"""
        left_idx = [
            {"INDEX_NAME": "idx_email", "NON_UNIQUE": 0, "SEQ_IN_INDEX": 1,
             "COLUMN_NAME": "email", "INDEX_TYPE": "BTREE"},
        ]
        right_idx = [
            {"INDEX_NAME": "idx_email", "NON_UNIQUE": 1, "SEQ_IN_INDEX": 1,
             "COLUMN_NAME": "email", "INDEX_TYPE": "BTREE"},
        ]
        result = compute_schema_diff([], [], left_idx, right_idx)
        assert result.indexes[0].status == "modified"
        assert result.summary.indexes_modified == 1

    def test_modified_column_nullable(self):
        """IS_NULLABLE が変更されている"""
        left = [self._col("age", "int", nullable="YES")]
        right = [self._col("age", "int", nullable="NO")]
        result = compute_schema_diff(left, right, [], [])
        assert result.columns[0].status == "modified"
        assert "is_nullable" in result.columns[0].changed_fields

    def test_modified_column_default(self):
        """COLUMN_DEFAULT が変更されている"""
        left = [self._col("status", default=None)]
        right = [self._col("status", default="active")]
        result = compute_schema_diff(left, right, [], [])
        assert result.columns[0].status == "modified"
        assert "column_default" in result.columns[0].changed_fields

    def test_modified_column_extra(self):
        """EXTRA が変更されている（auto_increment 付与）"""
        left = [self._col("id", extra="")]
        right = [self._col("id", extra="auto_increment")]
        result = compute_schema_diff(left, right, [], [])
        assert result.columns[0].status == "modified"
        assert "extra" in result.columns[0].changed_fields

    def test_modified_column_comment(self):
        """COLUMN_COMMENT が変更されている"""
        left = [self._col("memo", comment="")]
        right = [self._col("memo", comment="備考欄")]
        result = compute_schema_diff(left, right, [], [])
        assert result.columns[0].status == "modified"
        assert "column_comment" in result.columns[0].changed_fields

    def test_summary_counts_all_types(self):
        """サマリが added/deleted/modified/equal を正しく集計する"""
        left = [
            self._col("id"),
            self._col("name"),
            self._col("old_field"),
        ]
        right = [
            self._col("id"),
            self._col("name", col_type="text"),  # type変更
            self._col("new_field"),
        ]
        result = compute_schema_diff(left, right, [], [])
        assert result.summary.columns_added == 1
        assert result.summary.columns_deleted == 1
        assert result.summary.columns_modified == 1


# ============================================================
# テーブル一覧差分 + レコード数テスト
# ============================================================

class TestComputeTableDiffWithCounts:
    """left_counts / right_counts を渡すケースのテスト"""

    def _col(self, name: str):
        return {"COLUMN_NAME": name, "COLUMN_TYPE": "int", "IS_NULLABLE": "NO",
                "COLUMN_DEFAULT": None, "EXTRA": "", "COLUMN_COMMENT": ""}

    def test_counts_are_attached_to_equal_table(self):
        """equal テーブルに left_count/right_count が付与される"""
        cols = [self._col("id")]
        result = compute_table_diff(
            ["users"], ["users"],
            {"users": cols}, {"users": cols},
            left_counts={"users": 100}, right_counts={"users": 120},
        )
        assert result.tables[0].left_count == 100
        assert result.tables[0].right_count == 120

    def test_counts_are_attached_to_deleted_table(self):
        """deleted テーブルに left_count が付与される"""
        result = compute_table_diff(
            ["old_table"], [],
            {"old_table": []}, {},
            left_counts={"old_table": 50},
        )
        assert result.tables[0].left_count == 50
        assert result.tables[0].right_count is None

    def test_counts_are_attached_to_added_table(self):
        """added テーブルに right_count が付与される"""
        result = compute_table_diff(
            [], ["new_table"],
            {}, {"new_table": []},
            right_counts={"new_table": 200},
        )
        assert result.tables[0].right_count == 200
        assert result.tables[0].left_count is None

    def test_no_counts_when_omitted(self):
        """カウント省略時は None になる"""
        cols = [self._col("id")]
        result = compute_table_diff(["t"], ["t"], {"t": cols}, {"t": cols})
        assert result.tables[0].left_count is None
        assert result.tables[0].right_count is None

    def test_empty_both_sides(self):
        """両DBともテーブルなし → 空のリストが返る"""
        result = compute_table_diff([], [], {}, {})
        assert result.tables == []
        assert result.summary.total == 0


# ============================================================
# レコード差分 追加ケース
# ============================================================

class TestComputeRecordDiffEdgeCases:
    """compute_record_diff のエッジケーステスト"""

    def test_composite_primary_key(self):
        """複合主キー（2カラム）でのレコード照合"""
        columns = ["order_id", "product_id", "qty"]
        pks = ["order_id", "product_id"]
        left = [
            {"order_id": "1", "product_id": "A", "qty": "2"},
            {"order_id": "1", "product_id": "B", "qty": "3"},
        ]
        right = [
            {"order_id": "1", "product_id": "A", "qty": "5"},  # qty変更
            {"order_id": "1", "product_id": "C", "qty": "1"},  # 追加
        ]
        result = compute_record_diff(columns, left, right, pks, 2, 2)
        statuses = {r.primary_key_value: r.status for r in result.records}
        assert statuses["1||A"] == "modified"
        assert statuses["1||B"] == "deleted"
        assert statuses["1||C"] == "added"

    def test_empty_both_sides(self):
        """両方空のテーブル → レコードなし・サマリすべて0"""
        result = compute_record_diff(["id", "name"], [], [], ["id"], 0, 0)
        assert result.records == []
        assert result.summary.total == 0

    def test_progress_callback_is_called(self):
        """progress_callback が少なくとも1回（完了時）呼ばれることを確認"""
        calls = []

        def cb(done: int, total: int):
            calls.append((done, total))

        rows = [{"id": str(i), "v": str(i)} for i in range(10)]
        compute_record_diff(["id", "v"], rows, rows, ["id"], 10, 10,
                            progress_callback=cb)
        # 最後に progress_callback(total, total) が呼ばれる
        assert len(calls) >= 1
        last_done, last_total = calls[-1]
        assert last_done == last_total

    def test_null_column_values_treated_as_string(self):
        """None 値は文字列 'None' として比較される（set_based の仕様）"""
        columns = ["id", "remark"]
        left  = [{"id": "1", "remark": None}]
        right = [{"id": "1", "remark": "note"}]
        result = compute_record_diff(columns, left, right, ["id"], 1, 1)
        assert result.records[0].status == "modified"
        assert "remark" in result.records[0].diff_columns


# ============================================================
# _serialize_row のテスト
# ============================================================

class TestSerializeRow:
    """_serialize_row のテスト"""

    def test_none_row_returns_none(self):
        assert _serialize_row(None) is None

    def test_none_value_in_row(self):
        result = _serialize_row({"id": None, "name": "Alice"})
        assert result["id"] is None
        assert result["name"] == "Alice"

    def test_datetime_value_is_isoformat(self):
        """datetime 値は isoformat 文字列に変換される"""
        dt = datetime.datetime(2024, 3, 15, 12, 0, 0)
        result = _serialize_row({"created_at": dt})
        assert result["created_at"] == "2024-03-15T12:00:00"

    def test_date_value_is_isoformat(self):
        """date 値は isoformat 文字列に変換される"""
        d = datetime.date(2024, 1, 1)
        result = _serialize_row({"birth_date": d})
        assert result["birth_date"] == "2024-01-01"

    def test_numeric_value_is_string(self):
        """数値は文字列に変換される"""
        result = _serialize_row({"score": 42, "rate": 3.14})
        assert result["score"] == "42"
        assert result["rate"] == "3.14"

    def test_string_value_unchanged(self):
        """文字列はそのまま返る"""
        result = _serialize_row({"name": "Bob"})
        assert result["name"] == "Bob"


# ============================================================
# アルゴリズム切り替えテスト
# ============================================================

class TestComputeRecordDiffWithAlgorithm:
    """compute_record_diff_with_algorithm の各アルゴリズムをテスト"""

    COLUMNS = ["id", "value"]
    PK = ["id"]

    def _row(self, id_: int, value: str):
        return {"id": str(id_), "value": value}

    # ── set_based ────────────────────────────────────────────

    def test_set_based_equal(self):
        rows = [self._row(1, "a"), self._row(2, "b")]
        result = compute_record_diff_with_algorithm(
            self.COLUMNS, rows, rows, self.PK, 2, 2, algorithm="set_based"
        )
        assert result.summary.equal == 2

    def test_set_based_modified(self):
        left  = [self._row(1, "old")]
        right = [self._row(1, "new")]
        result = compute_record_diff_with_algorithm(
            self.COLUMNS, left, right, self.PK, 1, 1, algorithm="set_based"
        )
        assert result.summary.modified == 1

    # ── ast_based ────────────────────────────────────────────

    def test_ast_based_numeric_string_equal(self):
        """'1.0' と '1' は ast_based では等値とみなす"""
        left  = [{"id": "1", "value": "1.0"}]
        right = [{"id": "1", "value": "1"}]
        result = compute_record_diff_with_algorithm(
            self.COLUMNS, left, right, self.PK, 1, 1, algorithm="ast_based"
        )
        assert result.summary.equal == 1
        assert result.summary.modified == 0

    def test_ast_based_different_strings_are_different(self):
        """完全に異なる文字列は modified"""
        left  = [{"id": "1", "value": "foo"}]
        right = [{"id": "1", "value": "bar"}]
        result = compute_record_diff_with_algorithm(
            self.COLUMNS, left, right, self.PK, 1, 1, algorithm="ast_based"
        )
        assert result.summary.modified == 1

    def test_ast_based_case_insensitive(self):
        """大文字・小文字は ast_based では同値"""
        left  = [{"id": "1", "value": "HELLO"}]
        right = [{"id": "1", "value": "hello"}]
        result = compute_record_diff_with_algorithm(
            self.COLUMNS, left, right, self.PK, 1, 1, algorithm="ast_based"
        )
        assert result.summary.equal == 1

    def test_ast_based_added_record(self):
        """右のみ存在するレコードは added"""
        left  = []
        right = [self._row(1, "x")]
        result = compute_record_diff_with_algorithm(
            self.COLUMNS, left, right, self.PK, 0, 1, algorithm="ast_based"
        )
        assert result.summary.added == 1

    def test_ast_based_progress_callback(self):
        """ast_based でも progress_callback が呼ばれる"""
        calls = []
        rows = [self._row(i, str(i)) for i in range(10)]
        compute_record_diff_with_algorithm(
            self.COLUMNS, rows, rows, self.PK, 10, 10,
            algorithm="ast_based", progress_callback=lambda d, t: calls.append((d, t))
        )
        assert len(calls) >= 1

    # ── myers ────────────────────────────────────────────────

    def test_myers_equal_sequences(self):
        rows = [self._row(i, str(i)) for i in range(5)]
        result = compute_record_diff_with_algorithm(
            self.COLUMNS, rows, rows, self.PK, 5, 5, algorithm="myers"
        )
        assert result.summary.equal == 5
        assert result.summary.added == 0
        assert result.summary.deleted == 0

    def test_myers_added_row(self):
        left  = [self._row(1, "a"), self._row(2, "b")]
        right = [self._row(1, "a"), self._row(2, "b"), self._row(3, "c")]
        result = compute_record_diff_with_algorithm(
            self.COLUMNS, left, right, self.PK, 2, 3, algorithm="myers"
        )
        assert result.summary.added >= 1

    def test_myers_deleted_row(self):
        left  = [self._row(1, "a"), self._row(2, "b"), self._row(3, "c")]
        right = [self._row(1, "a"), self._row(3, "c")]
        result = compute_record_diff_with_algorithm(
            self.COLUMNS, left, right, self.PK, 3, 2, algorithm="myers"
        )
        assert result.summary.deleted >= 1

    # ── patience ─────────────────────────────────────────────

    def test_patience_equal(self):
        rows = [self._row(i, f"val{i}") for i in range(4)]
        result = compute_record_diff_with_algorithm(
            self.COLUMNS, rows, rows, self.PK, 4, 4, algorithm="patience"
        )
        assert result.summary.equal == 4

    def test_patience_modified_row(self):
        left  = [self._row(1, "old"), self._row(2, "same")]
        right = [self._row(1, "new"), self._row(2, "same")]
        result = compute_record_diff_with_algorithm(
            self.COLUMNS, left, right, self.PK, 2, 2, algorithm="patience"
        )
        total = result.summary.total
        assert total == 2

    # ── histogram ────────────────────────────────────────────

    def test_histogram_equal(self):
        rows = [self._row(i, "x") for i in range(3)]
        result = compute_record_diff_with_algorithm(
            self.COLUMNS, rows, rows, self.PK, 3, 3, algorithm="histogram"
        )
        assert result.summary.equal == 3

    # ── greedy_lcs ───────────────────────────────────────────

    def test_greedy_lcs_equal(self):
        rows = [self._row(i, str(i)) for i in range(5)]
        result = compute_record_diff_with_algorithm(
            self.COLUMNS, rows, rows, self.PK, 5, 5, algorithm="greedy_lcs"
        )
        assert result.summary.equal == 5

    def test_greedy_lcs_added(self):
        left  = [self._row(1, "a")]
        right = [self._row(1, "a"), self._row(2, "b")]
        result = compute_record_diff_with_algorithm(
            self.COLUMNS, left, right, self.PK, 1, 2, algorithm="greedy_lcs"
        )
        assert result.summary.added >= 1

    def test_greedy_lcs_deleted(self):
        left  = [self._row(1, "a"), self._row(2, "b")]
        right = [self._row(1, "a")]
        result = compute_record_diff_with_algorithm(
            self.COLUMNS, left, right, self.PK, 2, 1, algorithm="greedy_lcs"
        )
        assert result.summary.deleted >= 1


# ============================================================
# _greedy_lcs_opcodes のテスト
# ============================================================

class TestGreedyLcsOpcodes:
    """_greedy_lcs_opcodes の内部ロジックをテスト"""

    def test_equal_sequences_all_equal(self):
        """完全一致シーケンス → すべて equal"""
        seq = ["a", "b", "c"]
        opcodes = _greedy_lcs_opcodes(seq, seq)
        tags = [tag for tag, *_ in opcodes]
        assert "equal" in tags
        assert "replace" not in tags
        assert "delete" not in tags
        assert "insert" not in tags

    def test_empty_left(self):
        """左が空 → insert のみ"""
        opcodes = _greedy_lcs_opcodes([], ["x", "y"])
        tags = {tag for tag, *_ in opcodes}
        assert "equal" not in tags
        assert "insert" in tags or "replace" in tags

    def test_empty_right(self):
        """右が空 → delete のみ"""
        opcodes = _greedy_lcs_opcodes(["x", "y"], [])
        tags = {tag for tag, *_ in opcodes}
        assert "equal" not in tags
        assert "delete" in tags or "replace" in tags

    def test_both_empty(self):
        """両方空 → opcode なし"""
        assert _greedy_lcs_opcodes([], []) == []

    def test_one_common_element(self):
        """共通要素が1つ → equal が含まれる"""
        opcodes = _greedy_lcs_opcodes(["a", "b", "c"], ["x", "b", "z"])
        tags = [tag for tag, *_ in opcodes]
        assert "equal" in tags

    def test_coverage_is_complete(self):
        """opcode が left/right のすべての要素をカバーする"""
        left  = ["p", "q", "r", "s"]
        right = ["q", "r", "t"]
        opcodes = _greedy_lcs_opcodes(left, right)

        covered_left  = set()
        covered_right = set()
        for tag, i1, i2, j1, j2 in opcodes:
            covered_left  |= set(range(i1, i2))
            covered_right |= set(range(j1, j2))

        assert covered_left  == set(range(len(left)))
        assert covered_right == set(range(len(right)))
