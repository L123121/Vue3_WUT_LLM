# 教务系统登录改造方案

## 问题
CAS 统一认证登录成功，但 jwxt 服务器不验证 CAS ticket（服务端配置问题）。本地登录使用 DES 加密，密码体系独立。

## 方案：Puppeteer 无头浏览器自动登录

用 Puppeteer 启动无头 Chromium，模拟浏览器完成 CAS 登录流程。浏览器天然处理重定向、Cookie、ticket 验证。

### 流程
```
用户首次查询 → getSession() 无缓存 → Puppeteer 启动无头浏览器
  → 打开 CAS 登录页 → 填入学号密码 → 点击登录
  → 浏览器自动跟随重定向 → 到达 jwxt 主页
  → 提取 jwxt Cookie → 缓存 2 小时 → 关闭浏览器
  → 用 Cookie 调用 API
```

### 改动文件

#### 1. `backend/src/services/school-session.service.js`
- 重写 `login()` 方法，用 Puppeteer 替代手动 CAS 流程
- 保持 `getSession()` / `invalidateSession()` / `encrypt()` / `decrypt()` 接口不变
- 保持 AES-256-GCM 加密逻辑不变
- 优先连接本地已运行的 Edge（`--remote-debugging-port=9222`）
- 如果 Edge 不可用，用 puppeteer 自动下载的 Chromium 无头模式

#### 2. `backend/package.json`
- 添加 `puppeteer` 依赖（自动下载 Chromium）

#### 3. `backend/src/config/index.js`
- 添加 `school.browserDebugPort` 配置（默认 9222）

### 不改动的文件
- `school-api.service.js` — API 调用不变
- `school.routes.js` — 路由不变
- `agent-tools.js` — Agent 工具不变
