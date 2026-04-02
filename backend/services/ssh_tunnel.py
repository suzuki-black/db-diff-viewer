"""
SSHポートフォワーディング管理サービス
sshtunnel ライブラリを使用してSSHトンネルを確立する
"""
import logging
from contextlib import contextmanager
from typing import Generator, Optional

import paramiko
from sshtunnel import SSHTunnelForwarder

from models import Connection
from utils.crypto import decrypt

logger = logging.getLogger(__name__)


def _load_private_key(path: str) -> paramiko.PKey:
    """秘密鍵ファイルを鍵種に関係なくロードする（ed25519 / RSA / ECDSA / DSS 対応）"""
    key_classes = [
        paramiko.Ed25519Key,
        paramiko.RSAKey,
        paramiko.ECDSAKey,
        paramiko.DSSKey,
    ]
    last_exc: Exception = Exception(f"鍵ファイルを読み込めませんでした: {path}")
    for cls in key_classes:
        try:
            return cls.from_private_key_file(path)
        except Exception as e:
            last_exc = e
    raise last_exc


@contextmanager
def ssh_tunnel_context(
    conn: Connection,
) -> Generator[tuple[str, int], None, None]:
    """
    SSHトンネルを確立するコンテキストマネージャー

    Args:
        conn: Connection モデル（SSHフィールドが設定されていること）

    Yields:
        (local_host, local_port) タプル - MySQL接続用のローカルエンドポイント
    """
    if not conn.use_ssh or not conn.ssh_host:
        # SSH不使用の場合はそのままyield
        yield conn.host, conn.port
        return

    # SSH認証情報の準備
    ssh_password: Optional[str] = None
    ssh_pkey_path: Optional[str] = None

    if conn.ssh_auth_type == "password" and conn.ssh_password_enc:
        ssh_password = decrypt(conn.ssh_password_enc)
    elif conn.ssh_auth_type == "key" and conn.ssh_key_path:
        ssh_pkey_path = conn.ssh_key_path

    # ローカルバインドポート（0 = OS自動割り当て）
    local_bind_port = conn.local_bind_port or 0

    logger.info(
        "SSHトンネル確立中: %s@%s:%d -> %s:%d (ローカル:%d)",
        conn.ssh_username,
        conn.ssh_host,
        conn.ssh_port or 22,
        conn.host,
        conn.port,
        local_bind_port,
    )

    tunnel_kwargs: dict = {
        "ssh_address_or_host": (conn.ssh_host, conn.ssh_port or 22),
        "ssh_username": conn.ssh_username,
        "remote_bind_address": (conn.host, conn.port),
        "local_bind_address": ("127.0.0.1", local_bind_port),
        "set_keepalive": 30,
    }

    if ssh_password:
        tunnel_kwargs["ssh_password"] = ssh_password
    if ssh_pkey_path:
        # ファイルパス文字列をそのまま渡すと sshtunnel が鍵種を自動判別できず
        # ed25519 鍵で "No password or public key available!" になる。
        # paramiko で明示的にロードして PKey オブジェクトを渡す。
        pkey = _load_private_key(ssh_pkey_path)
        tunnel_kwargs["ssh_pkey"] = pkey

    server = SSHTunnelForwarder(**tunnel_kwargs)
    try:
        server.start()
        local_port = server.local_bind_port
        logger.info("SSHトンネル確立完了: localhost:%d", local_port)
        yield "127.0.0.1", local_port
    except Exception as e:
        logger.error("SSHトンネル確立失敗: %s", e)
        raise
    finally:
        if server.is_active:
            server.stop()
            logger.info("SSHトンネルを切断しました")
