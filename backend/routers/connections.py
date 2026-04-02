"""
DB接続設定 CRUD API
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models import Connection
from schemas import (
    ConnectionCreate, ConnectionResponse, ConnectionTestResult, ConnectionUpdate,
)
from services.db_client import test_connection
from utils.crypto import encrypt

router = APIRouter()


def _get_or_404(db: Session, conn_id: int) -> Connection:
    conn = db.get(Connection, conn_id)
    if conn is None:
        raise HTTPException(status_code=404, detail=f"接続設定 ID={conn_id} が見つかりません")
    return conn


@router.get("", response_model=list[ConnectionResponse])
def list_connections(db: Session = Depends(get_db)):
    """接続設定一覧を取得"""
    return db.query(Connection).order_by(Connection.name).all()


@router.post("", response_model=ConnectionResponse, status_code=status.HTTP_201_CREATED)
def create_connection(body: ConnectionCreate, db: Session = Depends(get_db)):
    """接続設定を新規作成"""
    conn = Connection(
        name=body.name,
        db_type=body.db_type,
        host=body.host,
        port=body.port,
        username=body.username,
        password_enc=encrypt(body.password),
        schema_name=body.schema_name,
        use_ssh=body.use_ssh,
        ssh_host=body.ssh_host,
        ssh_port=body.ssh_port,
        ssh_username=body.ssh_username,
        ssh_auth_type=body.ssh_auth_type,
        ssh_password_enc=encrypt(body.ssh_password) if body.ssh_password else None,
        ssh_key_path=body.ssh_key_path,
        local_bind_port=body.local_bind_port,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    return conn


@router.get("/{conn_id}", response_model=ConnectionResponse)
def get_connection(conn_id: int, db: Session = Depends(get_db)):
    """接続設定を取得"""
    return _get_or_404(db, conn_id)


@router.put("/{conn_id}", response_model=ConnectionResponse)
def update_connection(conn_id: int, body: ConnectionUpdate, db: Session = Depends(get_db)):
    """接続設定を更新"""
    conn = _get_or_404(db, conn_id)

    conn.name = body.name
    conn.db_type = body.db_type
    conn.host = body.host
    conn.port = body.port
    conn.username = body.username
    conn.schema_name = body.schema_name
    conn.use_ssh = body.use_ssh
    conn.ssh_host = body.ssh_host
    conn.ssh_port = body.ssh_port
    conn.ssh_username = body.ssh_username
    conn.ssh_auth_type = body.ssh_auth_type
    conn.ssh_key_path = body.ssh_key_path
    conn.local_bind_port = body.local_bind_port

    # パスワードは入力があった場合のみ更新
    if body.password is not None:
        conn.password_enc = encrypt(body.password)
    if body.ssh_password is not None:
        conn.ssh_password_enc = encrypt(body.ssh_password)

    db.commit()
    db.refresh(conn)
    return conn


@router.delete("/{conn_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connection(conn_id: int, db: Session = Depends(get_db)):
    """接続設定を削除"""
    conn = _get_or_404(db, conn_id)
    db.delete(conn)
    db.commit()


@router.post("/{conn_id}/test", response_model=ConnectionTestResult)
def test_connection_endpoint(conn_id: int, db: Session = Depends(get_db)):
    """接続テストを実行"""
    conn = _get_or_404(db, conn_id)
    success, message, latency_ms = test_connection(conn)
    return ConnectionTestResult(success=success, message=message, latency_ms=latency_ms)
