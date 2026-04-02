"""
差分エンジン ユニットテスト
DB接続不要・ロジック単体をテスト
"""
import pytest
from services.diff_engine import (
    compute_table_diff,
    compute_record_diff,
    compute_schema_diff,
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
