#!/bin/sh
# ==============================================================
# DB Diff Viewer – nginx 起動前 TLS セットアップスクリプト
#
# 優先順位:
#   1. /certs/server.crt + /certs/server.key が存在する → そのまま使用
#   2. 存在しない → 自己署名証明書を自動生成（localhost 専用）
# ==============================================================
set -e

SSL_DIR="/etc/nginx/ssl"
USER_CERT="/certs/server.crt"
USER_KEY="/certs/server.key"
CERT="$SSL_DIR/server.crt"
KEY="$SSL_DIR/server.key"

mkdir -p "$SSL_DIR"

if [ -f "$USER_CERT" ] && [ -f "$USER_KEY" ]; then
  echo "[TLS] 提供された証明書を使用します: $USER_CERT"
  cp "$USER_CERT" "$CERT"
  cp "$USER_KEY"  "$KEY"
else
  echo "[TLS] 証明書が見つかりません。自己署名証明書を生成します（localhost 専用）..."
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$KEY" \
    -out    "$CERT" \
    -subj   "/CN=localhost/O=DB Diff Viewer/C=JP" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    2>/dev/null
  echo "[TLS] 自己署名証明書を生成しました（有効期限: 365日）"
  echo "[TLS] ブラウザで https://localhost:<HTTPS_PORT> を開くと警告が出ます（自己署名のため）"
  echo "[TLS] 本番環境では certs/ に正式な証明書を配置してください"
fi

chmod 600 "$KEY"

exec nginx -g "daemon off;"
