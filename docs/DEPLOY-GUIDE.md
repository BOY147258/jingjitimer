# 竞迹计时系统 - 一键部署指南

## Railway 部署（推荐）

### 方法 1：通过 Railway CLI（最快）

```bash
# 1. 安装 Railway CLI
npm install -g @railway/cli

# 2. 登录
railway login

# 3. 部署
railway up

# 4. 添加域名
railway domain
```

### 方法 2：通过网页（最简单）

1. 访问：https://railway.app
2. 点击 "New Project"
3. 选择 "Deploy from GitHub repo"
4. 选择 `BOY147258/jingjitimer`
5. Railway 会自动检测 Node.js 项目
6. 等待 3-5 分钟部署完成
7. 点击 "Settings" → "Networking" → "Generate Domain"

### 配置说明

Railway 会自动识别以下文件：
- ✅ `package.json` - 依赖和启动命令
- ✅ `Procfile` - 进程配置（可选）
- ✅ `render.yaml` - Render 配置（可选）

### 环境变量
Railway 会自动设置：
- `PORT` - 端口号（自动分配）
- `NODE_ENV=production`

无需手动配置！

---

## Render 部署（备选）

1. 访问：https://render.com
2. 点击 "New +" → "Web Service"
3. 连接 GitHub：`BOY147258/jingjitimer`
4. 配置：
   - Name: `jingjitimer`
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
5. 点击 "Create Web Service"
6. 等待部署完成

---

## Vercel 部署（静态前端 + Serverless）

```bash
# 1. 安装 Vercel CLI
npm i -g vercel

# 2. 部署
vercel
```

---

## 部署后测试

获得域名后（例如：`https://jingjitimer.up.railway.app`）：

### 测试 1：访问主页
```
https://你的域名/simple.html
```

### 测试 2：WebSocket 连接
浏览器控制台执行：
```javascript
const ws = new WebSocket('wss://你的域名/ws?room=1234&role=test');
ws.onopen = () => console.log('✅ WebSocket 连接成功');
ws.onerror = (e) => console.error('❌ WebSocket 连接失败', e);
```

### 测试 3：API 接口
```bash
curl https://你的域名/ping
# 应返回：{"serverTime": 1234567890, "ok": true}
```

---

## 故障排查

### 问题 1：404 Not Found
**原因：** 服务器未启动或路由错误
**解决：** 检查 `serve.js` 是否正确处理静态文件

### 问题 2：WebSocket 连接失败
**原因：** HTTPS/WSS 协议不匹配
**解决：** 确保使用 `wss://`（不是 `ws://`）

### 问题 3：服务器崩溃
**原因：** 内存不足或未捕获的异常
**解决：** 查看日志，修复错误

---

## 成本说明

### Railway
- 免费额度：500 小时/月
- 超出后：$0.000463/分钟（约 $20/月）
- 适合：长期运行

### Render
- 免费套餐：自动休眠（15分钟无访问）
- 付费套餐：$7/月
- 适合：间歇使用

### Vercel
- 免费额度：100GB 流量/月
- Serverless 函数：100万次/月
- 适合：低频使用
