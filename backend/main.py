"""
DB Diff Viewer - FastAPI アプリケーション エントリポイント
"""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import engine, Base, SessionLocal
from models import Connection
from utils.crypto import encrypt
from utils.json_logger import configure_logging
from routers import connections, diff


def _migrate_add_missing_columns() -> None:
    """
    既存の SQLite DB に新規カラムを追加する簡易マイグレーション。
    ALTER TABLE は既存カラムがある場合にエラーになるため、
    カラム存在チェック後にのみ実行する。
    """
    with engine.connect() as raw:
        result = raw.exec_driver_sql("PRAGMA table_info(connections)")
        existing = {row[1] for row in result.fetchall()}  # row[1] = name

    migrations = [
        ("db_type", "ALTER TABLE connections ADD COLUMN db_type VARCHAR(20) NOT NULL DEFAULT 'mysql'"),
    ]
    with engine.connect() as raw:
        for col_name, sql in migrations:
            if col_name not in existing:
                raw.exec_driver_sql(sql)
                raw.commit()


# ── テスト用接続のシード定義 ────────────────────────────────
_SEED_CONNECTIONS = [
    # ── MySQL ──────────────────────────────────────────────────
    dict(
        name        = "テスト用MySQL DB（左）",
        db_type     = "mysql",
        host        = "db_left",
        port        = 3306,
        username    = "testuser",
        password    = "testpass",
        schema_name = "testdb_left",
    ),
    dict(
        name        = "テスト用MySQL DB（右）",
        db_type     = "mysql",
        host        = "db_right",
        port        = 3306,
        username    = "testuser",
        password    = "testpass",
        schema_name = "testdb_right",
    ),
    dict(
        name             = "テスト用MySQL DB（SSHトンネル経由）",
        db_type          = "mysql",
        host             = "db_ssh_target",
        port             = 3306,
        username         = "testuser",
        password         = "testpass",
        schema_name      = "testdb_ssh",
        use_ssh          = True,
        ssh_host         = "ssh_server",
        ssh_port         = 22,
        ssh_username     = "sshuser",
        ssh_auth_type    = "key",
        ssh_key_path     = "/ssh_keys/test_key",
        local_bind_port  = 0,
    ),
    # ── PostgreSQL ────────────────────────────────────────────
    dict(
        name        = "テスト用PostgreSQL DB（左）",
        db_type     = "postgresql",
        host        = "pg_left",
        port        = 5432,
        username    = "testuser",
        password    = "testpass",
        schema_name = "testdb_pg_left",
    ),
    dict(
        name        = "テスト用PostgreSQL DB（右）",
        db_type     = "postgresql",
        host        = "pg_right",
        port        = 5432,
        username    = "testuser",
        password    = "testpass",
        schema_name = "testdb_pg_right",
    ),
    dict(
        name             = "テスト用PostgreSQL DB（SSHトンネル経由）",
        db_type          = "postgresql",
        host             = "pg_ssh_target",
        port             = 5432,
        username         = "testuser",
        password         = "testpass",
        schema_name      = "testdb_pg_ssh",
        use_ssh          = True,
        ssh_host         = "ssh_server",
        ssh_port         = 22,
        ssh_username     = "sshuser",
        ssh_auth_type    = "key",
        ssh_key_path     = "/ssh_keys/test_key",
        local_bind_port  = 0,
    ),
]


def _seed_test_connections() -> None:
    """
    接続設定がひとつも登録されていない場合に限り、
    Docker Compose のテスト用DB3件を自動登録する。
    既に1件以上存在する場合は何もしない（再起動時の二重登録防止）。
    """
    db = SessionLocal()
    try:
        existing_names = {c.name for c in db.query(Connection.name).all()}
        seeds_to_add = [s for s in _SEED_CONNECTIONS if s["name"] not in existing_names]
        if not seeds_to_add:
            return  # 全シード登録済み
        for seed in seeds_to_add:
            ssh_password = seed.get("ssh_password")
            conn = Connection(
                name              = seed["name"],
                db_type           = seed.get("db_type", "mysql"),
                host              = seed["host"],
                port              = seed["port"],
                username          = seed["username"],
                password_enc      = encrypt(seed["password"]),
                schema_name       = seed["schema_name"],
                use_ssh           = seed.get("use_ssh", False),
                ssh_host          = seed.get("ssh_host"),
                ssh_port          = seed.get("ssh_port", 22),
                ssh_username      = seed.get("ssh_username"),
                ssh_auth_type     = seed.get("ssh_auth_type"),
                ssh_password_enc  = encrypt(ssh_password) if ssh_password else None,
                ssh_key_path      = seed.get("ssh_key_path"),
                local_bind_port   = seed.get("local_bind_port", 0),
            )
            db.add(conn)
        db.commit()
    finally:
        db.close()


# ── ライフサイクル ───────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # JSON 構造化ログを設定（環境変数 LOG_LEVEL で変更可。デフォルト INFO）
    configure_logging(level=os.environ.get("LOG_LEVEL", "INFO"))
    Base.metadata.create_all(bind=engine)
    _migrate_add_missing_columns()
    _seed_test_connections()
    yield


app = FastAPI(
    title="DB Diff Viewer API",
    version="1.0.0",
    description="MySQLデータベース間の差分を比較するREST API",
    lifespan=lifespan,
)

# CORS設定（Docker内部ネットワーク向け・開発時も考慮）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 本番環境では必要に応じて制限すること
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ルーターの登録
app.include_router(connections.router, prefix="/api/connections", tags=["connections"])
app.include_router(diff.router, prefix="/api/diff", tags=["diff"])


@app.get("/api/health", tags=["health"])
def health_check():
    """ヘルスチェックエンドポイント（Docker healthcheck用）"""
    return {"status": "ok", "version": "1.0.0"}
