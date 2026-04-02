"""
Pydantic スキーマ定義（リクエスト/レスポンス）
"""
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator


# ============================================================
# 接続設定スキーマ
# ============================================================

class ConnectionBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="接続設定の表示名")
    db_type: Literal["mysql", "postgresql"] = Field(default="mysql", description="DBの種類")
    host: str = Field(..., min_length=1, max_length=255, description="ホスト名")
    port: int = Field(default=3306, ge=1, le=65535, description="ポート番号")
    username: str = Field(..., min_length=1, max_length=100)
    schema_name: str = Field(..., min_length=1, max_length=255)
    use_ssh: bool = Field(default=False)
    ssh_host: Optional[str] = None
    ssh_port: Optional[int] = Field(default=22, ge=1, le=65535)
    ssh_username: Optional[str] = None
    ssh_auth_type: Optional[Literal["password", "key"]] = None
    ssh_key_path: Optional[str] = None
    local_bind_port: Optional[int] = Field(default=0, ge=0, le=65535)

    @field_validator("ssh_host", "ssh_username")
    @classmethod
    def validate_ssh_fields(cls, v: Optional[str], info) -> Optional[str]:
        return v or None


class ConnectionCreate(ConnectionBase):
    """接続設定作成リクエスト（パスワード必須）"""
    password: str = Field(..., min_length=0, description="DBパスワード")
    ssh_password: Optional[str] = None


class ConnectionUpdate(ConnectionBase):
    """接続設定更新リクエスト（パスワード省略可）"""
    password: Optional[str] = None  # 省略時は変更しない
    ssh_password: Optional[str] = None


class ConnectionResponse(ConnectionBase):
    """接続設定レスポンス（パスワードは含まない）"""
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConnectionTestResult(BaseModel):
    success: bool
    message: str
    latency_ms: Optional[int] = None


# ============================================================
# 差分比較スキーマ
# ============================================================

DiffAlgorithm = Literal["myers", "patience", "histogram", "greedy_lcs", "set_based", "ast_based"]


class TableDiffRequest(BaseModel):
    left_connection_id: int
    right_connection_id: int


class RecordDiffRequest(BaseModel):
    left_connection_id: int
    right_connection_id: int
    table_name: str
    primary_keys: Optional[list[str]] = None
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=1000, ge=1, le=10000)


class RecordDiffJobRequest(BaseModel):
    """バックグラウンドジョブとしてレコード差分を計算するリクエスト"""
    left_connection_id: int
    right_connection_id: int
    table_name: str
    primary_keys: Optional[list[str]] = None
    algorithm: DiffAlgorithm = "set_based"
    batch_size: int = Field(default=1000, ge=100, le=50000)


class SchemaDiffRequest(BaseModel):
    left_connection_id: int
    right_connection_id: int
    table_name: str


# ============================================================
# 差分結果スキーマ
# ============================================================

DiffStatus = Literal["equal", "added", "deleted", "modified"]


class TableDiffSummary(BaseModel):
    columns_added: int = 0
    columns_deleted: int = 0
    columns_modified: int = 0


class TableDiffItem(BaseModel):
    status: DiffStatus
    left_table: Optional[str] = None
    right_table: Optional[str] = None
    diff_summary: Optional[TableDiffSummary] = None
    left_count: Optional[int] = None   # 近似レコード数（information_schema）
    right_count: Optional[int] = None  # 近似レコード数（information_schema）


class DiffSummaryStats(BaseModel):
    total: int
    equal: int
    added: int
    deleted: int
    modified: int


class TableDiffResult(BaseModel):
    tables: list[TableDiffItem]
    summary: DiffSummaryStats


class RecordDiffItem(BaseModel):
    status: DiffStatus
    primary_key_value: str
    left_values: Optional[dict] = None
    right_values: Optional[dict] = None
    diff_columns: list[str] = []


class RecordDiffResult(BaseModel):
    columns: list[str]
    records: list[RecordDiffItem]
    total_left: int
    total_right: int
    summary: DiffSummaryStats
    is_partial: bool = False
    partial_note: Optional[str] = None


class RecordDiffMeta(BaseModel):
    """差分計算完了後のメタ情報（レコード一覧は含まない・ページネーションで別取得）"""
    columns: list[str]
    total_left: int
    total_right: int
    summary: DiffSummaryStats
    is_partial: bool = False
    partial_note: Optional[str] = None


class RecordDiffPageResponse(BaseModel):
    """ページネーションによるレコード差分取得レスポンス"""
    records: list[RecordDiffItem]
    offset: int
    limit: int
    total: int
    columns: list[str]


class RecordDiffJobStatus(BaseModel):
    """バックグラウンドジョブのステータス（レコード一覧は result_meta のみ・本体は /result エンドポイントで取得）"""
    job_id: str
    status: str  # pending, running, done, cancelled, error
    phase: str   # pending, counting, fetching_left, fetching_right, computing, finalizing, done, cancelled, error
    left_progress: int = 0
    left_total: int = 0
    right_progress: int = 0
    right_total: int = 0
    compute_progress: int = 0
    compute_total: int = 0
    finalize_progress: int = 0  # finalizing フェーズ進捗
    finalize_total: int = 0     # finalizing フェーズ合計
    result_meta: Optional[RecordDiffMeta] = None  # レコードなし・サマリーのみ
    error: Optional[str] = None
    table_exists_left: bool = True   # 左DBにテーブルが存在するか
    table_exists_right: bool = True  # 右DBにテーブルが存在するか


class ColumnInfo(BaseModel):
    name: str
    type: str
    nullable: bool
    default_value: Optional[str] = None
    extra: str = ""
    comment: str = ""


class ColumnDiffItem(BaseModel):
    status: DiffStatus
    column_name: str
    left_column: Optional[ColumnInfo] = None
    right_column: Optional[ColumnInfo] = None
    changed_fields: list[str] = []


class IndexDiffItem(BaseModel):
    status: DiffStatus
    index_name: str
    left_index: Optional[dict] = None
    right_index: Optional[dict] = None


class SchemaDiffSummary(BaseModel):
    columns_added: int = 0
    columns_deleted: int = 0
    columns_modified: int = 0
    indexes_added: int = 0
    indexes_deleted: int = 0
    indexes_modified: int = 0


class SchemaDiffResult(BaseModel):
    columns: list[ColumnDiffItem]
    indexes: list[IndexDiffItem]
    summary: SchemaDiffSummary
