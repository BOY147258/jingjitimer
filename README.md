# 🏃 竞迹 JingJi - 精准计时系统

<div align="center">

![Logo](icons/icon.svg)

**精准计时 · 智能田径**

AI 发令检测 | 终点自动识别 | 慢动作回放 | 多设备同步

[![GitHub Stars](https://img.shields.io/github/stars/BOY147258/jingjitimer?style=social)](https://github.com/BOY147258/jingjitimer)
[![License](https://img.shields.io/github/license/BOY147258/jingjitimer)](https://github.com/BOY147258/jingjitimer/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/BOY147258/jingjitimer)

</div>

---

## 📋 目录

- [特性](#-特性)
- [快速开始](#-快速开始)
- [功能介绍](#-功能介绍)
- [部署指南](#-部署指南)
- [开发指南](#-开发指南)
- [API 文档](#-api-文档)
- [更新日志](#-更新日志)
- [贡献指南](#-贡献指南)
- [许可证](#-许可证)

---

## ✨ 特性

### 🎯 四大角色模式

| 模式 | 说明 |
|------|------|
| **单机模式** | 一台设备，手动记录终点 |
| **发令端** | 检测枪声，自动控制计时开始 |
| **终点端** | AI 自动识别冲线，慢动作回放 |
| **成绩端** | 实时接收成绩，随时导出 Excel |

### 🏆 核心功能

- 🚀 **高精度计时** - 毫秒级精度，稳定可靠
- 🎤 **AI 发令检测** - 自动检测发令枪声，无需手动开始
- 📹 **终点自动识别** - AI 视觉识别运动员冲线瞬间
- 🔄 **慢动作回放** - 关键时刻逐帧回放，仲裁争议
- 📊 **成绩管理** - 支持查询、筛选、导出 Excel
- 🔗 **多设备同步** - WebSocket 实时同步，房间码配对
- 📱 **PWA 支持** - 可安装到桌面/手机，离线可用
- 📤 **CSV 导入** - 批量导入运动员名单
- 🎥 **录像叠加** - 实时录像，成绩可视化

### 🎨 技术特点

- 🌐 **纯前端实现** - 无需复杂后端，开箱即用
- 📦 **轻量级部署** - 支持多种部署方式
- 🔧 **灵活配置** - 道次、距离、灵敏度可调
- 🌐 **多语言支持** - 中文界面，易于使用

---

## 🚀 快速开始

### 方式一：直接使用（推荐）

直接在浏览器中打开，无需安装：

```
直接访问: https://boy147258.github.io/jingjitimer/
```

### 方式二：本地部署

#### 使用 Node.js

```bash
# 克隆项目
git clone https://github.com/BOY147258/jingjitimer.git
cd jingjitimer

# 安装依赖
npm install

# 启动 WebSocket 服务器
npm start

# 或启动开发服务器（另一个终端）
npm run dev
```

#### 使用 Python

```bash
# 克隆项目
git clone https://github.com/BOY147258/jingjitimer.git
cd jingjitimer

# 启动服务器
python serve.py

# 然后在浏览器打开 http://localhost:8080
```

### 方式三：Docker 部署

```bash
# 构建镜像
docker build -t jingjitimer .

# 运行容器
docker run -d -p 8080:8080 --name jingjitimer jingjitimer
```

### 方式四：云部署

#### Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

#### Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new)

---

## 📖 功能介绍

### 主界面 (index.html)

主计时界面，支持所有角色模式切换：

- 四种模式切换：单机/发令端/终点端/成绩端
- 基础设置：道次数量、比赛距离、运动员名单
- 高级选项：发令方式、灵敏度、录像开关
- 实时控制：发令/开始、停止计时、召回重来

### 管理后台 (admin.html)

成绩管理中心：

- 📈 **数据统计** - 组数、成绩数、房间数统计
- 🔍 **成绩查询** - 多条件筛选（房间/距离/日期）
- 📤 **数据导出** - CSV 批量导出
- 🗑️ **数据管理** - 刷新、清除操作

### 二维码连接 (qrcode.html)

多设备配对工具：

- 生成房间码二维码
- 扫描连接其他设备
- 查看连接状态

### 简化版 (simple.html)

轻量级计时界面，适合快速计时场景。

### 启动引导 (starter-flow.html)

新用户引导流程，帮助快速上手。

---

## 🌐 部署指南

### 云端部署（无需服务器）

#### GitHub Pages（推荐）

1. Fork 本项目
2. 进入 Settings → Pages
3. Source 选择 `main` 分支
4. 访问 `https://你的用户名.github.io/jingjitimer/`

#### Netlify

1. 注册 [Netlify](https://netlify.com)
2. New site from Git
3. 选择本仓库
4. Deploy

#### Vercel

1. 注册 [Vercel](https://vercel.com)
2. Import Project
3. 选择本仓库
4. Deploy

### 自建服务器

#### 使用已有后端

在 `api.js` 中配置后端地址：

```javascript
const API_BASE_URL = 'https://你的后端地址.com';
const WS_URL = 'wss://你的WebSocket地址.com';
```

#### 完全自托管

```bash
# 使用 Node.js
npm install
npm start  # WebSocket 服务器
npm run dev  # HTTP 服务器
```

---

## 🛠️ 开发指南

### 项目结构

```
jingjitimer/
├── index.html          # 主界面
├── admin.html          # 管理后台
├── qrcode.html         # 二维码连接
├── simple.html         # 简化版
├── starter-flow.html   # 启动引导
├── manifest.json       # PWA 配置
├── sw.js               # Service Worker
│
├── css/
│   ├── app.css         # 主样式
│   └── admin.css       # 管理后台样式
│
├── js/
│   ├── app.js          # 主应用
│   ├── app-controller.js  # 控制器
│   ├── timer.js        # 计时器核心
│   ├── audio.js        # 音频处理
│   ├── recorder.js     # 录像功能
│   ├── finishline.js   # 终点识别
│   ├── ai-detector.js  # AI 检测
│   ├── shot-manager.js # 发令管理
│   ├── sync.js         # 同步模块
│   ├── sync2.js        # 同步模块 v2
│   ├── api-client.js   # API 客户端
│   ├── admin.js        # 管理后台逻辑
│   └── stats-analyzer.js # 数据分析
│
├── serve.js            # Node.js HTTP 服务器
├── ws-server.js        # WebSocket 服务器
├── db.js               # 数据库模块
├── api.js              # API 路由
├── state-machine.js    # 状态机
│
├── icons/              # 图标资源
│
├── school-timer/        # 学校计时器模块
│
└── docs/               # 文档
```

### 环境变量

创建 `.env` 文件：

```bash
# 服务器配置
PORT=8080
HOST=0.0.0.0

# 数据库
DB_PATH=./data/jingjitimer.db

# 日志
LOG_LEVEL=info
LOG_FILE=./logs/app.log

# 安全
CORS_ORIGIN=*

# WebSocket
WS_PING_INTERVAL=30000
WS_TIMEOUT=60000
```

### 开发命令

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 生产模式
npm start

# 代码检查
npm run lint

# 格式化代码
npm run format

# 运行测试
npm test
```

### API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/rooms` | 获取所有房间 |
| GET | `/api/rooms/:id` | 获取房间详情 |
| POST | `/api/rooms` | 创建房间 |
| DELETE | `/api/rooms/:id` | 删除房间 |
| GET | `/api/results` | 获取成绩列表 |
| GET | `/api/results/:id` | 获取成绩详情 |
| POST | `/api/results` | 提交成绩 |
| DELETE | `/api/results/:id` | 删除成绩 |
| GET | `/api/stats` | 获取统计数据 |

### WebSocket 消息

```javascript
// 连接
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  switch (msg.type) {
    case 'timer:start':
      // 开始计时
      break;
    case 'timer:stop':
      // 停止计时
      break;
    case 'result:update':
      // 成绩更新
      break;
    // ...
  }
});
```

---

## 📊 API 文档

### REST API

#### 健康检查

```http
GET /api/health
```

响应：
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": 1234567890
}
```

#### 获取房间列表

```http
GET /api/rooms
```

响应：
```json
{
  "rooms": [
    {
      "id": "1234",
      "name": "比赛A",
      "status": "active",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### 创建房间

```http
POST /api/rooms
Content-Type: application/json

{
  "name": "比赛A",
  "lanes": 8,
  "distance": "100m"
}
```

#### 提交成绩

```http
POST /api/results
Content-Type: application/json

{
  "roomId": "1234",
  "lane": 1,
  "time": 12.345,
  "athlete": "张三",
  "distance": "100m"
}
```

#### 导出成绩

```http
GET /api/results/export?roomId=1234&format=csv
```

### WebSocket API

#### 连接

```javascript
const ws = new WebSocket('wss://your-server.com/ws');
```

#### 发送消息

```javascript
// 发送计时开始
ws.send(JSON.stringify({
  type: 'timer:start',
  roomId: '1234',
  timestamp: Date.now()
}));

// 发送成绩
ws.send(JSON.stringify({
  type: 'result:add',
  roomId: '1234',
  lane: 1,
  time: 12.345
}));
```

#### 接收消息

```javascript
ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  switch (data.type) {
    case 'timer:state':
      updateTimerUI(data.state);
      break;
    case 'result:new':
      addResultRow(data.result);
      break;
    case 'sync:request':
      handleSyncRequest();
      break;
  }
});
```

---

## 📝 更新日志

### [1.0.0] - 2024-XX-XX

#### 新增
- 四大角色模式支持
- AI 发令检测功能
- 终点自动识别
- 慢动作回放
- PWA 离线支持
- 多设备 WebSocket 同步
- 成绩导出功能

#### 改进
- UI 界面优化
- 性能提升
- 稳定性增强

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

### 开发流程

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### 代码规范

- 使用 ESLint 进行代码检查
- 使用 Prettier 格式化代码
- 提交信息遵循 Conventional Commits 规范

---

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

---

## 🙏 致谢

- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - 轻量级 SQLite 数据库
- [ws](https://github.com/websockets/ws) - WebSocket 实现
- 所有贡献者的辛勤付出

---

<div align="center">

**Made with ❤️ for athletics timing**

**竞迹，让计时更精准**

</div>
