"""
FastAPI エンドポイント テスト（DB接続なし・モック使用）
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# テスト用インメモリSQLiteを使用
TEST_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture(scope="module")
def client():
    """テスト用クライアント（インメモリDB使用）"""
    import os
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    os.environ["SECRET_KEY"] = "test_secret_key_for_testing_only"

    from database import Base, get_db
    from main import app
    import database, main as main_module

    # StaticPool を使い全接続で同じ in-memory DB を共有する
    # （StaticPool なしでは接続ごとに別インスタンスになりテーブルが見えない）
    test_engine = create_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestSession = sessionmaker(bind=test_engine)

    # database モジュールと main モジュールの engine / SessionLocal も差し替えて
    # lifespan（create_all, migrate, seed）が同じ in-memory DB を使うようにする
    database.engine = test_engine
    database.SessionLocal = TestSession
    main_module.engine = test_engine
    main_module.SessionLocal = TestSession

    Base.metadata.create_all(bind=test_engine)

    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


class TestHealthCheck:
    def test_health(self, client):
        res = client.get("/api/health")
        assert res.status_code == 200
        assert res.json()["status"] == "ok"


class TestConnectionsCRUD:
    """接続設定CRUD APIのテスト"""

    PAYLOAD = {
        "name": "テスト接続",
        "host": "localhost",
        "port": 3306,
        "username": "testuser",
        "password": "testpass",
        "schema_name": "testdb",
        "use_ssh": False,
    }

    def test_list_empty(self, client):
        # lifespan がシード接続を自動登録するため空ではなく、リストが返ることを確認
        res = client.get("/api/connections")
        assert res.status_code == 200
        assert isinstance(res.json(), list)

    def test_create(self, client):
        res = client.post("/api/connections", json=self.PAYLOAD)
        assert res.status_code == 201
        data = res.json()
        assert data["name"] == "テスト接続"
        assert data["schema_name"] == "testdb"
        assert "id" in data
        # パスワードはレスポンスに含まれない
        assert "password" not in data
        assert "password_enc" not in data

    def test_list_after_create(self, client):
        res = client.get("/api/connections")
        assert res.status_code == 200
        assert len(res.json()) >= 1

    def test_get(self, client):
        # まず作成
        create_res = client.post("/api/connections", json={**self.PAYLOAD, "name": "取得テスト"})
        conn_id = create_res.json()["id"]
        # 取得
        res = client.get(f"/api/connections/{conn_id}")
        assert res.status_code == 200
        assert res.json()["id"] == conn_id

    def test_get_not_found(self, client):
        res = client.get("/api/connections/99999")
        assert res.status_code == 404

    def test_update(self, client):
        create_res = client.post("/api/connections", json={**self.PAYLOAD, "name": "更新前"})
        conn_id = create_res.json()["id"]
        # 更新
        res = client.put(f"/api/connections/{conn_id}", json={**self.PAYLOAD, "name": "更新後"})
        assert res.status_code == 200
        assert res.json()["name"] == "更新後"

    def test_delete(self, client):
        create_res = client.post("/api/connections", json={**self.PAYLOAD, "name": "削除テスト"})
        conn_id = create_res.json()["id"]
        # 削除
        res = client.delete(f"/api/connections/{conn_id}")
        assert res.status_code == 204
        # 存在しないことを確認
        get_res = client.get(f"/api/connections/{conn_id}")
        assert get_res.status_code == 404

    def test_create_ssh(self, client):
        """SSH設定付き接続設定の作成"""
        payload = {
            **self.PAYLOAD,
            "name": "SSH接続テスト",
            "use_ssh": True,
            "ssh_host": "bastion.example.com",
            "ssh_port": 22,
            "ssh_username": "ec2-user",
            "ssh_auth_type": "key",
            "ssh_key_path": "/ssh_keys/id_rsa",
            "local_bind_port": 0,
        }
        res = client.post("/api/connections", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["use_ssh"] is True
        assert data["ssh_host"] == "bastion.example.com"


class TestDiffAPI:
    """差分比較APIのテスト（MySQL接続をモック）"""

    def _create_connection(self, client, name: str = "DB接続", schema: str = "testdb_left") -> int:
        payload = {
            "name": name, "host": "db_left", "port": 3306,
            "username": "testuser", "password": "testpass",
            "schema_name": schema, "use_ssh": False,
        }
        return client.post("/api/connections", json=payload).json()["id"]

    def test_table_diff_not_found(self, client):
        """存在しない接続IDを指定した場合は404"""
        res = client.post("/api/diff/tables", json={
            "left_connection_id": 99998,
            "right_connection_id": 99999,
        })
        assert res.status_code == 404

    @patch("routers.diff.get_table_names")
    @patch("routers.diff.get_all_column_definitions")
    def test_table_diff_success(self, mock_all_cols, mock_tables, client):
        """テーブル差分APIが正常に動作する"""
        left_id = self._create_connection(client, "左DB-mock", schema="testdb_left")
        right_id = self._create_connection(client, "右DB-mock", schema="testdb_right")

        # モック設定
        def mock_tables_side_effect(conn):
            if conn.schema_name == "testdb_left":
                return ["users", "legacy_logs"]
            return ["users", "notifications"]

        mock_tables.side_effect = mock_tables_side_effect
        # get_all_column_definitions は {テーブル名: [カラム定義...]} を返す
        mock_all_cols.return_value = {
            "users": [
                {"COLUMN_NAME": "id", "COLUMN_TYPE": "int", "IS_NULLABLE": "NO",
                 "COLUMN_DEFAULT": None, "EXTRA": "auto_increment", "COLUMN_COMMENT": ""},
            ]
        }

        res = client.post("/api/diff/tables", json={
            "left_connection_id": left_id,
            "right_connection_id": right_id,
        })
        assert res.status_code == 200
        data = res.json()
        assert "tables" in data
        assert "summary" in data

        statuses = {(t.get("left_table") or t.get("right_table")): t["status"]
                    for t in data["tables"]}
        assert statuses["users"] == "equal"
        assert statuses["legacy_logs"] == "deleted"
        assert statuses["notifications"] == "added"


class TestConnectionExportImport:
    """エクスポート / インポート API のテスト"""

    PAYLOAD = {
        "name": "エクスポートテスト接続",
        "host": "localhost",
        "port": 5432,
        "username": "pguser",
        "password": "pgpass",
        "schema_name": "mydb",
        "db_type": "postgresql",
        "use_ssh": False,
    }

    def test_export_empty(self, client):
        """接続設定が0件のときエクスポートは空リスト"""
        # 既存の接続を把握するため件数だけ確認
        res = client.get("/api/connections/export")
        assert res.status_code == 200
        data = res.json()
        assert "connections" in data
        assert "exported_at" in data
        assert isinstance(data["connections"], list)

    def test_export_contains_created_connection(self, client):
        """作成した接続がエクスポートに含まれる"""
        client.post("/api/connections", json=self.PAYLOAD)
        res = client.get("/api/connections/export")
        assert res.status_code == 200
        names = [c["name"] for c in res.json()["connections"]]
        assert "エクスポートテスト接続" in names

    def test_export_does_not_contain_password(self, client):
        """エクスポートにパスワードが含まれない"""
        res = client.get("/api/connections/export")
        for c in res.json()["connections"]:
            assert "password" not in c

    def test_import_creates_new_connections(self, client):
        """インポートで新規接続が作成される"""
        body = {
            "connections": [
                {
                    "name": "インポート接続A",
                    "db_type": "mysql",
                    "host": "db-host",
                    "port": 3306,
                    "username": "user",
                    "schema_name": "db",
                    "use_ssh": False,
                }
            ]
        }
        res = client.post("/api/connections/import", json=body)
        assert res.status_code == 200
        data = res.json()
        assert data["created"] >= 1
        assert data["skipped"] == 0

    def test_import_skips_duplicate_names(self, client):
        """同名接続は重複スキップされる"""
        body = {
            "connections": [
                {
                    "name": "インポート接続B",
                    "db_type": "mysql",
                    "host": "db-host",
                    "port": 3306,
                    "username": "user",
                    "schema_name": "db",
                    "use_ssh": False,
                }
            ]
        }
        # 1回目: 作成
        client.post("/api/connections/import", json=body)
        # 2回目: 重複スキップ
        res = client.post("/api/connections/import", json=body)
        assert res.status_code == 200
        data = res.json()
        assert data["skipped"] >= 1
        assert "インポート接続B" in data["skipped_names"]

    def test_import_empty_list(self, client):
        """空リストのインポートは created=0, skipped=0"""
        res = client.post("/api/connections/import", json={"connections": []})
        assert res.status_code == 200
        data = res.json()
        assert data["created"] == 0
        assert data["skipped"] == 0


class TestConnectionTestEndpoint:
    """接続テスト API のテスト"""

    PAYLOAD = {
        "name": "接続テスト用",
        "host": "localhost",
        "port": 3306,
        "username": "user",
        "password": "pass",
        "schema_name": "testdb",
        "use_ssh": False,
    }

    def test_connection_test_not_found(self, client):
        """存在しない接続IDで接続テストすると 404"""
        res = client.post("/api/connections/99997/test")
        assert res.status_code == 404

    @pytest.mark.usefixtures("client")
    def test_connection_test_returns_result(self, client):
        """接続テストエンドポイントが success/message を返す（DB接続失敗でも 200）"""
        from unittest.mock import patch
        create_res = client.post("/api/connections", json=self.PAYLOAD)
        conn_id = create_res.json()["id"]

        with patch("routers.connections.test_connection") as mock_test:
            mock_test.return_value = (True, "接続成功", 12)
            res = client.post(f"/api/connections/{conn_id}/test")

        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert "message" in data

    def test_connection_test_failure_mocked(self, client):
        """接続失敗時も 200 で failure 結果を返す"""
        from unittest.mock import patch
        create_res = client.post("/api/connections", json=self.PAYLOAD)
        conn_id = create_res.json()["id"]

        with patch("routers.connections.test_connection") as mock_test:
            mock_test.return_value = (False, "接続拒否", None)
            res = client.post(f"/api/connections/{conn_id}/test")

        assert res.status_code == 200
        data = res.json()
        assert data["success"] is False


class TestConnectionsPostgresql:
    """PostgreSQL 接続設定のテスト"""

    def test_create_postgresql_connection(self, client):
        """PostgreSQL 接続設定を作成できる"""
        payload = {
            "name": "PostgreSQL接続",
            "db_type": "postgresql",
            "host": "pg-host",
            "port": 5432,
            "username": "pguser",
            "password": "pgpass",
            "schema_name": "pgdb",
            "use_ssh": False,
        }
        res = client.post("/api/connections", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["db_type"] == "postgresql"
        assert data["port"] == 5432
