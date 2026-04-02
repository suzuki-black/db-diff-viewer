"""
PostgreSQL接続・クエリ実行サービス

mysql_client.py と同じ関数シグネチャを持ち、
カラムメタデータは diff_engine.py が期待する MySQL 互換のキー名
（COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT,
 INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, INDEX_TYPE）で返す。
"""
import logging
import time
from contextlib import contextmanager
from typing import Any, Callable, Generator

import psycopg2
import psycopg2.extras

from models import Connection
from services.ssh_tunnel import ssh_tunnel_context
from utils.crypto import decrypt

logger = logging.getLogger(__name__)


@contextmanager
def pg_connection(
    conn: Connection,
) -> Generator[psycopg2.extensions.connection, None, None]:
    """
    PostgreSQL接続を確立するコンテキストマネージャー
    """
    password = decrypt(conn.password_enc)

    with ssh_tunnel_context(conn) as (host, port):
        logger.info("PostgreSQL接続中: %s@%s:%d/%s", conn.username, host, port, conn.schema_name)
        db = psycopg2.connect(
            host=host,
            port=port,
            user=conn.username,
            password=password,
            dbname=conn.schema_name,
            connect_timeout=10,
            options="-c statement_timeout=60000",
        )
        db.autocommit = True
        try:
            yield db
        finally:
            db.close()


def _quote(name: str) -> str:
    """PostgreSQL用の識別子クォート（ダブルクォート）"""
    return f'"{name}"'


def test_connection(conn: Connection) -> tuple[bool, str, int | None]:
    """接続テストを実行する"""
    start = time.monotonic()
    try:
        with pg_connection(conn) as db:
            with db.cursor() as cur:
                cur.execute("SELECT 1")
        latency_ms = int((time.monotonic() - start) * 1000)
        return True, "接続成功", latency_ms
    except Exception as e:
        return False, str(e), None


def get_table_names(conn: Connection) -> list[str]:
    """スキーマ内のテーブル名一覧を取得する"""
    # PostgreSQLでは schema_name をデータベース名として接続し、schema は public を使用
    schema = "public"
    with pg_connection(conn) as db:
        with db.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = %s
                  AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """,
                (schema,),
            )
            rows = cur.fetchall()
    return [row["table_name"] for row in rows]


def get_column_definitions(conn: Connection, table_name: str) -> list[dict[str, Any]]:
    """テーブルのカラム定義一覧を取得する（MySQL互換キー名で返す）"""
    schema = "public"
    with pg_connection(conn) as db:
        # RealDictCursor を避け、通常カーソル + cur.description で辞書を構築する。
        # psycopg2 の RealDictCursor は複雑な LEFT JOIN クエリで
        # "tuple index out of range" を引き起こすことがある。
        with db.cursor() as cur:
            cur.execute(
                """
                SELECT
                    c.column_name                              AS "COLUMN_NAME",
                    c.ordinal_position                        AS "ORDINAL_POSITION",
                    c.column_default                          AS "COLUMN_DEFAULT",
                    c.is_nullable                             AS "IS_NULLABLE",
                    c.data_type                               AS "DATA_TYPE",
                    c.udt_name                                AS "COLUMN_TYPE",
                    c.character_maximum_length                AS "CHARACTER_MAXIMUM_LENGTH",
                    c.numeric_precision                       AS "NUMERIC_PRECISION",
                    c.numeric_scale                           AS "NUMERIC_SCALE",
                    CASE
                        WHEN c.is_generated = 'ALWAYS' THEN 'GENERATED ALWAYS'
                        WHEN c.column_default LIKE 'nextval(%%' THEN 'auto_increment'
                        ELSE ''
                    END                                       AS "EXTRA",
                    ''::text                                  AS "COLUMN_COMMENT",
                    CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END AS "COLUMN_KEY"
                FROM information_schema.columns c
                LEFT JOIN (
                    SELECT kcu.column_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                      ON tc.constraint_name = kcu.constraint_name
                     AND tc.table_schema    = kcu.table_schema
                     AND tc.table_name      = kcu.table_name
                    WHERE tc.constraint_type = 'PRIMARY KEY'
                      AND tc.table_schema = %s
                      AND tc.table_name   = %s
                ) pk ON pk.column_name = c.column_name
                WHERE c.table_schema = %s
                  AND c.table_name   = %s
                ORDER BY c.ordinal_position
                """,
                (schema, table_name, schema, table_name),
            )
            col_names = [d.name for d in (cur.description or [])]
            return [dict(zip(col_names, row)) for row in cur.fetchall()]


def get_all_column_definitions(
    conn: Connection, table_names: list[str]
) -> dict[str, list[dict[str, Any]]]:
    """複数テーブルのカラム定義を1回の接続（1本のSSHトンネル）でまとめて取得する。
    SSH接続の場合、テーブルごとにトンネルを開閉する get_column_definitions を
    ループで呼ぶより大幅に高速・安定する。"""
    if not table_names:
        return {}
    schema = "public"
    result: dict[str, list[dict[str, Any]]] = {}
    with pg_connection(conn) as db:
        for table_name in table_names:
            with db.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        c.column_name                              AS "COLUMN_NAME",
                        c.ordinal_position                        AS "ORDINAL_POSITION",
                        c.column_default                          AS "COLUMN_DEFAULT",
                        c.is_nullable                             AS "IS_NULLABLE",
                        c.data_type                               AS "DATA_TYPE",
                        c.udt_name                                AS "COLUMN_TYPE",
                        c.character_maximum_length                AS "CHARACTER_MAXIMUM_LENGTH",
                        c.numeric_precision                       AS "NUMERIC_PRECISION",
                        c.numeric_scale                           AS "NUMERIC_SCALE",
                        CASE
                            WHEN c.is_generated = 'ALWAYS' THEN 'GENERATED ALWAYS'
                            WHEN c.column_default LIKE 'nextval(%%' THEN 'auto_increment'
                            ELSE ''
                        END                                       AS "EXTRA",
                        ''::text                                  AS "COLUMN_COMMENT",
                        CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END AS "COLUMN_KEY"
                    FROM information_schema.columns c
                    LEFT JOIN (
                        SELECT kcu.column_name
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage kcu
                          ON tc.constraint_name = kcu.constraint_name
                         AND tc.table_schema    = kcu.table_schema
                         AND tc.table_name      = kcu.table_name
                        WHERE tc.constraint_type = 'PRIMARY KEY'
                          AND tc.table_schema = %s
                          AND tc.table_name   = %s
                    ) pk ON pk.column_name = c.column_name
                    WHERE c.table_schema = %s
                      AND c.table_name   = %s
                    ORDER BY c.ordinal_position
                    """,
                    (schema, table_name, schema, table_name),
                )
                col_names = [d.name for d in (cur.description or [])]
                result[table_name] = [dict(zip(col_names, row)) for row in cur.fetchall()]
    return result


