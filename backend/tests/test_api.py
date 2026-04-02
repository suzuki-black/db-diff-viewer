"""
FastAPI エンドポイント テスト（DB接続なし・モック使用）
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# テスト用インメモリSQLiteを使用
TEST_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture(scope="module")
def client():
    """テスト用クライアント（インメモリDB使用）"""
    import os
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    os.environ["SECRET_KEY"] = "test_secret_key_for_testing_only"

    from database import Base, engine as real_engine
    from main import app
    from database import get_db

    # インメモリDB用エンジンを作成
    test_engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
    TestSession = sessionmaker(bind=test_engine)
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
        res = client.get("/api/connections")
        assert res.status_code == 200
        assert res.json() == []

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

    def _create_connection(self, client, name: str = "DB接続") -> int:
        payload = {
            "name": name, "host": "db_left", "port": 3306,
            "username": "testuser", "password": "testpass",
            "schema_name": "testdb_left", "use_ssh": False,
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
    @patch("routers.diff.get_column_definitions")
    def test_table_diff_success(self, mock_cols, mock_tables, client):
        """テーブル差分APIが正常に動作する"""
        left_id = self._create_connection(client, "左DB-mock")
        right_id = self._create_connection(client, "右DB-mock")

        # モック設定
        def mock_tables_side_effect(conn):
            if conn.schema_name == "testdb_left":
                return ["users", "legacy_logs"]
            return ["users", "notifications"]

        mock_tables.side_effect = mock_tables_side_effect
        mock_cols.return_value = [
            {"COLUMN_NAME": "id", "COLUMN_TYPE": "int", "IS_NULLABLE": "NO",
             "COLUMN_DEFAULT": None, "EXTRA": "auto_increment", "COLUMN_COMMENT": ""},
        ]

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
