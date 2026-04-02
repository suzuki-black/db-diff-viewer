"""
SQLAlchemy データベース設定（接続設定の永続化用 SQLite）
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:////app/data/dbdiff.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # SQLite のスレッドチェックを無効化
    echo=os.getenv("DEBUG", "false").lower() == "true",
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI の Depends() 用 DB セッションジェネレーター"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