def get_index_definitions(conn: Connection, table_name: str) -> list[dict[str, Any]]:
    """テーブルのインデックス情報を取得する（MySQL互換キー名で返す）"""
    schema = "public"
    with pg_connection(conn) as db:
        with db.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    i.relname                                   AS "INDEX_NAME",
                    CASE WHEN ix.indisunique THEN 0 ELSE 1 END  AS "NON_UNIQUE",
                    gs.seq                                       AS "SEQ_IN_INDEX",
                    a.attname                                    AS "COLUMN_NAME",
                    am.amname                                    AS "INDEX_TYPE"
                FROM pg_index ix
                JOIN pg_class t  ON t.oid = ix.indrelid
                JOIN pg_class i  ON i.oid = ix.indexrelid
                JOIN pg_am    am ON am.oid = i.relam
                JOIN pg_namespace n ON n.oid = t.relnamespace
                JOIN LATERAL generate_subscripts(ix.indkey, 1) WITH ORDINALITY gs(idx, seq)
                  ON TRUE
                JOIN pg_attribute a
                  ON a.attrelid = t.oid
                 AND a.attnum   = ix.indkey[gs.idx]
                WHERE n.nspname = %s
                  AND t.relname = %s
                ORDER BY i.relname, gs.seq
                """,
                (schema, table_name),
            )
            return [dict(row) for row in cur.fetchall()]


def get_primary_keys(conn: Connection, table_name: str) -> list[str]:
    """テーブルの主キーカラム名一覧を取得する"""
    schema = "public"
    with pg_connection(conn) as db:
        with db.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema    = kcu.table_schema
                 AND tc.table_name      = kcu.table_name
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_schema = %s
                  AND tc.table_name   = %s
                ORDER BY kcu.ordinal_position
                """,
                (schema, table_name),
            )
            rows = cur.fetchall()
    return [row["column_name"] for row in rows]


