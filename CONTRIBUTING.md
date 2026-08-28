# 贡献指南

感谢关注武理小精灵！这是一个面向武汉理工大学校园场景的 RAG 智能问答项目。

## 开发环境

```bash
npm install          # 根目录安装（postinstall 会同时装后端依赖）
cp backend/.env.example backend/.env   # 至少配置 AI_API_KEY / JWT_SECRET
npm run dev          # 前端 http://localhost:5173
npm start            # 后端 http://localhost:3000
```

Qdrant 向量库：`docker compose -p wuli-elf up -d qdrant`；离线可用 `VECTOR_STORE_BACKEND=file`。

## 提交前检查

```bash
npm run lint:check   # ESLint（src/ + backend/）
npm test             # 快速测试（前后端并行，约 60 秒）
npm run test:all     # 完整测试（含重型集成用例）
npm run build        # 前端生产构建
docker compose config --quiet   # compose 语法
```

CI（GitHub Actions）会执行以上检查后再构建镜像，扫描 CRITICAL/HIGH 漏洞，失败将不部署。

## 改动约定

- **代码风格**：遵循现有 ESLint + Prettier 配置；中文注释，关键服务头部写明设计意图。
- **测试**：新功能必须有测试。后端放 `backend/__tests__/`，前端放 `src/__tests__/`；RAG 相关行为变更请同步跑 `scripts/rag-eval/` 的检索基线，避免指标回退。
- **提交信息**：Conventional Commits（`feat:` / `fix:` / `refactor:` / `chore:` / `docs:`），一个 commit 一个主题。
- **配置项**：新增环境变量必须同步 `backend/.env.example`（及生产模板 `deploy/.env.production.example`）并给默认值。

## RAG 行为变更须知

检索链路（embedding / 融合 / 重排 / 截断 / MMR）的任何调整都可能影响线上质量：

1. 当前基线：full-coverage 32 题 Recall 97.4% / MRR 0.977 / nDCG@5 0.970（见 README「评测结果」）。
2. 变更后运行 `npm run eval:rag-baseline` 对比，指标回退需要在 PR 说明中给出理由。
3. 涉及 prompt 的改动请同时观察 grounding 溯源覆盖率。

## 报告问题

使用 [Issue 模板](.github/ISSUE_TEMPLATE/)，检索类问题请附 traceId（可在回答的"执行轨迹"面板找到），便于定位到具体检索阶段。
