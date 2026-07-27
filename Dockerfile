# ======================================================================
# Dockerfile — 武理小精灵 (WUT RAG Copilot)
# 多阶段构建：前端(Vite) + 后端(Express + PostgreSQL)
# ======================================================================

# ---- Stage 1: 构建前端 SPA ----
FROM node:20-slim AS frontend-builder

WORKDIR /app

# 安装前端依赖（--ignore-scripts 避免触发 postinstall 安装后端）
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# 拷贝前端源码
COPY vite.config.js index.html ./
COPY src/ src/
COPY public/ public/
COPY scripts/ scripts/

# 构建前端
RUN npm run build

# ---- Stage 2: 后端运行环境 ----
FROM node:20-slim

LABEL maintainer="武理小精灵团队"
LABEL description="武理小精灵 - 武理校园 AI 助手 / WUT Campus AI Assistant"

WORKDIR /app

# ---- 拷贝前端构建产物 ----
COPY --from=frontend-builder /app/dist ./dist

# ---- 安装后端生产依赖 ----
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm ci --omit=dev
# better-sqlite3 是可选依赖（本地开发用），PG 模式下不需要。
# 编译失败时忽略，不影响生产部署。
RUN cd backend && npm rebuild better-sqlite3 --omit=dev 2>/dev/null || echo "[Docker] better-sqlite3 编译跳过（PG 模式无需）"

# ---- 拷贝后端源码 ----
COPY backend/ ./backend/

# ---- 运行时目录 ----
RUN mkdir -p /app/data /app/backend/uploads /app/.model-cache

# ---- 环境变量默认值 ----
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# 持久化数据目录
VOLUME ["/app/data", "/app/backend/uploads", "/app/.model-cache"]

CMD ["node", "backend/src/app.js"]
