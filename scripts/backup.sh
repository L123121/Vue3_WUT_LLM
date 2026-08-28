#!/usr/bin/env bash
# ======================================================================
# 武理小精灵 — 一键备份（SQLite + 上传文件 + Qdrant 快照）
#
# 用法（在部署目录执行，即 docker-compose.yml 所在目录）:
#   bash scripts/backup.sh
#   BACKUP_DIR=/data/backups BACKUP_KEEP=30 bash scripts/backup.sh
#
# 定时（crontab -e，每天 03:30 备份）:
#   30 3 * * * cd /opt/wuli-elf && BACKUP_DIR=/data/backups bash scripts/backup.sh >> /var/log/wuli-elf-backup.log 2>&1
#
# 恢复方法见 deploy/README.md「备份与恢复」小节。
# ======================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-wuli-elf}"
QDRANT_URL="${QDRANT_URL:-http://127.0.0.1:6333}"
QDRANT_COLLECTION="${QDRANT_COLLECTION:-wuli_elf_chunks}"

STAMP="$(date +%Y%m%d-%H%M%S)"
SQLITE_VOLUME="${COMPOSE_PROJECT}_backend-data"
UPLOADS_VOLUME="${COMPOSE_PROJECT}_uploads-data"

log() { echo "[backup $(date '+%F %T')] $*"; }

mkdir -p "$BACKUP_DIR"

# ---------- 1. SQLite（一致性备份：优先 better-sqlite3 .backup，退化 tar 冷拷贝） ----------
log "备份 SQLite..."
if BACKEND_IMAGE="$(docker compose -p "$COMPOSE_PROJECT" images -q backend 2>/dev/null)" && [ -n "$BACKEND_IMAGE" ]; then
  # 用项目镜像自带的 better-sqlite3 在容器内做在线 backup，WAL 进行中也能拿到一致快照
  docker run --rm \
    -v "${SQLITE_VOLUME}:/data" \
    -v "$(cd "$BACKUP_DIR" && pwd):/backup" \
    "$BACKEND_IMAGE" node -e "
      const db = require('better-sqlite3')('/data/store.db', { readonly: true });
      db.backup('/backup/store-${STAMP}.db').then(() => { console.log('sqlite backup ok'); }).catch((e) => { console.error(e.message); process.exit(1); });
    "
  log "SQLite 完成: store-${STAMP}.db"
else
  log "未找到 backend 镜像，退化为 tar 冷拷贝（建议先 docker compose -p $COMPOSE_PROJECT stop backend）"
  docker run --rm \
    -v "${SQLITE_VOLUME}:/data:ro" \
    -v "$(cd "$BACKUP_DIR" && pwd):/backup" \
    alpine tar czf "/backup/backend-data-${STAMP}.tar.gz" -C /data .
  log "SQLite 完成: backend-data-${STAMP}.tar.gz"
fi

# ---------- 2. 上传文件 ----------
log "备份上传文件..."
docker run --rm \
  -v "${UPLOADS_VOLUME}:/data:ro" \
  -v "$(cd "$BACKUP_DIR" && pwd):/backup" \
  alpine tar czf "/backup/uploads-${STAMP}.tar.gz" -C /data .
log "上传文件完成: uploads-${STAMP}.tar.gz"

# ---------- 3. Qdrant 快照（官方 snapshot API，避免运行中冷拷贝不一致） ----------
log "创建 Qdrant 快照..."
SNAPSHOT_NAME="$(curl -sf -X POST "${QDRANT_URL}/collections/${QDRANT_COLLECTION}/snapshots" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')"
if [ -z "${SNAPSHOT_NAME:-}" ]; then
  log "警告: Qdrant 快照创建失败（集合 ${QDRANT_COLLECTION} 不存在或服务未启动），跳过"
else
  curl -sf -o "${BACKUP_DIR}/qdrant-${STAMP}.snapshot" "${QDRANT_URL}/collections/${QDRANT_COLLECTION}/snapshots/${SNAPSHOT_NAME}"
  # 远端快照用完即删，避免占用向量库存储
  curl -sf -X DELETE "${QDRANT_URL}/collections/${QDRANT_COLLECTION}/snapshots/${SNAPSHOT_NAME}" >/dev/null || true
  log "Qdrant 完成: qdrant-${STAMP}.snapshot"
fi

# ---------- 4. 本地轮转（每类各保留最近 BACKUP_KEEP 份） ----------
log "轮转：每类保留最近 ${BACKUP_KEEP} 份..."
for prefix in store- backend-data- uploads- qdrant-; do
  ls -1t "${BACKUP_DIR}/${prefix}"* 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | while read -r old; do
    rm -f "$old"
    log "  清理过期备份: $(basename "$old")"
  done
done

log "全部完成，备份目录: ${BACKUP_DIR}"
