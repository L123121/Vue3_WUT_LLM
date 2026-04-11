# 武理小精灵 / WUT Assistant

![状态](https://img.shields.io/badge/%E7%8A%B6%E6%80%81-%E6%B4%BB%E8%B7%83-success) ![版本](https://img.shields.io/badge/%E7%89%88%E6%9C%AC-1.0.0-blue) ![许可证](https://img.shields.io/badge/%E8%AE%B8%E5%8F%AF%E8%AF%81-MIT-green)

简短描述：武理小精灵是一个基于 Vue 3 + Pinia 的 AI 聊天应用，支持多会话管理、流式输出、GitHub Skills 导入，使用讯飞/Qwen 模型提供智能对话能力。

Brief description: WUT Assistant is an AI chat application built with Vue 3 + Pinia. It features multi-conversation management, streaming output, GitHub Skills import, and is powered by iFlyTek/Qwen models.

## 目录 / Table of Contents
- [功能特性 / Features](#功能特性--features)
- [演示 / Demo & Screenshots](#演示--screenshots)
- [快速开始 / Quick Start](#快速开始--quick-start)
- [安装 / Installation](#安装--installation)
- [使用方法 / Usage](#使用方法--usage)
- [配置 / Configuration](#配置--configuration)
- [项目结构 / Project Structure](#项目结构--project-structure)
- [技术栈 / Tech Stack](#技术栈--tech-stack)
- [贡献 / Contributing](#贡献--contributing)
- [许可证 / License](#许可证--license)

---

## ✨ 功能特性 / Features

### 核心功能
- **AI 智能对话**：基于 Vue 3 + Composition API 的即时聊天界面（`src/views/AIChat.vue`）
- **流式输出**：SSE (Server-Sent Events) 流式渲染，打字机效果实时显示 AI 回复
- **多会话管理**：支持创建、切换、重命名、删除会话，会话按更新时间排序
- **GitHub Skills 导入**：支持从 GitHub 导入 SKILL.md 文件，自定义 AI 回答风格

### 用户体验
- **代码高亮与复制**：支持 Markdown 渲染、代码高亮（highlight.js）与一键复制
- **深色模式**：支持日间/夜间主题切换，状态持久化
- **国际化**：支持中文/英文切换，即时生效
- **本地持久化**：聊天记录、会话、主题、语言设置自动保存到 localStorage

### 技术特点
- **前后端分离**：前端通过 `/api` 调用后端 Express 服务
- **模拟与真实模式**：未配置 API Key 时自动切换到模拟模式，便于本地开发

---

## 🖼️ 演示 / Screenshots

![主界面截图](image.png)

---

## 🚀 快速开始 / Quick Start

### 前提条件 / Prerequisites

- Node.js >= 18
- npm 或 pnpm

### 启动前端（在项目根目录）

```bash
npm install
npm run dev
```

### 启动后端（在 `backend/` 目录）

```bash
cd backend
npm install
npm run dev
```

前端默认运行在 `http://localhost:5173`，后端默认运行在 `http://localhost:3000`。

---

## 📦 安装 / Installation

1. 克隆仓库

```bash
git clone https://github.com/L123121/Vue3_WUT_LLM.git
cd Vue3_WUT_LLM
```

2. 安装前端依赖并运行

```bash
npm install
npm run dev
```

3. 安装并运行后端

```bash
cd backend
npm install
npm run dev
```

4. 配置环境变量（可选）

```bash
cp backend/.env.example backend/.env
# 编辑 backend/.env, 填入讯飞/Qwen 相关配置
```

---

## 📖 使用方法 / Usage

### 登录
- 访问 `http://localhost:5173/login`
- 输入任意账号，密码为 `123456` 即可登录

### AI 聊天
- 登录后自动进入聊天页面
- 在输入框输入问题，按 Enter 或点击发送
- AI 会以流式方式实时返回回复

### 会话管理
- 左侧边栏显示所有会话列表
- 点击 `+` 创建新会话
- 点击会话标题可重命名
- 点击删除图标可删除会话

### Skills 功能
- 点击聊天界面右上角的 `Skills` 按钮
- 粘贴 GitHub SKILL.md 文件的链接（如 `https://github.com/xxx/blob/main/SKILL.md`）
- 点击导入，Skills 会作为系统提示增强 AI 回答风格

---

## ⚙️ 配置 / Configuration

### 环境变量

| 环境变量 | 默认值 | 描述 |
|---|---:|---|
| XUNFEI_API_KEY | (无) | 讯飞/Qwen 服务的 API Key |
| PORT | 3000 | 后端监听端口 |

### localStorage 键名

| 键名 | 描述 |
|---|---|
| chat_conversations | 所有聊天会话 |
| chat_current_conversation_id | 当前会话 ID |
| chat_skills | 已导入的 Skills |
| darkMode | 深色模式状态 |
| app_language | 界面语言 |

---

## 📁 项目结构 / Project Structure

```
项目根目录/
├── backend/                # Express 后端代码
│   ├── src/
│   │   ├── services/       # AI 服务适配实现
│   │   ├── routes/         # 路由
│   │   └── app.ts          # Express 启动入口
│   └── package.json
├── public/                 # 静态资源
├── src/                    # 前端源代码 (Vue 3 + Pinia)
│   ├── views/
│   │   ├── Login.vue       # 登录页面
│   │   └── AIChat.vue      # 聊天主界面
│   ├── components/
│   │   ├── chat/           # 聊天相关组件
│   │   │   ├── ChatBox.vue         # 输入框
│   │   │   ├── MessageList.vue     # 消息列表
│   │   │   ├── ConversationList.vue # 会话列表
│   │   │   ├── MarkdownRenderer.vue # Markdown 渲染
│   │   │   ├── VoiceRecorder.vue   # 语音输入
│   │   │   └── SkillPanel.vue      # Skills 面板
│   │   ├── layout/
│   │   │   └── Sidebar.vue         # 侧边栏
│   │   └── common/
│   │       └── ToastManager.vue    # 全局提示
│   ├── stores/             # Pinia 状态管理
│   │   ├── auth.store.js   # 用户认证
│   │   ├── chat.store.js   # 聊天状态
│   │   ├── skill.store.js  # Skills 管理
│   │   ├── theme.store.js  # 主题状态
│   │   ├── language.store.js # 语言状态
│   │   └── toast.store.js  # 提示状态
│   ├── api/                # 前端请求封装
│   │   ├── auth.js
│   │   └── chat.js
│   ├── i18n/
│   │   └── messages.js     # 国际化文案
│   ├── router/
│   │   └── index.js        # 路由配置
│   ├── App.vue             # 根组件
│   └── main.js             # 入口文件
├── package.json
├── vite.config.js
└── README.md
```

---

## 🛠️ 技术栈 / Tech Stack

### 前端
- **Vue 3** - 渐进式 JavaScript 框架
- **Pinia** - Vue 状态管理
- **Vue Router** - 路由管理
- **Tailwind CSS** - 原子化 CSS 框架
- **Vite** - 下一代前端构建工具
- **highlight.js** - 代码高亮
- **markdown-it** - Markdown 解析
- **lucide-vue-next** - 图标库

### 后端
- **Node.js** - JavaScript 运行时
- **Express** - Web 框架
- **讯飞 Spark MaaS / Qwen** - 大语言模型服务

---

## 🤝 贡献 / Contributing

欢迎贡献！流程：

1. Fork 本仓库
2. 新建分支：`git checkout -b feature/YourFeature`
3. 提交并推送：`git commit -m "feat: 描述你的改动" && git push origin feature/YourFeature`
4. 提交 PR 并在描述中说明改动与测试方式

---

## 📄 许可证 / License

本项目使用 MIT 许可证 — 详见 `LICENSE` 文件。

---

## 🙏 致谢 / Acknowledgments

- 感谢讯飞/Qwen 提供的模型接口
- 感谢使用的开源库：Vue 3、Pinia、Vite、Tailwind CSS、highlight.js 等

---

## 联系方式 / Contact

- 项目链接：https://github.com/L123121/Vue3_WUT_LLM
- 问题反馈：请通过 GitHub Issues 提交
