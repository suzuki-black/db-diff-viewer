"""
SQLAlchemy ORM モデル
"""
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Connection(Base):
    """DB接続設定モデル"""
    __tablename__ = "connections"

    id             = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name           = Column(String(100), nullable=False)
    db_type        = Column(String(20), nullable=False, default="mysql")  # 'mysql' or 'postgresql'

    # DB接続情報
    host           = Column(String(255), nullable=False)
    port           = Column(Integer, nullable=False, default=3306)
    username       = Column(String(100), nullable=False)
    password_enc   = Column(Text, nullable=False)         # AES-256 暗号化済み
    schema_name    = Column(String(255), nullable=False)

    # SSHポートフォワード設定
    use_ssh        = Column(Boolean, nullable=False, default=False)
    ssh_host       = Column(String(255), nullable=True)
    ssh_port       = Column(Integer, nullable=True, default=22)
    ssh_username   = Column(String(100), nullable=True)
    ssh_auth_type  = Column(String(20), nullable=True)    # 'password' or 'key'
    ssh_password_enc = Column(Text, nullable=True)        # AES-256 暗号化済み
    ssh_key_path   = Column(String(500), nullable=True)
    local_bind_port = Column(Integer, nullable=True, default=0)

    # メタ情報
    created_at     = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at     = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
