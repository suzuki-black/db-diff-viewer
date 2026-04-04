# DB Diff Viewer

MySQL / PostgreSQL データベース間の **スキーマ・テーブル・レコード差分** を WinMerge ライクな GUI で可視化する Web ツールです。

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)
![MySQL](https://img.shields.io/badge/MySQL-5.7%2F8.x-4479A1?logo=mysql&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-4169E1?logo=postgresql&logoColor=white)

---

## 概要

DB Diff Viewer は、**2 つのデータベースの差分を直感的に確認する**ための開発・運用支援ツールです。

テーブル構造（スキーマ）の比較から、数百万件規模のレコード差分まで、Docker Compose 一発で起動できるオールインワン構成になっています。

---

## 想定ユースケース

| シナリオ | 使い方 |
|----------|--------|
| **マイグレーション確認** | 本番 DB と開発 DB のスキーマ差分・レコード差分を比較してリリース前に検証 |
| **データ移行の検証** | 移行元と移行先のレコードを照合して抜け漏れ・変化を検出 |
| **環境間の差分確認** | ステージング・本番・開発環境の設定テーブル・マスタデータの一致確認 |
| **障害調査** | 障害前後のスナップショット DB を比較してデータ変化を特定 |
| **SSH 踏み台サーバー経由** | 直接アクセスできない本番 DB へ SSH トンネル越しに接続して比較 |

---

## 主な機能

### テーブル一覧比較
- 左右 2 DB のテーブル一覧を並べて表示（追加・削除・変更・一致をカラーで識別）
- テーブルのスキーマ差分（カラム数の増減）をサマリ表示
- 近似レコード数を取得して件数差異を警告表示
- 過去のレコード差分スキャン結果をキャッシュして一覧に表示

### レコード差分
- バックグラウンドジョブ方式で**数百万件規模**に対応
- フェーズ別プログレスバー（カウント → 左 DB 取得 → 差分計算 → インデックス構築）
- 仮想スクロール（500,000 件超でもブラウザが固まらない）
- Canvas ベースのミニマップでレコード全体の差分分布を可視化
- 変更・追加・削除・一致 を個別にフィルタリング
- 片方にのみ存在するテーブルは全件追加/削除として表示（エラーにならない）

### スキーマ差分
- カラム定義（型・NULL 可否・デフォルト値・EXTRA・コメント）の差分を表示
- インデックス定義の差分を表示
- レコード差分ビューと同一画面のタブで確認

### DB 接続管理
- 複数の接続設定を保存・管理（パスワードは AES-256 で暗号化保存）
- **SSH ポートフォワーディング対応**（パスワード認証・秘密鍵認証）

### 差分アルゴリズム
| アルゴリズム | 特徴 |
|-------------|------|
| `set_based` | **デフォルト・推奨**。主キーでレコードを照合。大規模対応。 |
| `ast_based` | 型を考慮した比較（`"1.0"` と `"1"` を同値とみなす）|
| `myers` | シーケンス diff。主キーなしテーブル向け。 |
| `patience` | ユニーク行をアンカーとした sequence diff |
| `histogram` | 繰り返し行が多い場合に有効 |
| `greedy_lcs` | 高速近似 LCS（大規模テーブルの sequence diff 向け） |

---

## 対応 DB

| DB | バージョン |
|----|-----------|
| MySQL | 5.7 / 8.x |
| PostgreSQL | 14 以上 |

---

## 必要環境

- Docker Desktop または Docker Engine **24 以上**
- Docker Compose **v2 以上**

---

## インストール・起動

```bash
# 1. リポジトリをクローン
git clone git@github.com:suzuki-black/db-diff-viewer.git
cd db-diff-viewer

# 2. 環境変数ファイルを作成
cp .env.example .env

# 3. .env を開いて SECRET_KEY を必ず変更する
#    生成例: python3 -c "import secrets; print(secrets.token_urlsafe(32))"
vi .env

# 4. 起動（初回はイメージのビルドが走るため数分かかります）
docker compose up -d --build

# 5. ブラウザでアクセス（HTTPS）
open https://localhost:3000
```

> **ポート番号の変更**
> `FRONTEND_PORT`（デフォルト 3000）と `BACKEND_PORT`（デフォルト 8000）は `.env` で変更できます。

### 初回アクセス時のブラウザ警告について

証明書を用意していない場合、コンテナ起動時に **自己署名証明書が自動生成**されます。
初回アクセス時にブラウザの警告画面が表示されますが、以下の手順で進めてください。

| ブラウザ | 操作 |
|---------|------|
| **Edge / Chrome** | 警告画面で「詳細設定」→「localhost にアクセスする（安全でない）」をクリック |
| **Firefox** | 「詳細情報」→「危険性を承知で続行」をクリック |

#### 正式な証明書を使う（本番環境・社内 CA 等）

```bash
# certs/ に証明書を配置（ファイル名は固定）
cp /path/to/your/server.crt certs/server.crt
cp /path/to/your/server.key certs/server.key

# コンテナを再起動して反映
docker compose restart frontend
```

| ファイル | 内容 |
|---------|------|
| `certs/server.crt` | サーバー証明書（中間 CA 証明書を含む場合は結合した PEM 形式） |
| `certs/server.key` | 秘密鍵（PEM 形式） |

> `certs/*.crt` / `certs/*.key` は `.gitignore` で除外済みです。証明書をリポジトリにコミットしないでください。

### 開発モード（ホットリロード有効）

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

フロントエンドのソース変更が即時反映されます（Vite dev server）。

---

## 使い方

### 1. DB 接続を登録する

左サイドバー下部の **「接続管理」** から DB 接続設定を追加します。

| 項目 | 説明 |
|------|------|
| 接続名 | 任意の識別名（例：「本番 DB」「開発 DB」） |
| DB種別 | MySQL / PostgreSQL を選択 |
| ホスト・ポート | 接続先のホスト名と DB ポート |
| データベース名 | スキーマ名（`testdb` など） |
| ユーザー名・パスワード | DB の認証情報 |
| SSH トンネル | 踏み台サーバー経由の場合は有効化 |

**SSH トンネルを使う場合（サンプル DB）**

サンプル DB のSSH経由接続はデモ用鍵ペアが同梱されているため、追加設定なしで動作します。

**実際のサーバーへ接続する場合**

1. 秘密鍵を `ssh_keys/` ディレクトリにコピー（`test_key` 以外の名前で）
2. SSH ホスト・ポート・ユーザー名を入力
3. 認証方式（パスワード or 秘密鍵）を選択
4. 秘密鍵認証の場合、鍵ファイルパスに `/ssh_keys/<ファイル名>` を入力

「**接続テスト**」ボタンで疎通確認できます。

---

### 2. 比較する DB を選択して「比較開始」

画面上部の左右ドロップダウンで比較したい DB を選択し、**「比較開始」** ボタンを押します。

テーブル一覧が左右に並んで表示され、各テーブルが **「一致 / 変更 / 追加 / 削除」** でカラーコーディングされます。

---

### 3. テーブルをクリックしてレコード差分を確認

テーブル行をクリックすると **レコード差分ビュー** に遷移します。

- バックグラウンドで差分計算が始まり、進捗モーダルが表示されます
- 計算完了後、各レコードが **「一致 / 変更 / 追加 / 削除」** で表示されます
- 画面右の **ミニマップ** をクリックすると該当箇所へジャンプできます

同一画面の **「スキーマ」タブ** でカラム・インデックスの差分も確認できます。

---

### 4. 設定のカスタマイズ

右サイドバーの **「設定」** から以下を変更できます。

| 設定項目 | 説明 |
|----------|------|
| 差分アルゴリズム | `set_based`（推奨）など 6 種類から選択 |
| バッチサイズ | レコード取得の 1 回あたりの件数（デフォルト 1,000） |
| デフォルトフィルター | 比較結果の表示対象（変更/追加/削除/一致）の初期値 |

---

## ⚠️ 本番環境での利用に関する注意

このツールは**開発・検証用途**を想定しています。本番環境や機密データを扱う場合は以下の点に注意してください。

### セキュリティ上のリスク

| リスク | 対処法 |
|--------|--------|
| **SECRET_KEY の流出** | `.env` を Git 管理から除外する（`.gitignore` 設定済み）。強力なランダム値を使用すること。 |
| **通信の平文転送** | デフォルトで HTTPS (port 3443) に対応しています。本番環境では正式な証明書を `certs/` に配置してください。 |
| **レコードデータの画面表示** | 個人情報・機密データが差分として画面に表示されます。アクセス制限（IP 制限・認証）を設けてください。 |
| **SSH 秘密鍵の管理** | `ssh_keys/` ディレクトリは `.gitignore` 対象です。鍵ファイルは Git にコミットしないでください。 |
| **認証機能なし** | このツールにはユーザー認証機能がありません。社内ネットワーク限定 or VPN 経由での利用を推奨します。 |

### パフォーマンス上の注意

- レコード差分は**比較元・比較先の全レコードを取得**します。テーブル規模によっては DB 負荷が高くなります。業務時間外での実行を推奨します。
- デフォルトのバッチサイズ（1,000 件）は本番 DB に対しては適宜調整してください。

---

## サンプル DB（Docker Compose 付属）

リポジトリにはサンプルデータ入りの DB コンテナが同梱されています。
`docker compose up -d --build` 後、追加設定なしで GUI から差分比較を試せます。

接続情報はすべて固定のサンプル値です。本番 DB とは完全に切り離されたローカル専用コンテナです。

### MySQL サンプル

| 項目 | 左 DB | 右 DB | SSH 経由 DB |
|------|-------|-------|------------|
| ホスト（ホストから） | `localhost:3307` | `localhost:3308` | SSH トンネル経由のみ |
| データベース名 | `testdb_left` | `testdb_right` | `testdb_ssh` |
| ユーザー名 | `testuser` | `testuser` | `testuser` |
| パスワード | `testpass` | `testpass` | `testpass` |

### PostgreSQL サンプル

| 項目 | 左 DB | 右 DB | SSH 経由 DB |
|------|-------|-------|------------|
| ホスト（ホストから） | `localhost:54332` | `localhost:54333` | SSH トンネル経由のみ |
| データベース名 | `testdb_pg_left` | `testdb_pg_right` | `testdb_pg_ssh` |
| ユーザー名 | `testuser` | `testuser` | `testuser` |
| パスワード | `testpass` | `testpass` | `testpass` |

> 起動直後はアプリの接続設定にこれらのサンプル DB が自動登録されています。
> 左右を選んで「比較開始」を押すだけでサンプルデータの差分を確認できます。

---

## API ドキュメント

バックエンド起動後、Swagger UI でエンドポイントの仕様を確認できます。

```
http://localhost:8000/docs
```

---

## ディレクトリ構成

```
db-diff-viewer/
├── docker-compose.yml         # 本番用 Compose 設定
├── docker-compose.dev.yml     # 開発用オーバーライド（ホットリロード）
├── .env.example               # 環境変数テンプレート
├── certs/                     # TLS 証明書格納ディレクトリ（.gitignore 対象）
├── ssh_keys/                  # SSH 秘密鍵格納ディレクトリ（.gitignore 対象）
├── mysql/                     # MySQL テスト用初期化 SQL
├── postgres/                  # PostgreSQL テスト用初期化 SQL
├── ssh_server/                # SSH サーバーコンテナ（テスト用）
├── frontend/                  # React 18 + TypeScript フロントエンド
└── backend/                   # FastAPI バックエンド
```

---

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| フロントエンド | React 18 / TypeScript / Vite / Ant Design / Zustand |
| 仮想スクロール | @tanstack/react-virtual |
| バックエンド | FastAPI / Python 3.12 / Uvicorn / SQLAlchemy |
| DB ドライバー | PyMySQL / psycopg2 |
| SSH トンネル | sshtunnel + paramiko |
| パスワード保存 | AES-256 暗号化（cryptography ライブラリ） |
| インフラ | Docker Compose / nginx |

---

## 今後の改善予定

- [ ] **差分結果のエクスポート**（CSV / Excel / JSON）
- [ ] **カラム・テーブルフィルター**（比較対象から特定テーブル・カラムを除外する設定）
- [ ] **レコード差分のインライン表示**（変更前→変更後を 1 行内に並べて表示）
- [ ] **接続設定のインポート／エクスポート**（チームで設定を共有しやすく）
- [ ] **ユーザー認証**（Basic 認証 / OIDC 連携）
---

## テスト

フロントエンドのユニットテストは [Vitest](https://vitest.dev/) + [Testing Library](https://testing-library.com/) で実装されています。

開発モード（`docker-compose.dev.yml`）のコンテナには Node.js が含まれているため、コンテナ内でテストを実行できます。

```bash
# 開発モードでコンテナを起動（起動済みの場合は不要）
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

# テストを 1 回だけ実行
docker compose exec frontend npm run test:run

# カバレッジレポートを生成（frontend/coverage/ に HTML が出力される）
docker compose exec frontend npm run test:coverage
```

> **注意**: 本番用コンテナ（`docker compose up` のみで起動した場合）は nginx イメージのため Node.js がなく、テストは実行できません。

---

## ライセンス

[MIT](LICENSE) © 2026 suzuki-black
