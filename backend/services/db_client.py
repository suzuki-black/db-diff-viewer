"""
DB クライアントディスパッチャー

Connection.db_type に応じて mysql_client または postgres_client の
関数を呼び出す薄いファサード。
呼び出し元は db_type を意識せずにこのモジュールだけをインポートすればよい。
"""
from typing import Any, Callable, Generator

from models import Connection


def _mysql(conn: Connection):
    from services import mysql_client
    return mysql_client


def _pg(conn: Connection):
    from services import postgres_client
    return postgres_client


def _client(conn: Connection):
    if getattr(conn, "db_type", "mysql") == "postgresql":
        return _pg(conn)
    return _mysql(conn)


def test_connection(conn: Connection) -> tuple[bool, str, int | None]:
    return _client(conn).test_connection(conn)


def get_table_names(conn: Connection) -> list[str]:
    return _client(conn).get_table_names(conn)


def get_column_definitions(conn: Connection, table_name: str) -> list[dict[str, Any]]:
    return _client(conn).get_column_definitions(conn, table_name)


def get_all_column_definitions(
    conn: Connection, table_names: list[str]
) -> dict[str, list[dict[str, Any]]]:
    """複数テーブルのカラム定義を1本の接続でまとめて取得する（SSH接続で特に有効）"""
    return _client(conn).get_all_column_definitions(conn, table_names)


def get_index_definitions(conn: Connection, table_name: str) -> list[dict[str, Any]]:
    return _client(conn).get_index_definitions(conn, table_name)


def get_primary_keys(conn: Connection, table_name: str) -> list[str]:
    return _client(conn).get_primary_keys(conn, table_name)


def fetch_records(
    conn: Connection,
    table_name: str,
    order_by_columns: list[str],
    offset: int = 0,
    limit: int = 1000,
) -> tuple[list[str], list[dict[str, Any]]]:
    return _client(conn).fetch_records(conn, table_name, order_by_columns, offset, limit)


def count_records(conn: Connection, table_name: str) -> int:
    return _client(conn).count_records(conn, table_name)


def get_table_row_counts(conn: Connection, table_names: list[str]) -> dict[str, int]:
    return _client(conn).get_table_row_counts(conn, table_names)


def stream_records(
    conn: Connection,
    table_name: str,
    order_by_columns: list[str],
    batch_size: int = 5000,
) -> Generator[tuple[list[str], list[dict[str, Any]]], None, None]:
    yield from _client(conn).stream_records(conn, table_name, order_by_columns, batch_size)


def fetch_all_records(
    conn: Connection,
    table_name: str,
    order_by_columns: list[str],
    batch_size: int = 1000,
    progress_callback: Callable[[int], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> tuple[list[str], list[dict[str, Any]], bool]:
    return _client(conn).fetch_all_records(
        conn, table_name, order_by_columns, batch_size, progress_callback, cancel_check
    )
