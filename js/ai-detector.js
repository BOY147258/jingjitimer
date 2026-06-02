// 竞迹 AI 计时系统 — AI 视频触线识别
// 终点端使用摄像头识别运动员冲线时刻

/**
 * AI 识别器（当前版本：模拟 + 预留真实 AI 接口）
 *
 * 阶段 1（当前）：手动点击 + 模拟 AI 置信度
 * 阶段 2（未来）：接入真实 AI 模型（TensorFlow.js / ONNX / Cloud API）
 */
export class AIFinishLineDetector {
  constructor(options = {}) {
    this.mode = options.mode || 'manual'; // 'manual' | 'ai' | 'hybrid'
    this.laneCount = options.laneCount || 8;
    this.videoElement = null;
    this.canvasElement = null;
    this.ctx = null;
    this.isRunning = false;
    this.startTime = null;
    this.detections = [];
    this.listeners = [];
  }

  // ── 初始化摄像头 ──────────────────────────────────────────────────────────
  async initCamera(videoElement, canvasElement) {
    this.videoElement = videoElement;
    this.canvasElement = canvasElement;
    this.ctx = canvasElement.getContext('2d');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // 后置摄像头
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      this.videoElement.srcObject = stream;
      await new Promise(resolve => {
        this.videoElement.onloadedmetadata = resolve;
      });
      await this.videoElement.play();

      // 调整 canvas 大小
      this.canvasElement.width = this.videoElement.videoWidth;
      this.canvasElement.height = this.videoElement.videoHeight;

      return { success: true };
    } catch (error) {
      console.error('[AI] Camera init failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ── 开始检测 ──────────────────────────────────────────────────────────────
  start(startTime) {
    this.isRunning = true;
    this.startTime = startTime || Date.now();
    this.detections = [];
    this.emit('started', { startTime: this.startTime });

    if (this.mode === 'ai') {
      this.startAIDetection();
    } else if (this.mode === 'manual') {
      this.startManualDetection();
    }
  }

  // ── 停止检测 ──────────────────────────────────────────────────────────────
  stop() {
    this.isRunning = false;
    this.emit('stopped', { detections: this.detections });
    return this.detections;
  }

  // ── 手动模式：点击识别 ────────────────────────────────────────────────────
  startManualDetection() {
    // 在视频上绘制道次分隔线
    this.drawLaneGuides();

    // 监听点击事件
    this.canvasElement.onclick = (e) => {
      if (!this.isRunning) return;

      const rect = this.canvasElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // 计算点击的道次
      const lane = this.getLaneFromPosition(x, y);
      const finishTime = Date.now() - this.startTime;

      this.recordDetection(lane, finishTime, 1.0, 'manual');
    };
  }

  // ── AI 模式：自动识别（真实视频分析）──────────────────────────────────────
  startAIDetection() {
    let frameCount = 0;
    let previousFrame = null;

    const detectFrame = async () => {
      if (!this.isRunning) return;

      // 绘制当前帧到 canvas
      this.ctx.drawImage(this.videoElement, 0, 0, this.canvasElement.width, this.canvasElement.height);
      const currentFrame = this.ctx.getImageData(0, 0, this.canvasElement.width, this.canvasElement.height);

      // 绘制道次引导线
      if (frameCount % 10 === 0) {
        this.drawLaneGuides();
      }

      // 运动检测（每帧检测）
      if (previousFrame) {
        for (let lane = 0; lane < this.laneCount; lane++) {
          // 检查该道次是否已记录
          if (this.detections.find(d => d.lane === lane)) continue;

          // 检测终点线区域的运动
          const motion = this.detectMotionInLane(lane, currentFrame, previousFrame);

          if (motion.detected && motion.confidence > 0.7) {
            const finishTime = Date.now() - this.startTime;
            this.recordDetection(lane, finishTime, motion.confidence, 'video_motion');
          }
        }
      }

      // 保存当前帧用于下一次对比
      if (frameCount % 2 === 0) { // 每2帧保存一次（降低内存消耗）
        previousFrame = currentFrame;
      }

      frameCount++;
      requestAnimationFrame(detectFrame);
    };

    detectFrame();
  }

  // ── 运动检测：检测特定道次的终点线区域 ──────────────────────────────────────
  detectMotionInLane(lane, currentFrame, previousFrame) {
    const width = this.canvasElement.width;
    const height = this.canvasElement.height;
    const laneWidth = width / this.laneCount;

    // 终点线位置（屏幕中央垂直区域）
    const finishLineX = Math.floor(width * 0.5); // 中线
    const detectionZoneWidth = Math.floor(width * 0.1); // 10% 宽度的检测区

    // 该道次的 Y 坐标范围
    const laneTop = Math.floor(lane * (height / this.laneCount));
    const laneBottom = Math.floor((lane + 1) * (height / this.laneCount));

    let totalDiff = 0;
    let pixelCount = 0;
    let significantMotion = 0;

    // 扫描终点线区域的像素
    for (let y = laneTop; y < laneBottom; y++) {
      for (let x = finishLineX - detectionZoneWidth; x < finishLineX + detectionZoneWidth; x++) {
        if (x < 0 || x >= width || y < 0 || y >= height) continue;

        const idx = (y * width + x) * 4;

        // 计算 RGB 差异
        const rDiff = Math.abs(currentFrame.data[idx] - previousFrame.data[idx]);
        const gDiff = Math.abs(currentFrame.data[idx + 1] - previousFrame.data[idx + 1]);
        const bDiff = Math.abs(currentFrame.data[idx + 2] - previousFrame.data[idx + 2]);

        const diff = (rDiff + gDiff + bDiff) / 3;
        totalDiff += diff;
        pixelCount++;

        // 显著运动阈值（灰度变化 > 30）
        if (diff > 30) {
          significantMotion++;
        }
      }
    }

    const avgDiff = pixelCount > 0 ? totalDiff / pixelCount : 0;
    const motionRatio = pixelCount > 0 ? significantMotion / pixelCount : 0;

    // 检测逻辑：平均变化 > 15 且 显著运动像素 > 20%
    const detected = avgDiff > 15 && motionRatio > 0.2;
    const confidence = Math.min(1.0, (avgDiff / 50) * (motionRatio / 0.3));

    return {
      detected,
      confidence: Math.round(confidence * 100) / 100,
      avgDiff,
      motionRatio,
    };
  }

  // ── 模拟 AI 检测（占位符）────────────────────────────────────────────────
  async mockAIDetection() {
    // 这里应该调用真实的 AI 模型
    // 例如：TensorFlow.js、ONNX Runtime、或云端 API

    // 当前返回 null（不检测）
    return null;
  }

  // ── 记录检测结果 ──────────────────────────────────────────────────────────
  recordDetection(lane, finishTime, confidence, method) {
    // 检查是否已经记录过这个道次
    const existing = this.detections.find(d => d.lane === lane);
    if (existing) {
      console.warn(`[AI] Lane ${lane} already detected at ${existing.finishTime}ms`);
      return;
    }

    const detection = {
      lane,
      finishTime,
      confidence,
      method,
      timestamp: Date.now(),
      needsReview: confidence < 0.85,
    };

    this.detections.push(detection);
    this.emit('detection', detection);

    // 视觉反馈
    this.flashLane(lane);
  }

  // ── 手动修正 ──────────────────────────────────────────────────────────────
  correctDetection(lane, newFinishTime) {
    const detection = this.detections.find(d => d.lane === lane);
    if (detection) {
      detection.finishTime = newFinishTime;
      detection.confidence = 1.0;
      detection.method = 'manual_corrected';
      detection.needsReview = false;
      this.emit('corrected', detection);
    }
  }

  // ── 删除检测 ──────────────────────────────────────────────────────────────
  removeDetection(lane) {
    const idx = this.detections.findIndex(d => d.lane === lane);
    if (idx >= 0) {
      const removed = this.detections.splice(idx, 1)[0];
      this.emit('removed', removed);
    }
  }

  // ── 获取所有检测结果 ──────────────────────────────────────────────────────
  getDetections() {
    return [...this.detections].sort((a, b) => a.finishTime - b.finishTime);
  }

  // ── 绘制道次引导线 ────────────────────────────────────────────────────────
  drawLaneGuides() {
    if (!this.ctx) return;

    const width = this.canvasElement.width;
    const height = this.canvasElement.height;
    const laneWidth = width / this.laneCount;

    this.ctx.strokeStyle = 'rgba(255, 98, 0, 0.5)';
    this.ctx.lineWidth = 2;

    for (let i = 1; i < this.laneCount; i++) {
      const x = i * laneWidth;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
      this.ctx.stroke();
    }

    // 绘制道次标签
    this.ctx.font = 'bold 24px sans-serif';
    this.ctx.fillStyle = 'rgba(255, 98, 0, 0.8)';
    this.ctx.textAlign = 'center';

    for (let i = 0; i < this.laneCount; i++) {
      const x = (i + 0.5) * laneWidth;
      this.ctx.fillText(`${i + 1}`, x, 40);
    }
  }

  // ── 闪烁道次（视觉反馈）──────────────────────────────────────────────────
  flashLane(lane) {
    if (!this.ctx) return;

    const width = this.canvasElement.width;
    const height = this.canvasElement.height;
    const laneWidth = width / this.laneCount;
    const x = lane * laneWidth;

    this.ctx.fillStyle = 'rgba(46, 204, 113, 0.5)';
    this.ctx.fillRect(x, 0, laneWidth, height);

    setTimeout(() => this.drawLaneGuides(), 200);
  }

  // ── 根据位置计算道次 ──────────────────────────────────────────────────────
  getLaneFromPosition(x, y) {
    const laneWidth = this.canvasElement.width / this.laneCount;
    return Math.floor(x / laneWidth);
  }

  // ── 事件监听 ──────────────────────────────────────────────────────────────
  on(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  emit(event, data) {
    this.listeners.forEach(cb => {
      try {
        cb(event, data);
      } catch (e) {
        console.error('[AI] Listener error:', e);
      }
    });
  }

  // ── 清理资源 ──────────────────────────────────────────────────────────────
  destroy() {
    this.stop();
    if (this.videoElement?.srcObject) {
      this.videoElement.srcObject.getTracks().forEach(track => track.stop());
    }
  }
}

// ── 导出工具函数 ────────────────────────────────────────────────────────────
export function formatConfidence(confidence) {
  return `${Math.round(confidence * 100)}%`;
}

export function getConfidenceColor(confidence) {
  if (confidence >= 0.9) return '#2ecc71'; // 绿色
  if (confidence >= 0.8) return '#f39c12'; // 橙色
  return '#e74c3c'; // 红色
}
