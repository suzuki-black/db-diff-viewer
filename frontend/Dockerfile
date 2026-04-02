# ===== Stage 1: Build =====
FROM node:20-alpine AS builder

WORKDIR /app

# 依存関係のインストール（キャッシュ効率化のため先にpackage.jsonのみコピー）
COPY package.json ./
RUN npm install

# ソースコードのコピーとビルド
COPY . .
RUN npm run build

# ===== Stage 2: Production (nginx) =====
FROM nginx:1.27-alpine

# ビルド成果物をnginxに配置
COPY --from=builder /app/dist /usr/share/nginx/html

# nginx設定
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
