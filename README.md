# WUT RAG Copilot / 武理小精灵

![状态](https://img.shields.io/badge/%E7%8A%B6%E6%80%81-%E6%B4%BB%E8%B7%83-success) ![版本](https://img.shields.io/badge/%E7%89%88%E6%9C%AC-2.0.0-blue) ![Vue](https://img.shields.io/badge/Vue-3.5-brightgreen) ![Node](https://img.shields.io/badge/Node-18+-yellow)

基于 RAG 知识库增强的武理校园 AI 助手。支持文件上传对话、Markdown 渲染、多会话管理、流式输出、语音输入、深色模式，使用讯飞星火 / 通义千问大模型。

A RAG-enhanced AI copilot for WUT campus — file chat, Markdown rendering, multi-conversation, streaming output, voice input, dark mode, powered by iFlyTek Spark / Qwen LLM.

---

## ✨ 功能特性

### 核心功能
- **AI 智能对话** — Vue 3 + Composition API 即时聊天界面
- **流式输出 (SSE)** — 打字机效果实时显示 AI 回复
- **文件上传对话** — 支持上传图片、PDF、Word、TXT 文件，AI 自动读取内容（📎 按钮）
- **多会话管理** — 创建、切换、重命名、删除会话，本地持久化
- **RAG 知识库** — 文档上传 → 向量化 → 检索增强回答
- **GitHub Skills 导入** — 导入 SKILL.md 定制 AI 回答风格
- **提示词管理** — 自定义系统提示词，按分类筛选
- **Markdown 渲染** — 标题、粗体、代码块（highlight.js + 动态语言加载）、表格等
- **语音输入** — 浏览器语音识别（中文）

### 用户体验
- **深色模式** — 日间/夜间主题切换，状态持久化
- **代码高亮与复制** — 一键复制代码块
- **消息重试** — 失败的消息可重新发送
- **对话导出** — 导出为 Markdown 文件
- **本地持久化** — 聊天记录自动保存到 localStorage，刷新不丢失
- **跨标签页保持** — 切换路由/标签页聊天记录不丢失

### 技术特点
- **前后端分离** — 前端通过 `/api` 调用后端 Express 服务
- **模拟模式** — 未配置 API Key 时自动使用模拟响应，本地开发零配置
- **In-Memory 存储** — 无需 Redis，数据持久化到 JSON 文件
- **Web Worker** — 大篇幅 Markdown 渲染在 Worker 线程中执行，不阻塞 UI
- **连接状态管理** — 心跳检测 + 断线自动重连 + 待发送队列

---

## 🖼️ 演示

![主界面](image.png)
![会话页面](会话页面.png)
![知识库](知识库.png)

---

## 🚀 快速开始

### 前提条件

- Node.js >= 18
- npm

### 启动前端（项目根目录）

```bash
npm install
npm run dev
```

### 启动后端（`backend/` 目录）

```bash
cd backend
npm install
npm run dev
```

前端 → `http://localhost:5173`，后端 → `http://localhost:3000`。

---

## 📦 安装

```bash
git clone https://github.com/L123121/Vue3_WUT_LLM.git
cd Vue3_WUT_LLM

# 前端
npm install
npm run dev

# 后端
cd backend
npm install
npm run dev

# 环境变量（可选）
cp backend/.env.example backend/.env
# 编辑 backend/.env, 填入 API Key
```

---

## 📖 使用方法

### 登录
访问 `http://localhost:5173/login`，任意账号 + 密码 `123456`。

### AI 聊天
输入框输入问题，Enter 发送。AI 流式返回回复。

### 文件上传
点击输入框左侧 📎 按钮，选择文件（支持图片/PDF/Word/TXT），AI 自动读取文件内容并回答。

### 会话管理
左侧边栏：`+` 创建新会话、点击标题重命名、删除图标删除。

### RAG 知识库
上传文档到知识库 → 聊天时点 `知识库` 按钮启用，AI 基于知识库内容回答。

### Skills 功能
聊天界面右上角 `Skills` → 粘贴 GitHub SKILL.md 链接 → 导入生效。

### 提示词功能
右上角 `提示词` → 新建/编辑/删除提示词，选中后作为系统提示生效。

---

## 📚 API 文档

### 接口列表

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api` | API 列表 |
| POST | `/api` | 聊天接口 |
| POST | `/api/chat` | 聊天接口（兼容） |
| POST | `/api/stream` | SSE 流式聊天（支持 RAG + 文件） |
| POST | `/api/chat/upload` | 聊天文件上传 |
| POST | `/api/chat/title` | 生成会话标题 |
| GET | `/api/conversations` | 获取会话列表 |
| POST | `/api/conversations` | 创建会话 |
| GET | `/api/conversations/:id` | 会话详情 |
| PUT | `/api/conversations/:id` | 更新会话 |
| DELETE | `/api/conversations/:id` | 删除会话 |
| POST | `/api/rag/upload` | 上传知识库文档 |
| POST | `/api/rag/search` | 知识库检索 |
| POST | `/api/auth/login` | 用户登录 |

### POST `/api/stream` — 流式聊天

```json
{
  "message": "你好",
  "history": [],
  "conversationId": "conv_123",
  "enableRag": true,
  "files": [{ "name": "手册.pdf", "textContent": "...", "isImage": false }]
}
```

SSE 响应：
```
data: {"content": "你"}
data: {"content": "好"}
data: [DONE]
```

### POST `/api/chat/upload` — 文件上传

`multipart/form-data`，字段名 `file`。返回：
```json
{
  "success": true,
  "data": {
    "url": "/uploads/xxx",
    "name": "考试要点.docx",
    "textContent": "...",
    "isImage": false
  }
}
```

---

## ⚙️ 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AI_API_KEY` | (无) | LLM API Key |
| `AI_BASE_URL` | `https://maas-api.cn-huabei-1.xf-yun.com/v2` | API 地址 |
| `AI_MODEL` | `xopqwen36v35b` | 模型名 |
| `AI_MAX_TOKENS` | `4000` | 最大 Token |
| `PORT` | `3000` | 后端端口 |
| `JWT_SECRET` | `wut-rag-copilot-secret-key` | JWT 密钥 |

### localStorage 键名

| 键名 | 说明 |
|------|------|
| `chat_local_conversations_cache` | 会话列表缓存 |
| `chat_current_conversation_id` | 当前会话 ID |
| `chat_msgs_direct` | 消息直接备份 |
| `chat_messages_backup` | 消息备份（独立） |
| `chat_skills` | 已导入的 Skills |
| `custom_prompts` | 自定义提示词 |
| `darkMode` | 深色模式状态 |
| `token` | JWT Token |
| `tms_currentUser` | 当前用户信息 |

---

## 📁 项目结构

```
├── backend/                     # Express 后端
│   ├── src/
│   │   ├── app.js              # 入口 + 路由 + 中间件
│   │   ├── config/index.js     # 配置（环境变量读取）
│   │   ├── services/
│   │   │   ├── ai.service.js       # AI 服务（OpenAI 兼容）
│   │   │   ├── xunfei.service.js   # 讯飞星火服务
│   │   │   ├── chat.service.js     # 聊天业务
│   │   │   ├── rag.service.js      # RAG 服务
│   │   │   ├── chroma.service.js   # Chroma 向量数据库
│   │   │   ├── embedding.service.js # 向量化
│   │   │   ├── document.service.js  # 文档处理
│   │   │   ├── memory-store.js      # 内存存储 + JSON 文件持久化
│   │   │   ├── auth.service.js      # 认证
│   │   │   └── file-upload.service.js # 文件上传（multer）
│   │   ├── controllers/
│   │   │   └── chat.controller.js   # 标题生成等
│   │   └── routes/
│   │       ├── index.js
│   │       ├── auth.routes.js
│   │       ├── rag.routes.js
│   │       └── conversations.routes.js
│   └── package.json
├── src/                         # Vue 3 前端
│   ├── views/
│   │   ├── Login.vue
│   │   └── AIChat.vue           # 聊天主界面
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChatBox.vue          # 输入框（含文件上传）
│   │   │   ├── MessageList.vue      # 消息列表
│   │   │   ├── MessageBubble.vue    # 单条消息气泡
│   │   │   ├── MarkdownRenderer.vue # Markdown 渲染
│   │   │   ├── CodeBlock.vue        # 代码块组件
│   │   │   ├── LazyMessage.vue      # 懒加载消息
│   │   │   ├── VoiceRecorder.vue    # 语音输入
│   │   │   ├── ConversationList.vue # 会话列表
│   │   │   ├── SkillPanel.vue       # Skills 面板
│   │   │   ├── PromptPanel.vue      # 提示词面板
│   │   │   └── CodeRunner.vue       # 代码运行器
│   │   ├── layout/
│   │   │   └── Sidebar.vue
│   │   └── common/
│   │       ├── SettingsPanel.vue
│   │       ├── ProfilePanel.vue
│   │       └── ErrorBoundary.vue
│   ├── stores/                  # Pinia 状态管理
│   │   ├── auth.store.js
│   │   ├── chat.store.js        # 组合 store
│   │   ├── conversation.store.js # 会话管理 + localStorage 持久化
│   │   ├── message.store.js     # 消息发送/流式接收
│   │   ├── skill.store.js
│   │   ├── prompt.store.js
│   │   ├── theme.store.js
│   │   ├── language.store.js
│   │   └── toast.store.js
│   ├── api/
│   │   ├── client.js            # 请求封装（认证头）
│   │   ├── chat.js              # 聊天 API + SSE 流式
│   │   ├── auth.js
│   │   └── conversations.js
│   ├── composables/
│   │   ├── useMarkdownRenderer.js
│   │   ├── useCodeHighlighter.js
│   │   └── useChat.js
│   ├── utils/
│   │   ├── chatHelpers.js
│   │   └── errorHandler.js
│   ├── workers/
│   │   └── markdown.worker.js   # Web Worker（大 Markdown 渲染）
│   └── __tests__/
├── uploads/                     # 上传文件存储
├── data/                        # 持久化数据
│   └── store.json               # 后端内存存储的持久化文件
├── package.json
├── vite.config.js
└── README.md
```

---

## 🛠️ 技术栈

### 前端
- **Vue 3.5** — Composition API + `<script setup>`
- **Pinia 2.1** — 状态管理
- **Vue Router 4** — 路由
- **Tailwind CSS 4** — 原子化 CSS
- **Vite 6** — 构建工具
- **highlight.js** — 代码高亮（动态语言加载）
- **markdown-it** — Markdown 解析
- **lucide-vue-next** — 图标
- **DOMPurify** — XSS 防护
- **Web Worker** — 离线渲染

### 后端
- **Node.js + Express 4**
- **jsonwebtoken** — JWT 认证
- **multer** — 文件上传
- **mammoth** — Word 文档解析
- **pdf-parse** — PDF 解析
- **helmet** — 安全头
- **morgan** — 日志
- **express-rate-limit** — 速率限制

### 数据存储
- **In-Memory + JSON 文件** — 会话数据持久化（替代 Redis）
- **localStorage** — 前端缓存与备份
- **Chroma** — 向量数据库（RAG 知识库）

### AI 服务
- **讯飞星火大模型 / 通义千问**（OpenAI 兼容接口）

---

## 🤝 贡献

1. Fork → `git checkout -b feature/xxx`
2. Commit → Push → PR

### 提交规范
`feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore`

---

## 📄 许可证

MIT

---

## 联系方式

- 项目: https://github.com/L123121/Vue3_WUT_LLM
- Issues: GitHub Issues
