# 🌐 云端部署指南 - 异地访问（不需要局域网）

## 为什么要部署到云端？

### 当前问题（局域网）
- ❌ 手机和电脑必须同一 WiFi
- ❌ IP 地址可能变化
- ❌ 防火墙可能阻止连接
- ❌ 无法异地访问

### 云端部署优势
- ✅ 任何网络都能访问（4G/5G/WiFi/家庭宽带）
- ✅ 全球任何地方都能用
- ✅ 永久固定域名
- ✅ 无需配置防火墙

---

## 🚀 立即部署（3种方式）

## 方式 1：Render.com（推荐，最稳定）

### 优点
- ✅ 完全免费
- ✅ 国内访问稳定
- ✅ 自动 HTTPS
- ✅ 支持 WebSocket

### 部署步骤

#### 步骤 1：访问 Render
```
https://render.com
```

#### 步骤 2：注册/登录
- 点击右上角「Sign Up」（注册）
- 选择「Sign up with GitHub」（用 GitHub 登录）
- 授权 Render 访问你的 GitHub

#### 步骤 3：创建 Web Service
1. 登录后，点击「New +」
2. 选择「Web Service」
3. 点击「Connect a repository」

#### 步骤 4：连接 GitHub 仓库
1. 在列表中找到：`BOY147258/jingjitimer`
2. 点击「Connect」

#### 步骤 5：配置服务（自动填充）
**Name（服务名称）：**
```
jingjitimer
```

**Environment（环境）：**
```
Node
```

**Build Command（构建命令）：**
```
npm install
```

**Start Command（启动命令）：**
```
npm start
```

**Plan（套餐）：**
- 选择「Free」（免费）

#### 步骤 6：创建服务
- 点击页面底部「Create Web Service」
- 等待 5-10 分钟（首次部署较慢）

#### 步骤 7：获取访问链接
部署成功后，Render 会给你一个域名：
```
https://jingjitimer.onrender.com
```

#### 步骤 8：测试访问
```
https://jingjitimer.onrender.com/simple.html
```

**手机、电脑、任何设备都可以直接访问！**

---

## 方式 2：Railway.app（最快）

### 优点
- ✅ 部署最快（3分钟）
- ✅ 界面简洁
- ✅ 支持 WebSocket

### 部署步骤

#### 步骤 1：访问 Railway
```
https://railway.app
```

#### 步骤 2：登录
- 点击「Login」
- 选择「Login with GitHub」

#### 步骤 3：创建项目
1. 点击「New Project」
2. 选择「Deploy from GitHub repo」
3. 搜索或选择：`BOY147258/jingjitimer`
4. 点击仓库名称

#### 步骤 4：等待自动部署
- Railway 会自动检测 Node.js 项目
- 自动运行 `npm install` 和 `npm start`
- 等待 3-5 分钟

#### 步骤 5：生成域名
1. 部署成功后，点击项目卡片
2. 点击「Settings」（设置）
3. 点击「Networking」（网络）
4. 点击「Generate Domain」（生成域名）
5. 获得类似：`jingjitimer-production.up.railway.app`

#### 步骤 6：访问
```
https://你的域名/simple.html
```

---

## 方式 3：Vercel（最适合静态页面）

### 优点
- ✅ 部署超快（1分钟）
- ✅ 全球 CDN
- ✅ 免费额度大

### 注意
- ⚠️ Vercel 对 WebSocket 支持有限
- 建议用 Render 或 Railway

### 部署步骤

#### 步骤 1：访问 Vercel
```
https://vercel.com
```

#### 步骤 2：导入项目
1. 点击「Add New」→「Project」
2. 导入 GitHub 仓库：`BOY147258/jingjitimer`
3. 点击「Deploy」

#### 步骤 3：获取域名
```
https://jingjitimer.vercel.app
```

---

## 🎯 推荐方案总结

| 平台 | 推荐度 | 优点 | 缺点 |
|------|--------|------|------|
| **Render** | ⭐⭐⭐⭐⭐ | 免费、稳定、国内访问好 | 首次部署慢 |
| **Railway** | ⭐⭐⭐⭐ | 快速、简洁 | 免费额度有限 |
| Vercel | ⭐⭐⭐ | 超快、CDN | WebSocket 支持差 |

### 最终建议：使用 Render

