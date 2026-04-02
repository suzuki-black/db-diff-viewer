"""
パスワード・機密情報の暗号化/復号化ユーティリティ
cryptography ライブラリの Fernet を使用（AES-128-CBC + HMAC-SHA256）
"""
import base64
import os
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


# 環境変数からシークレットキーを取得
_SECRET_KEY = os.getenv("SECRET_KEY", "change_me_in_production_use_strong_random_key")

# SALT（固定値。本番では環境変数化も検討）
_SALT = b"dbdiffviewer_v1_salt_2024"


def _get_fernet() -> Fernet:
    """シークレットキーからFernetインスタンスを生成する"""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_SALT,
        iterations=100_000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(_SECRET_KEY.encode()))
    return Fernet(key)


_fernet = _get_fernet()


def encrypt(plain_text: str) -> str:
    """平文を暗号化してBase64文字列として返す"""
    if not plain_text:
        return ""
    return _fernet.encrypt(plain_text.encode()).decode()


def decrypt(cipher_text: str) -> str:
    """暗号化済みBase64文字列を復号して平文を返す"""
    if not cipher_text:
        return ""
    return _fernet.decrypt(cipher_text.encode()).decode()
