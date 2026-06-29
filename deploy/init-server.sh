#!/usr/bin/env bash
# ======================================================================
# 阿里云 ECS 初始化脚本 — 武理小精灵
# 在全新的 Ubuntu 24.04 ECS 上运行一次，安装 Docker 等依赖
#
# 用法:
#   ssh root@your-ecs-ip
#   curl -fsSL https://raw.githubusercontent.com/.../init-server.sh | bash
#   或本地执行后 SCP 到服务器再运行
# ======================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ─── 检查系统 ───
if [ "$EUID" -ne 0 ]; then
  error "请以 root 用户运行"
fi

if ! grep -qi "ubuntu" /etc/os-release 2>/dev/null; then
  warn "此脚本针对 Ubuntu 优化，其他发行版可能需要调整"
fi

info "系统: $(cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"')"
info "内核: $(uname -r)"

# ─── 1. 系统更新 ───
info "更新系统包..."
apt-get update -qq
apt-get upgrade -y -qq

# ─── 2. 安装 Docker ───
if command -v docker &>/dev/null; then
  info "Docker 已安装: $(docker --version)"
else
  info "安装 Docker..."
  # 官方安装脚本
  curl -fsSL https://get.docker.com | bash

  # 配置 Docker 镜像加速（阿里云 ECS 适用）
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<EOF
{
  "registry-mirrors": ["https://mirror.ccs.tencentyun.com"],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
  systemctl enable docker
  systemctl restart docker
  info "Docker 安装完成: $(docker --version)"
fi

# ─── 3. 安装 Docker Compose V2 ───
if docker compose version &>/dev/null; then
  info "Docker Compose 已安装: $(docker compose version)"
else
  info "安装 Docker Compose V2..."
  DOCKER_CONFIG=${DOCKER_CONFIG:-/usr/local/lib/docker/cli-plugins}
  mkdir -p "$DOCKER_CONFIG"
  curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
    -o "$DOCKER_CONFIG/docker-compose"
  chmod +x "$DOCKER_CONFIG/docker-compose"
  info "Docker Compose 安装完成: $(docker compose version)"
fi

# ─── 4. 创建项目目录 ───
mkdir -p /opt/wuli-elf
info "项目目录: /opt/wuli-elf"

# ─── 5. 系统调优 ───
# 增加文件监控数量（Node.js 热重载用）
if ! grep -q "fs.inotify.max_user_watches" /etc/sysctl.conf 2>/dev/null; then
  echo "fs.inotify.max_user_watches = 524288" >> /etc/sysctl.conf
  sysctl -p
fi

# 增大 SHM 大小（Chromium 可能用到）
if ! grep -q "/dev/shm" /etc/fstab 2>/dev/null; then
  echo "tmpfs /dev/shm tmpfs defaults,size=256m 0 0" >> /etc/fstab
  mount -o remount /dev/shm 2>/dev/null || true
fi

# ─── 6. 防火墙提醒 ───
info "========== 安全组配置提醒 =========="
echo "请确保阿里云 ECS 安全组已开放以下端口："
echo "  - 22 (SSH，建议仅限您的 IP)"
echo "  - 80 (HTTP)"
echo "  - 443 (HTTPS)"
echo ""
echo "请勿开放 3000 端口（后端 API 仅内部访问）"
echo "==================================="

# ─── 7. 验证 ───
info "验证安装..."
docker run --rm hello-world > /dev/null 2>&1 || warn "Docker 验证失败，请检查"
docker compose version > /dev/null 2>&1 || warn "Docker Compose 验证失败，请检查"

info ""
info "✅ 服务器初始化完成！"
info ""
info "下一步:"
info "  1. 将代码推送到服务器:"
info "     rsync -avz --exclude node_modules --exclude .git ./ root@your-ecs:/opt/wuli-elf/"
info "  2. 配置环境变量:"
info "     cp deploy/.env.production.example deploy/.env.production"
info "     vim deploy/.env.production"
info "  3. 启动服务:"
info "     docker compose -p wuli-elf up -d --build"
