# 武理小精灵 — 部署指南

## 架构概览

```
用户 → 域名 → 阿里云 ECS
                  │
            ┌─────┴─────┐
            │   nginx   │  (SSL 终止 + 反向代理)
            └─────┬─────┘
                  │
            ┌─────┴─────┐
            │  backend  │  (Express API + SPA 静态资源)
            └─────┬─────┘
                  │
            ┌─────┴─────┐
            │   redis   │  (会话缓存)
            └───────────┘
```

## 前置条件

- 阿里云 ECS（推荐 2C4G）
- 已备案域名（可选，纯 IP 也能用）
- 服务器已安装 Docker 和 Docker Compose V2

## 快速开始

### 1. 克隆代码并配置环境变量

```bash
# 在服务器上
git clone https://github.com/your-org/wuli-elf.git /opt/wuli-elf
cd /opt/wuli-elf

# 复制并编辑生产环境变量
cp deploy/.env.production.example deploy/.env.production
vim deploy/.env.production
```

> ⚠️ 必须填写的变量：
> - `AI_API_KEY` — 阶跃星辰 / 通义千问 API 密钥
> - `JWT_SECRET` — 随机 64 位字符串（`openssl rand -hex 32`）
> - `SCHOOL_ENC_KEY` — 教务密码加密密钥
> - `REDIS_URL` — Redis 连接串

### 2. 配置 SSL 证书（域名部署）

**方式 A：阿里云免费证书（推荐）**
1. 在阿里云控制台 → SSL证书 → 免费证书，申请证书
2. 下载 nginx 版证书
3. 上传到服务器 `/etc/letsencrypt/live/your-domain.com/`

**方式 B：Let's Encrypt**
```bash
docker run --rm \
  -v /opt/wuli-elf/ssl:/etc/letsencrypt \
  certbot/certbot \
  certonly --standalone -d your-domain.com
```

**方式 C：纯 IP 测试**
- 使用 `deploy/nginx.http.conf` 代替默认 nginx 配置
- 修改 `docker-compose.yml` 中 nginx 的 `volumes`，使用 HTTP 配置

### 3. 启动服务

```bash
# 构建并启动所有服务
docker compose -p wuli-elf up -d --build

# 查看启动日志
docker compose -p wuli-elf logs -f

# 检查后端健康状态
curl http://localhost:3000/api/health
```

### 4. 验证

打开浏览器访问 `https://your-domain.com` 或 `http://your-ecs-ip`。

## 日常运维

```bash
# 查看服务状态
docker compose -p wuli-elf ps

# 查看实时日志
docker compose -p wuli-elf logs -f backend

# 重启服务
docker compose -p wuli-elf restart

# 更新服务（拉取最新镜像后）
docker compose -p wuli-elf pull backend
docker compose -p wuli-elf up -d --no-deps backend

# 查看日志（最近 100 行）
docker compose -p wuli-elf logs --tail=100 backend

# 备份数据
docker run --rm -v wuli-elf_backend-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/backend-data-$(date +%Y%m%d).tar.gz -C /data .
```

## 镜像构建与推送

### 方式一：CI/CD（推荐）

见 `.github/workflows/deploy.yml`，配置 GitHub Secrets 后自动部署。

### 方式二：手动

```bash
# 构建
docker build -t your-dockerhub-username/wuli-elf-backend:latest .

# 推送
docker push your-dockerhub-username/wuli-elf-backend:latest

# 在服务器上拉取
ssh root@your-ecs "cd /opt/wuli-elf && docker compose pull backend && docker compose up -d --no-deps backend"
```

## 阿里云 ECS 安全组配置

| 端口 | 用途 | 建议 |
|------|------|------|
| 22 | SSH | 仅允许你的 IP |
| 80 | HTTP | 全开（用于 Let's Encrypt 验证） |
| 443 | HTTPS | 全开 |
| 3000 | Backend API | **不要对外开放**，仅 nginx 内部访问 |

## 注意事项

1. **密钥安全**：`deploy/.env.production` 包含敏感信息，不要提交到 git
2. **数据持久化**：Docker volumes `backend-data` 和 `uploads-data` 是持久化存储，不要轻易删除
3. **Puppeteer 内存**：Chromium 可能占用较多内存，ECS 建议 4GB 以上
4. **Redis 密码**：生产环境务必给 Redis 设置密码
5. **日志轮转**：Docker Compose 已配置日志大小限制（每个服务 3 个文件，每个 10MB）
