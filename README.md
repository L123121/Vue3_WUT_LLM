# WUT RAG Copilot / 武理小精灵

![状态](https://img.shields.io/badge/status-active-success) ![版本](https://img.shields.io/badge/version-0.0.0-blue) ![Vue](https://img.shields.io/badge/Vue-3.5-brightgreen) ![Node](https://img.shields.io/badge/Node-20+-yellow)

武理小精灵是面向武汉理工大学校园场景的 AI 助手。项目采用 **Vue 3 + Pinia + Express** 架构，围绕 AI 流式聊天、RAG 知识库、语音输入、多会话管理、评测体系和教务系统查询构建完整的前后端应用。

---

## 功能概览

### 用户侧能力

- **AI 流式聊天**：通过 Fetch + ReadableStream 解析 SSE，支持边生成边渲染。
- **RAG 知识库**：支持文档上传、批量录入、列表查看、统计查询和检索增强问答。
- **语音输入**：基于 Web Speech API 的语音识别，实时转文字填入输入框。
- **文件上传对话**：聊天页支持图片、PDF、Word、TXT 上传，文档内容会被解析后参与回答。
- **多会话管理**：支持创建、切换、重命名、删除会话，已登录用户会话通过后端存储。
- **教务系统集成**：使用教务账号登录后，可查询成绩、课表、考试安排和学期列表。
- **评测体系**：离线测试集（32 题/6 文档）、LLM-as-judge（独立 Key）、人工抽检、线上反馈、回归评估。
- **Markdown 渲染**：支持代码高亮、表格、富文本内容清洗和 Worker 渲染优化。
- **个性化配置**：内置提示词、Skills、MCP、主题、语言和设置等前端管理模块。

### 工程侧能力

- **前后端分离**：开发阶段 Vite 代理 `/api` 到 Express，生产阶段后端托管 `dist/`。
- **Cookie 鉴权**：登录成功后后端写入 httpOnly JWT cookie，前端只缓存用户展示信息。
- **存储自适应**：配置 `REDIS_URL` 时使用 Redis；未配置时降级为本地 MemoryStore + `backend/data/store.json`。
- **安全防护**：启用 Helmet、CORS 白名单、速率限制、上传文件 MIME 嗅探防护。
- **容器部署**：提供 Dockerfile、Docker Compose、nginx 配置和 GitHub Actions 部署流水线。
- **测试覆盖**：包含前端 store/composable 测试，以及后端 RAG、路由和中间件测试。

---

## 页面与演示

| 页面 | 路由 | 说明 |
| --- | --- | --- |
| 登录页 | `/login` | 教务系统账号登录，成功后设置 httpOnly cookie |
| 聊天页 | `/chat` | AI 对话、文件上传、语音输入、会话列表 |
| 知识库 | `/knowledge` | RAG 文档上传、文档管理、两级分类、统计信息 |
| 评测页 | `/eval` | 人工评分、LLM-as-judge 结果、系统指标 |
| 反馈页 | `/feedback` | 线上反馈看板（管理员） |
| 设置页 | `/settings` | 模型、系统和个性化设置入口 |

---

## RAG 检索链路设计

### 整体流程

```
用户提问
  ↓
① BGE-small-zh ONNX 向量化
   生成稠密向量 512d + n-gram 稀疏向量（整数 key 哈希）
  ↓
② Milvus Hybrid Search (topK=50)
   稠密 COSINE 相似度 ×0.6 + 稀疏 IP 相似度 ×0.4
  ↓
③ 50 个候选句子 → 按 parentId 归并
   从句子级命中回溯到父段落，得到 ~15 个完整段落
  ↓
④ BGE-reranker-base cross-encoder
   逐对（query, 段落）计算语义相关性分数 → sigmoid 归一化
  ↓
⑤ 自适应截断
   断崖检测（相邻分差 > 0.05 截断）
   低分过滤（< 0.3 丢弃）
   硬上限（rerankTopK=10）
  ↓
⑥ 二级排序
   按 (docId, parentIdx) 排序，保证上下文按文档阅读顺序排列
  ↓
⑦ 上下文组装
   拼接段落原文，最大 6000 字
  ↓
⑧ step-3.7-flash LLM 生成
   基于检索上下文生成回答，附带 sources 引用
```

### 父子段落架构

```
文档
  ├─ 章节合并（按"一、二、三"中文章节标题合并）
  ├─ 段落（父级）← 检索后返回的上下文单位
  │   └─ 句子（子级，512 维向量化）← 检索命中单位
  │
  检索时：命中句子 → 按 parentId 去重 → 返回完整父段落
  目的：减少 token 消耗（~6000→~300 字），保留完整语义
```

### 为什么这样设计

| 设计决策 | 解决的问题 | 具体方案 |
|---------|-----------|---------|
| 父子段落 | 直接返回句子上下文太碎片，大段原文 token 太多 | 句子索引 + 段落上下文，降 95% token |
| 混合检索 | 纯语义检索可能漏掉精确关键词匹配 | 稠密×0.6 + 稀疏×0.4 |
| BGE-reranker | 向量检索的排序不够精确 | cross-encoder 逐对打分，~145ms/15 候选 |
| 自适应截断 | reranker 分数低的段落反而污染上下文 | 断崖检测 + 低分过滤 + 硬上限 |

### 涉及的核心服务

| 服务 | 文件 | 职责 |
|------|------|------|
| Embedding | `embedding.service.js` | BGE-small-zh ONNX + n-gram 稀疏 |
| 向量检索 | `vector-store.service.js` | Milvus hybrid search |
| 重排 | `reranker.service.js` | BGE-reranker-base cross-encoder |
| 检索管道 | `rag.service.js` | 混合检索→归并→rerank→截断→排序→组装 |
| 文档索引 | `indexing.service.js` | 章节合并→段落→句子三层切片 |

---

## 流式聊天架构

### 前端链路

```
ChatBox 输入框
  ↓ @send 事件
AIChat.vue 页面
  ↓ chatStore.sendMessage()
useStreaming composable
  ├─ 插入用户消息 + 空 AI 消息
  ├─ 构建历史上下文（最近 20 条，去重连续同角色）
  ├─ 合并 skillPrompt（来自 skill.store）
  ├─ 调用 sendMessageStream() → POST /api/stream
  └─ 绑定回调
       ├─ onChunk → RAF 合并文本 → 更新消息
       ├─ onSources → 写入来源引用
       ├─ onTrace → 写入检索链路追踪
       ├─ onDone → 自动生成标题、持久化
       └─ onError → 标记错误消息、可重试
```

### SSE 解析

```js
// 核心：fetch + ReadableStream + TextDecoder 解析 data: 行
fetch('/api/stream', { body: {...} })
  → response.body.getReader()
  → TextDecoder('utf-8') 增量解码
  → buffer 按 \n 拆行
  → 只处理 data: 开头的行
  → data: [DONE] 结束
  → JSON.parse 后分发回调
```

### 关键设计

| 问题 | 解决方案 |
|------|---------|
| 频繁更新触发大量重渲染 | `requestAnimationFrame` 合并 chunk，每帧只写一次 |
| 浏览器后台 Tab 暂停 RAF | `visibilitychange` 事件监听，切后台时立即落盘 |
| 快速切换会话导致 UI 错乱 | 每个 chunk 校验 `conversationId`，切换时自动 `abortCurrentRequest()` |
| 会话列表重排写错消息 | 不缓存 `convIndex`，每次写操作重新 `findIndex` 解析 |
| 流式响应超过 60s 无数据 | `STREAM_STALL_TIMEOUT=60000` 超时兜底 |
| 连接断开 | 指数退避重连（1s→2s→4s→...→30s），最多 3 次 |

---

## 状态管理设计

### Pinia 三层拆分

```
chat.store（聚合层）→ 页面统一接口
  ├─ conversation.store（会话数据）
  │   ├─ 会话列表、当前会话 ID
  │   ├─ localStorage 缓存（300ms 防抖增量保存）
  │   ├─ 后端 API 同步（500ms 防抖）
  │   └─ 本地 fallback（未登录时创建 local_ 会话）
  └─ message.store（流式过程）
      ├─ isLoading / currentStreamingId / isConnected
      ├─ sendMessage() / retryMessage() / abortCurrentRequest()
      └─ 委托 useStreaming composable
```

### 为什么这样拆

| 拆分 | 原因 |
|------|------|
| 会话 vs 消息 | 会话是"数据"（列表、ID、缓存），消息是"过程"（loading、流式状态），生命周期不同 |
| 聚合层 | 页面只关心 `chatStore.sendMessage()`，不关心内部组合 |
| 独立 store | 避免一个 store 同时承担数据建模、网络请求和 UI 状态 |

---

## 评测体系

### 整体架构

```
离线测试集（32 题，覆盖 6 个文档）
  ├─ eval-retrieval.js → 检索指标
  │   Recall@K / Precision@K / MRR / nDCG@5
  ├─ LLM-as-judge → 生成质量
  │   ├─ 独立 API Key（不跟生产抢配额）
  │   ├─ step-3.5-flash（temperature=0）
  │   ├─ 4 指标合并 1 次请求
  │   │   faithfulness / answer_relevancy
  │   │   context_precision / context_recall
  │   └─ 失败降级 → 关键词匹配
  ├─ 人工抽检（EvalScoring.vue）
  │   1-5 分打分、键盘快捷键、导入导出
  └─ 线上反馈（RagFeedback.vue）
      用户 like/dislike、来源追踪、分页筛选

回归评估：基线比对，指标变化 > 2% 告警
```

### LLM-as-judge 设计

| 属性 | 值 | 原因 |
|------|:---:|------|
| 模型 | step-3.5-flash | 小模型做 judge 够用，不浪费配额 |
| API Key | 独立 Key | 跟生产流量（step-3.7-flash）完全隔离，互不抢占 5 并发/10 RPM |
| Temperature | 0 | 评测需要确定性，不要创造力 |
| 请求合并 | 4 指标→1 次 | 128 次 API 调用降到 32 次 |
| 降级 | 关键词匹配 | API 失败时自动兜底，不卡死 |

---

## 流式聊天示例

请求：

```json
{
  "message": "武汉理工大学有几个校区？",
  "history": [],
  "conversationId": "conv_123",
  "files": []
}
```

SSE 响应：

```text
data: {"content":"武汉理工大学有"}
data: {"content":"三个校区，分别是"}
data: {"content":"马房山校区、余家头校区和南湖校区。"}
data: {"sources":[{"title":"校园手册","snippet":"..."}]}
data: [DONE]
```

---

## 环境变量

后端读取 `backend/.env`，生产部署读取 `deploy/.env.production`。前端只在需要跨域部署时读取根目录 `.env` 中的 `VITE_API_BASE_URL`。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 后端服务端口 |
| `NODE_ENV` | `development` | 运行环境；生产环境会托管 `dist/` |
| `AI_API_KEY` | 无 | 模型服务 Key，后端启动必填 |
| `AI_BASE_URL` | `https://api.stepfun.com/step_plan/v1` | OpenAI-compatible API 地址 |
| `AI_MODEL` | `step-3.7-flash` | 默认模型名称 |
| `LLM_CONCURRENCY` | `3` | 生产并发数（控制 API 请求排队） |
| `JUDGE_API_KEY` | 同 AI_API_KEY | LLM-as-judge 独立 Key（不跟生产抢配额） |
| `JUDGE_MODEL` | `step-3.5-flash` | 评测模型 |
| `JWT_SECRET` | 无 | JWT 签名密钥，后端启动必填 |
| `XUNFEI_API_KEY` | 空 | 讯飞相关 Key，可选 |
| `XUNFEI_APP_ID` | 空 | 讯飞 App ID |
| `EMBEDDING_MODEL` | `Xenova/bge-small-zh-v1.5` | 本地 Embedding 模型 |
| `EMBEDDING_CACHE_DIR` | `.model-cache` | 本地模型缓存目录 |
| `EMBEDDING_LOCAL_FILES_ONLY` | `true` | 是否只使用本地缓存模型 |
| `EMBEDDING_SPARSE_DIM` | `250002` | n-gram sparse 哈希空间大小 |
| `VECTOR_STORE_BACKEND` | `milvus` | 向量库后端；未连接时自动降级内存模式 |
| `MILVUS_ADDRESS` | `localhost:19530` | Milvus Lite / Milvus gRPC 地址 |
| `MILVUS_COLLECTION` | `wuli_elf_chunks` | 子块向量 collection |
| `MILVUS_DENSE_FIELD` | `dense_vector` | dense 向量字段 |
| `MILVUS_SPARSE_FIELD` | `sparse_vector` | sparse 向量字段 |
| `MILVUS_DENSE_WEIGHT` | `0.6` | Hybrid Search dense 权重 |
| `MILVUS_SPARSE_WEIGHT` | `0.4` | Hybrid Search sparse 权重 |
| `RAG_VECTOR_TOP_K` | `50` | Milvus Hybrid Search 候选数 |
| `RAG_RERANK_TOP_K` | `10` | 重排后进入父文档上下文的片段数 |
| `RAG_MAX_CONTEXT_LENGTH` | `6000` | 上下文最大字符数 |
| `RAG_MIN_SOURCE_SCORE` | `0.03` | 低于该分数时触发无可靠来源拒答 |
| `SCHOOL_TP_HOST` | `https://one.whut.edu.cn` | 武理统一身份认证地址 |
| `SCHOOL_JW_HOST` | `https://jwxt.whut.edu.cn` | 武理教务系统地址 |
| `SCHOOL_ENC_KEY` | 无 | 教务密码加密密钥，后端启动必填 |
| `SCHOOL_BROWSER_DEBUG_PORT` | `9222` | 教务爬取浏览器调试端口 |
| `REDIS_URL` | 无 | Redis 连接串；不填则使用本地 MemoryStore |
| `CORS_ORIGIN` | 无 | 生产环境必填，多个域名用英文逗号分隔 |
| `PUPPETEER_EXECUTABLE_PATH` | 无 | 容器内默认 `/usr/bin/chromium` |
| `VITE_API_BASE_URL` | `/api` | 前端 API 基础路径，跨域部署时设置 |

---

## 项目结构

```text
.
├── src/                         # Vue 3 前端源码
│   ├── api/                     # fetch 封装、聊天/SSE、RAG、教务、评测 API
│   ├── components/              # 聊天、通用、评测、布局组件
│   ├── composables/             # 流式输出、Markdown、懒加载、指标等复用逻辑
│   ├── i18n/                    # 多语言文案
│   ├── router/                  # Vue Router 与登录守卫
│   ├── stores/                  # Pinia：认证、会话、消息、提示词、Skills、MCP 等
│   ├── utils/                   # Markdown、错误、缓存、加密等工具
│   ├── views/                   # Login、AIChat、KnowledgeBase、EvalScoring、Settings
│   ├── workers/                 # Markdown Worker
│   └── __tests__/               # 前端测试
├── backend/
│   ├── src/
│   │   ├── app.js               # Express 入口
│   │   ├── config/              # 环境变量配置
│   │   ├── controllers/         # 聊天控制器
│   │   ├── middleware/          # CORS、Helmet、认证、限流等中间件
│   │   ├── routes/              # 会话、RAG、教务、评测路由
│   │   ├── services/            # AI、RAG、Embedding、Reranker、Judge、教务、指标服务
│   │   └── utils/               # HTTP 客户端、响应、文本切分工具
│   ├── __tests__/               # 后端测试
│   ├── data/                    # 本地 MemoryStore 数据
│   ├── uploads/                 # 后端上传文件
│   └── package.json
├── deploy/                      # nginx、生产 env 模板、部署脚本
├── scripts/rag-eval/            # RAG 评测脚本与数据集
├── data/                        # 项目数据目录
├── uploads/                     # 上传文件目录
├── Dockerfile                   # 前端构建 + 后端运行镜像
├── docker-compose.yml           # nginx + backend + redis 生产编排
├── vite.config.js               # Vite 配置与开发代理
└── README.md
```

---

## 模型与数据库

### AI 模型

| 用途 | 模型 | 部署方式 | 说明 |
|------|------|---------|------|
| 主对话 | step-3.7-flash | StepFun API | 生产聊天，支持图文多模态 |
| 评测 judge | step-3.5-flash | StepFun API（独立 Key） | LLM-as-judge，不跟生产抢配额 |
| Embedding | BGE-small-zh-v1.5 | 本地 ONNX（@xenova/transformers） | 512 维稠密向量，24MB |
| Reranker | BGE-reranker-base | 本地 ONNX（cross-encoder） | 语义重排，INT8，278MB |

### 数据库与存储

| 类型 | 技术 | 用途 | 部署方式 |
|------|------|------|---------|
| 向量库 | Milvus 2.4.17 | 稠密+稀疏向量混合检索 | Docker Standalone（19530） |
| 业务数据 | SQLite | 文档元数据、用户信息、会话记录 | 文件持久化（backend/data/） |
| 缓存 | MemoryStore | 会话列表缓存 | 内存（无 Redis 时降级） |
| 可选缓存 | Redis | 高性能会话缓存 | 配置 REDIS_URL 启用 |

### 部署架构

```text
用户浏览器
  │
  ▼
nginx:80/443（SSL 终止）
  │
  ▼
Express:3000（API + 静态资源）
  │
  ├── Milvus:19530（向量检索）
  ├── SQLite（文档/用户/会话持久化）
  └── StepFun API（LLM 推理）
```

---

## 技术栈

### 前端

- Vue 3.5、Composition API、Vue Router 4、Pinia
- Vite 6、Tailwind CSS 4、lucide-vue-next、Element Plus Icons
- markdown-it、highlight.js、DOMPurify、Web Worker
- vue-virtual-scroller、Vitest、Vue Test Utils、jsdom

### 后端

- Node.js 20、Express 4、cookie-parser、jsonwebtoken
- ONNX 本地模型：BGE-small-zh（Embedding）、BGE-reranker-base（重排）
- Milvus 2.4.17 Hybrid Search（稠密×0.6 + 稀疏×0.4）
- LLM：StepFun step-3.7-flash（生产）、step-3.5-flash（评测，独立 Key）
- multer、pdf-parse、mammoth、Puppeteer
- Helmet、CORS、express-rate-limit、morgan

### 部署

- Docker 多阶段构建：前端构建产物 + 后端运行环境
- Docker Compose：nginx SSL 反代 + backend + Milvus
- GitHub Actions：Lint、Test、Build、Push、Deploy to ECS

---

## 生产部署

推荐使用 Docker Compose 部署：

```bash
cp deploy/.env.production.example deploy/.env.production
# 编辑 deploy/.env.production，填写 AI_API_KEY、JWT_SECRET、SCHOOL_ENC_KEY、CORS_ORIGIN 等

docker compose -p wuli-elf up -d --build
docker compose -p wuli-elf logs -f
curl http://localhost:3000/api/health
```

生产结构：

```text
用户 → nginx(80/443, SSL 终止) → backend(Express API + dist 静态资源) → Milvus
```

完整证书、ECS 安全组、CI/CD 和运维命令见 [deploy/README.md](deploy/README.md)。

---

## 许可与联系

- 项目地址：https://github.com/L123121/Vue3_WUT_LLM
- 问题反馈：GitHub Issues