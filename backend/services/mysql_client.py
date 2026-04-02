"""
MySQL接続・クエリ実行サービス
"""
import logging
import time
from contextlib import contextmanager
from typing import Any, Callable, Generator

import pymysql
import pymysql.cursors

from models import Connection
from services.ssh_tunnel import ssh_tunnel_context
from utils.crypto import decrypt

logger = logging.getLogger(__name__)


@contextmanager
def mysql_connection(
    conn: Connection,
) -> Generator[pymysql.Connection, None, None]:
    """
    MySQL接続を確立するコンテキストマネージャー
    SSHトンネルが必要な場合はトンネルも同時に管理する

    Args:
        conn: Connection モデル

    Yields:
        pymysql.Connection オブジェクト
    """
    password = decrypt(conn.password_enc)

    with ssh_tunnel_context(conn) as (host, port):
        logger.info("MySQL接続中: %s@%s:%d/%s", conn.username, host, port, conn.schema_name)
        db = pymysql.connect(
            host=host,
            port=port,
            user=conn.username,
            password=password,
            database=conn.schema_name,
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=10,
            read_timeout=60,
            write_timeout=60,
        )
        try:
            yield db
        finally:
            db.close()


def test_connection(conn: Connection) -> tuple[bool, str, int | None]:
    """
    接続テストを実行する

    Returns:
        (success, message, latency_ms)
    """
    start = time.monotonic()
    try:
        with mysql_connection(conn) as db:
            with db.cursor() as cur:
                cur.execute("SELECT 1")
        latency_ms = int((time.monotonic() - start) * 1000)
        return True, "接続成功", latency_ms
    except Exception as e:
        return False, str(e), None


def get_table_names(conn: Connection) -> list[str]:
    """スキーマ内のテーブル名一覧を取得する"""
    with mysql_connection(conn) as db:
        with db.cursor() as cur:
            cur.execute(
                """
                SELECT TABLE_NAME
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = %s
                  AND TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_NAME
                """,
                (conn.schema_name,),
            )
            rows = cur.fetchall()
    return [row["TABLE_NAME"] for row in rows]


def get_column_definitions(conn: Connection, table_name: str) -> list[dict[str, Any]]:
    """テーブルのカラム定義一覧を取得する"""
    with mysql_connection(conn) as db:
        with db.cursor() as cur:
            cur.execute(
                """
                SELECT
                    COLUMN_NAME,
                    ORDINAL_POSITION,
                    COLUMN_DEFAULT,
                    IS_NULLABLE,
                    DATA_TYPE,
                    COLUMN_TYPE,
                    CHARACTER_MAXIMUM_LENGTH,
                    NUMERIC_PRECISION,
                    NUMERIC_SCALE,
                    EXTRA,
                    COLUMN_COMMENT,
                    COLUMN_KEY
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
                ORDER BY ORDINAL_POSITION
                """,
                (conn.schema_name, table_name),
            )
            return cur.fetchall()


