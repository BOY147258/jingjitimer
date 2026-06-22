# 竞迹计时器 (JingJi Timer)

精准计时 · 智能田径 | Precision Timing for Athletics

---

## 📋 目录

- [功能特点](#-功能特点)
- [快速开始](#-快速开始)
- [使用指南](#-使用指南)
- [部署方式](#-部署方式)
- [API 文档](#-api-文档)
- [开发指南](#-开发指南)
- [常见问题](#-常见问题)

---

## ✨ 功能特点

### 核心功能

| 功能 | 描述 |
|------|------|
| 🔫 **枪声检测** | 自动检测发令枪声，精确控制计时开始 |
| 🏁 **AI 终点识别** | 智能识别运动员冲线，支持慢动作回放 |
| 🔗 **多设备同步** | WebSocket 实时同步，支持发令端+终点端+成绩端 |
| 📊 **多格式导出** | 支持 CSV、Excel、PDF 多种导出格式 |
| 🌐 **PWA 支持** | 可安装到桌面，离线也能用 |
| 🌍 **多语言** | 中文/English 随时切换 |

### 技术亮点

- **高精度计时**：毫秒级精度，支持电子计时器标准
- **离线优先**：IndexedDB 本地存储，网络恢复自动同步
- **响应式设计**：适配手机、平板、电脑各种屏幕
- **无障碍支持**：完整的 ARIA 标签和键盘导航

---

## 🚀 快速开始

### 方式一：直接使用（推荐）

访问线上版本：

| 服务器 | 地址 |
|--------|------|
| Railway | https://jingjitimer.onrender.com |
| Render | https://jingjitimer-render.onrender.com |

### 方式二：本地部署

```bash
# 克隆项目
git clone https://github.com/BOY147258/jingjitimer.git
cd jingjitimer

# 安装依赖
npm install

# 启动服务
npm start
# 或
node serve.js
```

### 方式三：使用 Python

```bash
python serve.py
```

---

## 📖 使用指南

### 角色选择

打开应用后，选择设备角色：

| 角色 | 图标 | 用途 |
|------|------|------|
| 📱 单机模式 | 一台设备完成所有操作 |
| 🔫 发令端 | 检测枪声，控制计时开始 |
| 🏁 终点端 | AI 识别冲线，慢动作回放 |
| 📋 成绩端 | 实时接收成绩，导出数据 |

### 连接流程

#### 多设备模式

```
1. 发令端：设置房间码 → 等待连接
2. 终点端：输入房间码 → 连接发令端
3. 成绩端：（可选）输入房间码 → 接收成绩
```

### 比赛操作

#### 发令端
- **手动发令**：点击按钮或按空格键
- **枪声发令**：自动检测枪声开始计时
- **抢跑召回**：检测到抢跑时可召回

#### 终点端
- 确保摄像头对准终点线
- AI 自动识别运动员冲线
- 支持手动补录漏记成绩

### 快捷键

| 按键 | 功能 |
|------|------|
| `空格` | 发令/停止 |
| `1-8` | 选择道次 |
| `Enter` | 记录成绩 |
| `Esc` | 取消/返回 |
| `e` | 导出成绩 |
| `?` | 显示帮助 |

---

## 🖥️ 部署方式

### 静态部署（推荐）

适用于 Vercel、Netlify、GitHub Pages 等静态托管：

```bash
# 推送到 GitHub
git push origin main

# 在 Vercel/Netlify 导入即可
```

### Node.js 部署

适用于 Railway、Render、Heroku 等：

```bash
# 设置环境变量
export PORT=3000

# 启动
npm start
```

### Docker 部署

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "serve.js"]
```

### 一键部署到 Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

或使用 `render.yaml` 配置文件。

---

## 📡 API 文档

### WebSocket 消息

```javascript
// 连接
ws://server:port?room={roomCode}&role={role}

// 消息格式
{
  type: "START_RACE",
  payload: { timestamp: 1699999999000 },
  roomCode: "1234"
}
```

### REST API

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/meets` | GET/POST | 比赛列表/创建比赛 |
| `/api/events` | GET/POST | 项目列表/创建项目 |
| `/api/results` | POST | 保存成绩 |
| `/api/rank` | POST | 排名计算 |

详细文档请查看 [docs/API.md](docs/API.md)

---

## 🛠️ 开发指南

### 项目结构

```
jingjitimer/
├── index.html          # 主页面
├── admin.html          # 管理页面
├── sw.js               # Service Worker
├── manifest.json       # PWA 配置
│
├── js/                 # JavaScript 模块
│   ├── app.js          # 主应用逻辑
│   ├── timer.js        # 计时器核心
│   ├── audio.js        # 音频检测
│   ├── recorder.js      # 视频录制
│   ├── finishline.js   # 终点线检测
│   ├── sync2.js        # WebSocket 同步
│   ├── export.js       # 数据导出
│   ├── i18n.js         # 国际化
│   ├── idb.js          # IndexedDB
│   ├── state.js        # 状态管理
│   ├── storage.js      # 本地存储
│   ├── ui-helpers.js   # UI 辅助函数
│   ├── performance.js  # 性能监控
│   ├── guide.js        # 用户引导
│   └── types.d.ts      # TypeScript 类型
│
├── css/                # 样式文件
│   └── app.css         # 主样式
│
├── docs/               # 文档
│   └── API.md          # API 文档
│
└── icons/              # 图标资源
```

### 开发命令

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 测试
npm test

# 代码检查
npm run lint
```

### 添加新模块

```javascript
// 在 app.js 中导入
import { myModule } from './my-module.js';

// 初始化
myModule.init();
```

---

## 🔧 配置选项

### 环境变量

| 变量 | 默认值 | 描述 |
|------|--------|------|
| `PORT` | 3000 | 服务端口 |
| `WS_PORT` | 3001 | WebSocket 端口 |
| `CORS_ORIGIN` | * | CORS 允许的域名 |

### 浏览器要求

- Chrome 80+
- Firefox 75+
- Safari 14+
- Edge 80+

需要支持：
- WebSocket
- MediaDevices API
- IndexedDB
- Service Worker

---

## ❓ 常见问题

### Q: 枪声检测不灵敏？

A: 确保麦克风权限已授权，尝试靠近音源或调整灵敏度设置。

### Q: 终点线识别有误？

A: 检查摄像头角度，确保光线充足，可在设置中调整检测区域。

### Q: 多设备连接失败？

A: 检查网络连接，确认房间码一致，防火墙未阻止 WebSocket 端口。

### Q: 离线时数据会丢失吗？

A: 不会。数据会自动保存到 IndexedDB，网络恢复后自动同步。

### Q: 如何导出成绩？

A: 在成绩页面点击导出按钮，选择 CSV/Excel/PDF 格式。

---

## 📄 许可证

MIT License

## 🙏 致谢

- 图标来源：[Emoji](https://emojipedia.org/)
- 计时精度：[performance.now()](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now)
- 设计参考：[Apple Human Interface Guidelines](https://developer.apple.com/design/)

---

<p align="center">
  <strong>竞迹计时器</strong> - 让每一次冲线都有精准记录
</p>
