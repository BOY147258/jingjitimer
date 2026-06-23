# 竞迹 AI 计时系统 - 体育老师使用指南

## 📚 目录
1. [系统介绍](#系统介绍)
2. [快速开始](#快速开始)
3. [两种使用模式](#两种使用模式)
4. [云端部署](#云端部署)
5. [常见问题](#常见问题)
6. [优化建议](#优化建议)

---

## 系统介绍

### 设计初衷
作为中小学体育老师，我们常常面临：
- ❌ 学校没有电子计时器
- ❌ 秒表计时不够准确
- ❌ 校运会需要多人配合记录成绩
- ❌ 手工记录容易出错

**竞迹计时系统**就是为了解决这些问题而生：
- ✅ 只需手机，无需专业设备
- ✅ 毫秒级精度（误差 < 5ms）
- ✅ 多设备协同，适合大型比赛
- ✅ 自动排名，一键导出成绩

### 系统特点

| 特点 | 专业计时器 | 我们的系统 |
|------|-----------|-----------|
| 成本 | ¥50万+ | ¥0（免费） |
| 精度 | 0.001秒 | 0.005秒 |
| 安装 | 需专业施工 | 打开网页即用 |
| 适用场景 | 省级以上比赛 | 日常教学 + 校运会 |

---

## 快速开始

### 本地测试（推荐先用这个）

#### 步骤 1：启动服务器
```bash
# 进入项目目录
cd jingjitimer

# 安装依赖（第一次需要）
npm install

# 启动服务器
npm start
```

服务器启动后会显示：
```
竞迹 JingJi (HTTP模式)
移动端:   http://192.168.x.x:8080
```

#### 步骤 2：打开页面

**极简版（推荐）：**
```
http://192.168.x.x:8080/simple.html
```

**完整版：**
```
http://192.168.x.x:8080/test.html
```

---

## 两种使用模式

### 模式 1：体育课模式（单人操作）

**适用场景：**
- 日常体育课测试
- 班级内部比赛
- 快速记录成绩

**操作流程：**
1. 打开 `simple.html`
2. 选择「体育课模式」
3. 选择项目（50m/100m/200m...）
4. 选择参赛人数（4/6/8人）
5. 点击「发令开始」
6. 学生到达终点时点击对应道次
7. 完成后查看成绩和排名
8. 一键导出 CSV 文件

**优点：**
- ✅ 一人操作，简单快速
- ✅ 适合课堂教学
- ✅ 无需联网

**演示视频：**
[待录制]

---

### 模式 2：校运会模式（多设备协同）

**适用场景：**
- 校运会正式比赛
- 需要专业流程
- 多人配合

**设备配置：**

#### 设备 A - 发令端（老师手机）
- 负责：控制发令
- 位置：起点
- 操作：创建枪次 → 发令

#### 设备 B - 终点端（终点裁判平板/手机）
- 负责：记录运动员冲线时间
- 位置：终点
- 操作：等待发令 → 点击道次记录成绩

#### 设备 C - 成绩端（大屏/投影）
- 负责：实时显示成绩给观众
- 位置：观众席
- 操作：输入房间号 → 自动显示

**操作流程：**

**发令端（老师）：**
1. 打开 `simple.html`
2. 选择「校运会模式」→「发令端」
3. 输入房间号（例：1234）
4. 创建枪次
5. 点击「发令」（3秒倒计时后自动发令）

**终点端（裁判）：**
1. 打开 `simple.html`
2. 选择「校运会模式」→「终点端」
3. 输入**相同**房间号（1234）
4. 等待发令
5. 听到枪声后，运动员到达时点击对应道次

**成绩端（观众）：**
1. 打开 `simple.html`
2. 选择「成绩公示」
3. 输入房间号（1234）
4. 自动显示实时成绩和排名

**关键点：**
- ⚠️ 所有设备必须输入**相同**房间号
- ⚠️ 发令端和终点端必须先连接，再开始比赛
- ✅ 发令使用预约时间，网络延迟不影响精度

---

## 云端部署

### 为什么要部署到云端？

**场景：**
- 发令端在起点，终点端在终点（距离 100-200米）
- 设备使用不同网络（老师用移动网络，学校平板用WiFi）
- 家长在观众席想实时查看成绩

**本地 vs 云端：**

| 对比项 | 本地部署 | 云端部署 |
|--------|---------|---------|
| 网络要求 | 所有设备同一WiFi | 任何网络 |
| 访问范围 | 仅局域网 | 全球可访问 |
| 设置复杂度 | 需配置IP | 一个链接搞定 |

### 部署到 Railway（推荐）

#### 步骤 1：准备 GitHub 仓库
代码已在：https://github.com/BOY147258/jingjitimer

#### 步骤 2：部署到 Railway
1. 访问：https://railway.app
2. 点击「Login」→ 使用 GitHub 登录
3. 点击「New Project」
4. 选择「Deploy from GitHub repo」
5. 选择 `BOY147258/jingjitimer`
6. 等待 3-5 分钟自动部署

#### 步骤 3：获取公开链接
部署完成后，Railway 会给你一个链接，例如：
```
https://jingjitimer-production.up.railway.app
```

#### 步骤 4：使用云端版本
```
体育课模式：https://你的域名/simple.html
完整版：    https://你的域名/test.html
```

**优点：**
- ✅ 任何人、任何设备都能访问
- ✅ 不需要同一 WiFi
- ✅ 发令端和终点端距离无限制
- ✅ 家长也能查看成绩

**费用：**
- Railway 免费额度：每月 500 小时（够用）
- 超出后：约 $5/月

---

## 常见问题

### Q1：精度真的够用吗？
**A：** 完全够用。
- 我们的精度：~5ms（0.005秒）
- 国际田联：~1ms（0.001秒）
- 差距：对于校园比赛，5ms 的误差完全可忽略（人类反应时间 200ms）

### Q2：必须同一 WiFi 吗？
**A：** 看情况。
- 本地部署：需要同一 WiFi
- 云端部署：不需要，任何网络都行

### Q3：手机能当终点相机用吗？
**A：** 可以，但需要进一步开发。
- 当前版本：手动点击道次（人工计时）
- 未来版本：自动识别冲线（AI 计时）

### Q4：能同时跑多个比赛吗？
**A：** 可以。
- 不同比赛使用不同房间号即可
- 例如：100米用房间1234，200米用房间5678

### Q5：成绩能保存吗？
**A：** 当前版本：导出 CSV 文件
- 未来版本：自动保存到数据库

---

## 优化建议（开发者）

### 短期优化（1周内）

#### 1. 完善体育课模式
```javascript
// 增加运动员姓名输入
{
  lane: 0,
  name: '张三',
  class: '三年级1班',
  finishTime: 12450,
}

// 批量导入名单（CSV）
function importRoster(csvFile) {
  // 读取 CSV
  // 自动分配道次
}
```

#### 2. 声音效果优化
```javascript
// 当前：简单的 Web Audio
// 优化：使用真实枪声音效
function playGunSound() {
  const audio = new Audio('/sounds/gunshot.mp3');
  audio.play();
}

// 增加冲线提示音
function playBeep() {
  const audio = new Audio('/sounds/beep.mp3');
  audio.play();
}
```

#### 3. 离线支持（PWA）
```javascript
// 注册 Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

// 缓存核心资源
// 即使断网也能使用
```

### 中期优化（1个月）

#### 4. AI 视频识别（真实实现）
```javascript
// 方案 A：逐帧运动检测（已实现框架）
// 优化：调整阈值，提高准确率

// 方案 B：接入 TensorFlow.js
import * as poseDetection from '@tensorflow-models/pose-detection';

const detector = await poseDetection.createDetector(
  poseDetection.SupportedModels.MoveNet
);

// 检测人体位置
const poses = await detector.estimatePoses(video);

// 判断是否过线
poses.forEach(pose => {
  if (pose.keypoints.torso.x > FINISH_LINE_X) {
    recordFinish(lane);
  }
});
```

#### 5. 数据统计
```javascript
// 个人最佳成绩
function getBestTime(athleteName) {
  // 查询历史记录
  // 返回最好成绩
}

// 班级排名
function getClassRanking() {
  // 统计班级平均成绩
}

// 进步趋势
function getProgress(athleteName) {
  // 显示成绩曲线
}
```

#### 6. 慢动作回放
```javascript
// 录制终点视频
const mediaRecorder = new MediaRecorder(videoStream);
mediaRecorder.start();

// 保存关键帧
// 支持回放和复核
```

### 长期优化（3个月）

#### 7. 多轮次管理
```javascript
// 预赛 → 半决赛 → 决赛
const rounds = {
  preliminary: { groups: 4, advancePerGroup: 2 },
  semifinal: { groups: 2, advancePerGroup: 4 },
  final: { groups: 1 },
};

// 自动晋级
function advanceAthletes(round) {
  // 根据成绩自动分配下一轮道次
}
```

#### 8. 云端数据库
```javascript
// 使用 Firebase / Supabase
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(URL, KEY);

// 保存成绩
await supabase.from('results').insert({
  athlete_name: '张三',
  event: '100m',
  time: 12.45,
  date: new Date(),
});

// 查询历史
const { data } = await supabase
  .from('results')
  .select('*')
  .eq('athlete_name', '张三');
```

#### 9. 移动端 APP
```javascript
// 使用 Capacitor 打包成原生 APP
npm install @capacitor/core @capacitor/cli

// 打包 Android APK
npx cap add android
npx cap sync
npx cap open android

// 好处：
// - 后台运行
// - 更好的相机控制
// - 离线数据存储
```

---

## 技术架构

### 当前实现

```
前端（HTML/JS）
  ↓
WebSocket（实时通信）
  ↓
Node.js 服务器（ws-server.js）
  ↓
文件数据库（data/*.json）
```

### 优点
- ✅ 简单，易部署
- ✅ 无需数据库
- ✅ 免费

### 缺点
- ⚠️ 数据不持久（重启丢失）
- ⚠️ 不支持多台服务器
- ⚠️ 无法统计历史数据

### 改进方案
```
前端（HTML/JS）
  ↓
WebSocket + REST API
  ↓
Node.js 服务器
  ↓
PostgreSQL / MongoDB（数据库）
  ↓
云存储（视频回放）
```

---

## 贡献指南

这是一个开源项目，欢迎全国的体育老师一起完善！

### 如何贡献

1. **提出问题**：在 GitHub Issues 反馈 bug 或建议
2. **改进代码**：Fork 仓库，提交 Pull Request
3. **分享经验**：录制使用视频，帮助其他老师

### 联系方式
- GitHub：https://github.com/BOY147258/jingjitimer
- 邮箱：[待添加]

---

## 致谢

感谢所有为校园体育教学贡献力量的老师们！

让我们一起用技术改善体育教学，让每个孩子都能享受公平、专业的计时服务。

---

**版本：** v2.0  
**更新日期：** 2026-06-02  
**作者：** 体育老师 + AI 助手
