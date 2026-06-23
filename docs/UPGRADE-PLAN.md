# 竞迹 AI 计时系统 - 云端部署方案

## 架构升级：局域网 → 云端中转

### 方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **局域网 WebSocket** | 延迟低(5-20ms) | 需同一WiFi | 学校内部，设备少 |
| **云端中转** | 任何网络可用 | 延迟稍高(50-200ms) | 校运会，多场地 |
| **混合模式** | 自动选择最优 | 实现复杂 | 通用方案 |

### 推荐：云端中转 + 时间预约

#### 原理
```
发令端 (移动网络/WiFi A)
    ↓
    WebSocket → 云端服务器 (Railway/Render/阿里云)
    ↓
终点端 (移动网络/WiFi B)
```

#### 关键：预约时间机制（已实现）
```javascript
// 发令端：预约 2 秒后的精确时间戳
const startAt = serverTime + 2000; // 使用服务器时间

// 云端转发给所有设备
broadcast({ type: 'START_SCHEDULED', startAt });

// 终点端：本地倒计时到精确时刻
setTimeout(() => {
  startTimer(startAt);
}, startAt - Date.now());
```

**精度分析：**
- ❌ 不用预约时间：延迟 50-200ms（网络抖动）
- ✅ 使用预约时间：误差 < 5ms（本地时钟精度）

---

## 🎥 问题 2：AI 视频识别（国际田联标准）

### 国际田联计时系统技术

#### 官方标准（Omega/SEIKO）
1. **帧率**：1000 fps（每秒1000帧）专业高速相机
2. **触线识别**：激光光幕 + 压力传感器
3. **精度**：0.001秒（毫秒级）
4. **终点相机**：正对终点线，俯视角

#### 我们的实现方案（分阶段）

### 阶段 1：手动模式（当前）✅
- 人工点击道次按钮
- 精度：人类反应时间 ~200ms
- 成本：0元
- 适用：课堂测试

### 阶段 2：视频分析模式（可实现）🔧
```javascript
// 使用 Web API + Canvas 逐帧分析
navigator.mediaDevices.getUserMedia({
  video: {
    facingMode: 'environment',
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 60 } // 手机最高支持 60fps
  }
});

// 逐帧检测
function detectCrossing() {
  ctx.drawImage(video, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  
  // 终点线像素监测
  for (let lane = 0; lane < 8; lane++) {
    const roi = getROI(lane); // 每条道的终点线区域
    if (detectMotion(roi, previousFrame)) {
      recordFinish(lane, Date.now() - startTime);
    }
  }
  
  requestAnimationFrame(detectCrossing);
}
```

**精度：**
- 60fps = 每帧 16.67ms
- 理论精度：~17ms（比人工反应快 10 倍）

### 阶段 3：AI 模型识别（终极方案）🚀

#### 方案 A：TensorFlow.js（本地，免费）
```javascript
import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';

// 加载姿态检测模型
const detector = await poseDetection.createDetector(
  poseDetection.SupportedModels.MoveNet
);

// 实时检测
async function detectAthletes() {
  const poses = await detector.estimatePoses(videoElement);
  
  poses.forEach(pose => {
    const torso = pose.keypoints.find(k => k.name === 'torso');
    if (torso.x > FINISH_LINE_X && !recorded[pose.id]) {
      recordFinish(getLane(torso.y), timestamp);
    }
  });
}
```

**特点：**
- ✅ 完全免费
- ✅ 本地运行，无需网络
- ❌ 精度中等（~50ms误差）
- ❌ 手机性能要求高

#### 方案 B：百度 AI / 阿里云视觉 API（云端，付费）
```javascript
// 上传关键帧到云端分析
async function analyzeFrame(frameBlob) {
  const result = await fetch('https://aip.baidubce.com/rest/2.0/image-classify/v1/body_attr', {
    method: 'POST',
    body: frameBlob,
  });
  
  // 返回：人体位置、速度、方向
  return result.json();
}
```

**特点：**
- ✅ 精度高（~20ms）
- ✅ 手机性能无压力
- ❌ 需要付费
- ❌ 需要网络

#### 方案 C：混合方案（推荐）
```
1. 手动模式：课堂测试，0成本
2. 视频分析：校运会预赛，精度够用
3. AI模型：校运会决赛，精度最高
```

---

## 🎬 视频识别核心代码（我现在开始实现）

### 升级 ai-detector.js
