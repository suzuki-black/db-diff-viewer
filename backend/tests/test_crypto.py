"""
暗号化ユーティリティ ユニットテスト
"""
import os
import pytest

# テスト用に SECRET_KEY を設定してから import
os.environ.setdefault("SECRET_KEY", "test_secret_key_for_testing_only")

from utils.crypto import encrypt, decrypt


class TestEncryptDecrypt:
    """encrypt / decrypt のラウンドトリップテスト"""

    def test_roundtrip_basic(self):
        """平文を暗号化して復号すると元に戻る"""
        plain = "mypassword123"
        assert decrypt(encrypt(plain)) == plain

    def test_roundtrip_japanese(self):
        """日本語文字列もラウンドトリップできる"""
        plain = "パスワード！テスト"
        assert decrypt(encrypt(plain)) == plain

    def test_roundtrip_special_characters(self):
        """記号・空白を含む文字列もラウンドトリップできる"""
        plain = "p@$$w0rd #1! \\n\ttab"
        assert decrypt(encrypt(plain)) == plain

    def test_roundtrip_long_string(self):
        """長い文字列もラウンドトリップできる"""
        plain = "x" * 1000
        assert decrypt(encrypt(plain)) == plain

    def test_encrypt_empty_string_returns_empty(self):
        """空文字列を暗号化すると空文字列が返る"""
        assert encrypt("") == ""

    def test_decrypt_empty_string_returns_empty(self):
        """空文字列を復号すると空文字列が返る"""
        assert decrypt("") == ""

    def test_encrypt_produces_different_ciphertext_each_time(self):
        """同じ平文でも暗号化のたびに異なる暗号文が生成される（Fernet の IV ランダム性）"""
        plain = "samepassword"
        cipher1 = encrypt(plain)
        cipher2 = encrypt(plain)
        assert cipher1 != cipher2

    def test_encrypted_is_not_plaintext(self):
        """暗号化後の文字列は平文を含まない"""
        plain = "secretvalue"
        cipher = encrypt(plain)
        assert plain not in cipher

    def test_decrypt_invalid_token_raises(self):
        """不正なトークンを復号しようとすると例外が発生する"""
        with pytest.raises(Exception):
            decrypt("this-is-not-valid-base64-fernet-token")

    def test_multiple_different_plaintexts(self):
        """異なる平文はそれぞれ独立して暗号化・復号できる"""
        plaintexts = ["pass1", "pass2", "admin", "root", "qwerty"]
        for plain in plaintexts:
            assert decrypt(encrypt(plain)) == plain
