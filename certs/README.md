# certs/

TLS 証明書を格納するディレクトリです。

## 自己署名証明書（デフォルト動作）

`server.crt` / `server.key` が存在しない場合、コンテナ起動時に自動で自己署名証明書が生成されます。
ブラウザで「接続がプライベートでない」という警告が表示されますが、ローカル開発では無視して進めて構いません。

---

## 正式な証明書を使う場合

以下のファイル名でこのディレクトリに配置してください。

| ファイル名 | 内容 |
|-----------|------|
| `server.crt` | サーバー証明書（中間 CA 証明書を含む場合は結合した PEM 形式） |
| `server.key` | 秘密鍵（PEM 形式） |

配置後にコンテナを再起動すると反映されます。

```bash
docker compose restart frontend
```

---

## 自己署名証明書を手動で生成する場合

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/server.key \
  -out    certs/server.crt \
  -subj   "/CN=localhost/O=DB Diff Viewer/C=JP" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

---

> **注意**: `server.crt` および `server.key` は `.gitignore` により Git 管理対象外です。
> 証明書をリポジトリにコミットしないでください。
