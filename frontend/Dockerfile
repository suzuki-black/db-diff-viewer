# ===== Stage 1: Build =====
FROM node:20-alpine AS builder

WORKDIR /app

# 依存関係のインストール（キャッシュ効率化のため先にpackage.jsonのみコピー）
COPY package.json ./
RUN npm install

# ソースコードのコピーとビルド
COPY . .
RUN npm run build

# ===== Stage 2: Production (nginx + TLS) =====
FROM nginx:1.27-alpine

# openssl: 自己署名証明書の自動生成に使用
RUN apk add --no-cache openssl

# ビルド成果物をnginxに配置
COPY --from=builder /app/dist /usr/share/nginx/html

# nginx設定
COPY nginx.conf /etc/nginx/conf.d/default.conf

# TLS セットアップ + nginx 起動スクリプト
# sed で CRLF（Windows 改行）を LF に変換してから実行権限を付与
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

EXPOSE 443

ENTRYPOINT ["/docker-entrypoint.sh"]