def fetch_records(
    conn: Connection,
    table_name: str,
    order_by_columns: list[str],
    offset: int = 0,
    limit: int = 1000,
) -> tuple[list[str], list[dict[str, Any]]]:
    """テーブルのレコードを取得する"""
    order_clause = (
        ", ".join(_quote(c) for c in order_by_columns) if order_by_columns else "1"
    )
    with pg_connection(conn) as db:
        with db.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f'SELECT * FROM {_quote(table_name)} ORDER BY {order_clause} LIMIT %s OFFSET %s',
                (limit, offset),
            )
            rows = cur.fetchall()
            columns = [desc[0] for desc in cur.description] if cur.description else []
    return columns, [dict(r) for r in rows]


def count_records(conn: Connection, table_name: str) -> int:
    """テーブルのレコード数を取得する"""
    with pg_connection(conn) as db:
        with db.cursor() as cur:
            cur.execute(f'SELECT COUNT(*) FROM {_quote(table_name)}')
            row = cur.fetchone()
    return row[0] if row else 0


def get_table_row_counts(conn: Connection, table_names: list[str]) -> dict[str, int]:
    """テーブルのレコード数を pg_class から一括取得する（高速・近似値）"""
    if not table_names:
        return {}
    schema = "public"
    with pg_connection(conn) as db:
        with db.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            placeholders = ",".join(["%s"] * len(table_names))
            cur.execute(
                f"""
                SELECT c.relname AS table_name, c.reltuples::bigint AS table_rows
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = %s
                  AND c.relname IN ({placeholders})
                """,
                [schema] + list(table_names),
            )
            rows = cur.fetchall()
    return {row["table_name"]: max(0, int(row["table_rows"] or 0)) for row in rows}


def stream_records(
    conn: Connection,
    table_name: str,
    order_by_columns: list[str],
    batch_size: int = 5000,
) -> Generator[tuple[list[str], list[dict[str, Any]]], None, None]:
    """
    テーブルのレコードをバッチ単位でストリーミング取得するジェネレータ。
    単一カラムのソートキーの場合はキーセットページネーションを使用する。
    """
    columns: list[str] = []

    with pg_connection(conn) as db:
        if len(order_by_columns) == 1:
            pk_col = order_by_columns[0]
            last_val: Any = None
            while True:
                with db.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    if last_val is None:
                        cur.execute(
                            f'SELECT * FROM {_quote(table_name)}'
                            f' ORDER BY {_quote(pk_col)} ASC LIMIT %s',
                            (batch_size,),
                        )
                    else:
                        cur.execute(
                            f'SELECT * FROM {_quote(table_name)}'
                            f' WHERE {_quote(pk_col)} > %s'
                            f' ORDER BY {_quote(pk_col)} ASC LIMIT %s',
                            (last_val, batch_size),
                        )
                    rows = cur.fetchall()
                    if cur.description and not columns:
                        columns = [desc[0] for desc in cur.description]
                if not rows:
                    break
                rows = [dict(r) for r in rows]
                last_val = rows[-1][pk_col]
                yield columns, rows
                if len(rows) < batch_size:
                    break
        else:
            order_clause = ", ".join(_quote(c) for c in order_by_columns)
            offset = 0
            while True:
                with db.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(
                        f'SELECT * FROM {_quote(table_name)}'
                        f' ORDER BY {order_clause} LIMIT %s OFFSET %s',
                        (batch_size, offset),
                    )
                    rows = cur.fetchall()
                    if cur.description and not columns:
                        columns = [desc[0] for desc in cur.description]
                if not rows:
                    break
                rows = [dict(r) for r in rows]
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
    """テーブルの全レコードをバッチ処理で取得する"""
    order_clause = (
        ", ".join(_quote(c) for c in order_by_columns) if order_by_columns else "1"
    )
    all_records: list[dict[str, Any]] = []
    columns: list[str] = []
    offset = 0

    with pg_connection(conn) as db:
        while True:
            if cancel_check and cancel_check():
                return columns, all_records, True

            with db.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    f'SELECT * FROM {_quote(table_name)}'
                    f' ORDER BY {order_clause} LIMIT %s OFFSET %s',
                    (batch_size, offset),
                )
                rows = cur.fetchall()
                if cur.description and not columns:
                    columns = [desc[0] for desc in cur.description]

            if not rows:
                break

            all_records.extend(dict(r) for r in rows)
            offset += len(rows)
            if progress_callback:
                progress_callback(len(all_records))

            if len(rows) < batch_size:
                break

    return columns, all_records, False