---

## 📱 部署后的使用方式

### 获得域名后（例如：jingjitimer.onrender.com）

#### 手机访问（任何网络）
```
https://jingjitimer.onrender.com/simple.html
```

#### 电脑访问
```
https://jingjitimer.onrender.com/simple.html
```

#### 多设备协同
**发令端（老师手机 4G）：**
- 打开链接
- 选择「校运会模式」→「发令端」
- 房间号：1234

**终点端（学生手机 WiFi）：**
- 打开链接
- 选择「校运会模式」→「终点端」
- 房间号：1234（相同）

**成绩端（电脑/投影）：**
- 打开链接
- 选择「成绩公示」
- 房间号：1234

**所有设备实时同步，距离无限制！**

---

## ⚠️ Render 首次访问可能较慢

### 原因
Render 免费套餐会在 15 分钟无访问后休眠服务器

### 现象
第一次访问需要等待 30-60 秒唤醒服务器

### 解决方案

#### 方案 1：使用前提前访问
比赛前 5 分钟先打开网页，让服务器保持活跃

#### 方案 2：使用 Uptime Robot 监控（免费）
1. 访问：https://uptimerobot.com
2. 注册账号
3. 添加监控：每 5 分钟访问一次你的网站
4. 服务器永不休眠

#### 方案 3：升级到付费套餐（$7/月）
- 服务器永不休眠
- 更快的性能

---

## 🔍 部署后测试

### 测试 1：基本访问
```
https://你的域名/simple.html
```
- [ ] 能打开页面
- [ ] 能看到「竞迹 · 校园计时器」

### 测试 2：体育课模式
- [ ] 选择「体育课模式」
- [ ] 选择「100米跑」
- [ ] 点击「开始测试」→「发令开始」
- [ ] 点击道次按钮
- [ ] 查看成绩排名

### 测试 3：多设备协同
- [ ] 2 台设备同时访问
- [ ] 输入相同房间号
- [ ] 发令端发令
- [ ] 终点端同步计时

### 测试 4：4G 网络访问
- [ ] 手机关闭 WiFi
- [ ] 使用 4G/5G 访问
- [ ] 功能正常

---

## 🎉 部署成功后的优势

### 使用场景扩展

#### 场景 1：日常体育课
- 老师手机打开网页
- 学生跑步，老师点击计时
- 成绩即时显示

#### 场景 2：校运会
- 发令端：起点老师手机（4G）
- 终点端：终点裁判平板（WiFi）
- 成绩端：主席台投影（有线网络）
- 家长端：观众席家长手机（任何网络）

#### 场景 3：异地比赛
- A 学校操场
- B 学校操场
- 同时进行，实时对比成绩

#### 场景 4：居家训练
- 学生在家训练
- 老师远程监督
- 实时查看成绩

---

## 💰 费用说明

### Render 免费套餐
- ✅ 完全免费
- ✅ 每月 750 小时（够用）
- ✅ 无限流量
- ⚠️ 15 分钟无访问后休眠

### Railway 免费套餐
- ✅ 每月 500 小时免费
- ✅ 超出后 ~$5/月
- ✅ 不会休眠

### Vercel 免费套餐
- ✅ 100GB 流量/月
- ✅ 无限请求
- ✅ 永不休眠

**对于学校使用，完全免费够用！**

---

## 📞 需要帮助

### 如果部署遇到问题

1. **检查 GitHub 仓库**
   ```
   https://github.com/BOY147258/jingjitimer
   ```
   确认代码已推送

2. **查看部署日志**
   - Render：点击「Logs」查看错误
   - Railway：点击「Deployments」查看状态

3. **常见错误**
   - `Build failed`：等待几分钟重试
   - `Port already in use`：Render 会自动分配端口
   - `Module not found`：确认 package.json 正确

---

## 🎯 立即行动

### 现在就部署（5 分钟）

1. **访问 Render：** https://render.com
2. **登录 GitHub**
3. **连接仓库：** BOY147258/jingjitimer
4. **等待部署**
5. **获取链接**
6. **分享给所有人**

### 部署成功后告诉我：
- ✅ 你的域名是什么
- ✅ 手机能否访问
- ✅ 多设备协同是否正常

---

**准备好了吗？现在就去 Render.com 部署吧！** 🚀