def get_all_column_definitions(
    conn: Connection, table_names: list[str]
) -> dict[str, list[dict[str, Any]]]:
    """複数テーブルのカラム定義を1回の接続（1本のSSHトンネル）でまとめて取得する。"""
    if not table_names:
        return {}
    result: dict[str, list[dict[str, Any]]] = {}
    with mysql_connection(conn) as db:
        for table_name in table_names:
            with db.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        COLUMN_NAME,
                        ORDINAL_POSITION,
                        COLUMN_DEFAULT,
                        IS_NULLABLE,
                        DATA_TYPE,
                        COLUMN_TYPE,
                        CHARACTER_MAXIMUM_LENGTH,
                        NUMERIC_PRECISION,
                        NUMERIC_SCALE,
                        EXTRA,
                        COLUMN_COMMENT,
                        COLUMN_KEY
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
                    ORDER BY ORDINAL_POSITION
                    """,
                    (conn.schema_name, table_name),
                )
                result[table_name] = cur.fetchall()
    return result


def get_index_definitions(conn: Connection, table_name: str) -> list[dict[str, Any]]:
    """テーブルのインデックス情報を取得する"""
    with mysql_connection(conn) as db:
        with db.cursor() as cur:
            cur.execute(
                """
                SELECT
                    INDEX_NAME,
                    NON_UNIQUE,
                    SEQ_IN_INDEX,
                    COLUMN_NAME,
                    INDEX_TYPE
                FROM INFORMATION_SCHEMA.STATISTICS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
                ORDER BY INDEX_NAME, SEQ_IN_INDEX
                """,
                (conn.schema_name, table_name),
            )
            return cur.fetchall()


def get_primary_keys(conn: Connection, table_name: str) -> list[str]:
    """テーブルの主キーカラム名一覧を取得する"""
    with mysql_connection(conn) as db:
        with db.cursor() as cur:
            cur.execute(
                """
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = %s
                  AND TABLE_NAME = %s
                  AND CONSTRAINT_NAME = 'PRIMARY'
                ORDER BY ORDINAL_POSITION
                """,
                (conn.schema_name, table_name),
            )
            rows = cur.fetchall()
    return [row["COLUMN_NAME"] for row in rows]


def fetch_records(
    conn: Connection,
    table_name: str,
    order_by_columns: list[str],
    offset: int = 0,
    limit: int = 1000,
) -> tuple[list[str], list[dict[str, Any]]]:
    """
    テーブルのレコードを取得する

    Returns:
        (columns, records)
    """
    order_clause = ", ".join(f"`{c}`" for c in order_by_columns) if order_by_columns else "1"
    with mysql_connection(conn) as db:
        with db.cursor() as cur:
            cur.execute(
                f"SELECT * FROM `{table_name}` ORDER BY {order_clause} LIMIT %s OFFSET %s",
                (limit, offset),
            )
            rows = cur.fetchall()
            columns = [desc[0] for desc in cur.description] if cur.description else []
    return columns, rows


def count_records(conn: Connection, table_name: str) -> int:
    """テーブルのレコード数を取得する"""
    with mysql_connection(conn) as db:
        with db.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) as cnt FROM `{table_name}`")
            row = cur.fetchone()
    return row["cnt"] if row else 0


def get_table_row_counts(conn: Connection, table_names: list[str]) -> dict[str, int]:
    """テーブルのレコード数を information_schema から一括取得する（高速・近似値）"""
    if not table_names:
        return {}
    with mysql_connection(conn) as db:
        with db.cursor() as cur:
            placeholders = ",".join(["%s"] * len(table_names))
            cur.execute(
                f"SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES "
                f"WHERE TABLE_SCHEMA = %s AND TABLE_NAME IN ({placeholders})",
                [conn.schema_name] + list(table_names),
            )
            rows = cur.fetchall()
    return {row["TABLE_NAME"]: int(row["TABLE_ROWS"] or 0) for row in rows}


def stream_records(
    conn: Connection,
    table_name: str,
    order_by_columns: list[str],
    batch_size: int = 5000,
) -> Generator[tuple[list[str], list[dict[str, Any]]], None, None]:
    """
    テーブルのレコードをバッチ単位でストリーミング取得するジェネレータ。
    全レコードをメモリに蓄積しないため、大規模テーブルでもメモリを節約できる。

    単一カラムのソートキーの場合はキーセットページネーション（WHERE pk > last）を使用し、
    OFFSET ページネーションより大幅に高速になる（O(log n) vs O(n²)）。

    Yields:
        (columns, batch_rows)
    """
    columns: list[str] = []

    with mysql_connection(conn) as db:
        if len(order_by_columns) == 1:
            # キーセットページネーション（単一PKの場合）
            pk_col = order_by_columns[0]
            last_val: Any = None
            while True:
                with db.cursor() as cur:
                    if last_val is None:
                        cur.execute(
                            f"SELECT * FROM `{table_name}` ORDER BY `{pk_col}` ASC LIMIT %s",
                            (batch_size,),
                        )
                    else:
                        cur.execute(
                            f"SELECT * FROM `{table_name}` WHERE `{pk_col}` > %s"
                            f" ORDER BY `{pk_col}` ASC LIMIT %s",
                            (last_val, batch_size),
                        )
                    rows = cur.fetchall()
                    if cur.description and not columns:
                        columns = [desc[0] for desc in cur.description]
                if not rows:
                    break
                last_val = rows[-1][pk_col]
                yield columns, rows
                if len(rows) < batch_size:
                    break
        else:
            # OFFSETページネーション（複合PKなどの場合のフォールバック）
            order_clause = ", ".join(f"`{c}`" for c in order_by_columns)
            offset = 0
            while True:
                with db.cursor() as cur:
                    cur.execute(
                        f"SELECT * FROM `{table_name}` ORDER BY {order_clause} LIMIT %s OFFSET %s",
                        (batch_size, offset),
                    )
                    rows = cur.fetchall()
                    if cur.description and not columns:
                        columns = [desc[0] for desc in cur.description]
                if not rows:
                    break
                offset += len(rows)
                yield columns, rows
                if len(rows) < batch_size:
                    break


def fetch_all_records(
    conn: Connection,
    table_name: str,
    order_by_columns: list[str],
    batch_size: int = 1000,
    progress_callback: Callable[[int], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> tuple[list[str], list[dict[str, Any]], bool]:
    """
    テーブルの全レコードをバッチ処理で取得する

    Args:
        conn: DB接続設定
        table_name: テーブル名
        order_by_columns: ソート列（主キー）
        batch_size: 1バッチあたりの取得件数
        progress_callback: 取得件数を受け取るコールバック（オプション）
        cancel_check: キャンセル要求を確認するコールバック（オプション）

    Returns:
        (columns, records, cancelled)
        cancelled=True の場合は取得途中でキャンセルされた
    """
    order_clause = ", ".join(f"`{c}`" for c in order_by_columns) if order_by_columns else "1"
    all_records: list[dict[str, Any]] = []
    columns: list[str] = []
    offset = 0

    with mysql_connection(conn) as db:
        while True:
            if cancel_check and cancel_check():
                return columns, all_records, True

            with db.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM `{table_name}` ORDER BY {order_clause} LIMIT %s OFFSET %s",
                    (batch_size, offset),
                )
                rows = cur.fetchall()
                if cur.description and not columns:
                    columns = [desc[0] for desc in cur.description]

            if not rows:
                break

            all_records.extend(rows)
            offset += len(rows)
            if progress_callback:
                progress_callback(len(all_records))

            if len(rows) < batch_size:
                break

    return columns, all_records, False
