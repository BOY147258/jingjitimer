# 竞迹计时系统 - Docker 配置
FROM node:20-alpine

LABEL maintainer="BOY147258"
WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN mkdir -p logs data temp backups

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/health || exit 1

CMD ["sh", "-c", "node ws-server.js & node serve.js"]
