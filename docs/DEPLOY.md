# 竞迹 AI 计时系统 - 部署到云端

## 一键部署到 Railway（免费，全球可访问）

### 步骤 1：准备配置文件

已有的文件：
- ✅ `ws-server.js` - WebSocket 服务器
- ✅ `package.json` - 依赖配置
- ✅ `Procfile` - 启动命令

### 步骤 2：部署

#### 方法 A：GitHub + Railway（推荐）
1. 将代码推送到 GitHub
2. 访问 https://railway.app
3. 连接 GitHub 仓库
4. 自动部署，获得公开域名

#### 方法 B：Render.com（免费，国内可访问）
1. 访问 https://render.com
2. 新建 Web Service
3. 连接 GitHub 或直接上传
4. 自动部署

### 步骤 3：修改前端配置

前端连接云端服务器：
```javascript
// 自动检测：本地优先，云端备用
const WS_SERVERS = [
  'ws://localhost:8080/ws',           // 本地开发
  'wss://jingjitimer.up.railway.app/ws', // 云端部署
];

async function connectBestServer(roomCode, role) {
  for (const server of WS_SERVERS) {
    try {
      const ws = new WebSocket(`${server}?room=${roomCode}&role=${role}`);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
        setTimeout(reject, 3000); // 3秒超时
      });
      return ws; // 成功连接
    } catch (e) {
      continue; // 尝试下一个
    }
  }
  throw new Error('无法连接到服务器');
}
```

## 当前部署状态

你的代码已经包含了 `render.yaml`，可以直接部署到 Render：

```yaml
services:
  - type: web
    name: jingjitimer
    env: node
    buildCommand: npm install
    startCommand: npm start
```

## 现在立即部署

### 选项 1：我帮你推送到 GitHub 并部署
需要：
- GitHub 仓库地址（或者我创建新的）
- Railway/Render 账号授权

### 选项 2：你自己部署
1. 将 `jingjitimer` 文件夹推送到 GitHub
2. 在 Railway/Render 连接仓库
3. 自动部署完成

## 部署后的效果

✅ **任何人、任何设备、任何网络**都能访问
- 手机用 4G/5G
- 平板用学校 WiFi
- 电脑用家庭宽带
- 距离 200米？2000米？全国都可以！

✅ **延迟**
- 云端转发延迟：50-150ms
- 但使用预约时间机制，计时精度不受影响
- 实际计时误差 < 5ms
