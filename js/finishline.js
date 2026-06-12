// AI finish line detection via pixel motion analysis v2.0
// 优化：环境自适应阈值 + 多人冲线毫秒级精确排序 + 误触发防护
export class FinishLineDetector {
  constructor() {
    this._video             = null;
    this._canvas            = null;
    this._ctx               = null;
    this._dispCanvas        = null;
    this._dispCtx           = null;
    this._prevSlice         = null;
    this._linePos           = 0.5;
    this._threshold         = 12;   // lower = more sensitive
    this._baseThreshold     = 12;   // 基础阈值（用于自适应调整）
    this._running           = false;
    this._laneCount         = 4;
    this._laneDividers      = [];
    this._cooldowns         = [];
    this._lastMotion        = 0;
    this._lastBlobs         = [];
    this._lastCrossingTs    = -Infinity;
    this._lastCrossingLane  = -1;
    this.onCrossing         = null;  // cb(laneIdx, precisionTimestamp)
    this.onLevel            = null;
    this.onCloseFinish      = null;
    this._W = 48;
    this._H = 120;
    this._laneDone     = new Set();
    this._laneFinishLabel = {};
    this.cooldownMs    = 1200;
    // 性能优化
    this._frameBuffer      = [];
    this._frameBufferSize  = 3;
    this._skipFrames       = 0;
    this._adaptiveSkip     = 1;
    this._lastFrameTime    = 0;
    this._fps              = 0;
    this._performanceMode  = 'balanced';
    // 高级检测算法
    this._motionHistory    = [];
    this._historySize      = 5;
    this._edgeEnhancement  = true;
    // 环境自适应
    this._ambientLight     = 0;     // 当前环境光强度
    this._ambientSamples   = [];    // 环境光样本
    this._maxAmbientSamples = 30;   // 最多保存30个样本
    // 多人冲线优化
    this._crossingQueue    = [];    // 冲线事件队列（用于精确排序）
    this._crossingProcessTimer = null;
    this._minGapBetweenLane = 50;   // 同道次最小间隔（毫秒）
    // 误触发防护
    this._gracePeriod      = 500;   // grace period 毫秒
    this._minMotionPeak    = 8;     // 最小运动峰值（低于此值忽略）
    this._falseTriggerCount = 0;    // 误触发计数
    this._lastFalseTrigger = 0;    // 上次误触发时间
  }

  setLaneDone(laneIdx, label = '✓') {
    this._laneDone.add(laneIdx);
    this._cooldowns[laneIdx] = true;
    this._laneFinishLabel[laneIdx] = label;
  }

  resetLaneDone() {
    this._laneDone.clear();
    this._laneFinishLabel = {};
    this._cooldowns = new Array(this._laneCount).fill(false);
    // 重置冲线队列
    this._crossingQueue = [];
    this._falseTriggerCount = 0;
  }

  get threshold()  { return this._threshold; }
  set threshold(v) { this._threshold = Math.max(5, Math.min(100, v)); this._baseThreshold = v; }

  get linePos()  { return this._linePos; }
  set linePos(v) { this._linePos = Math.max(0.05, Math.min(0.95, v)); }

  // 重置环境光样本
  resetAmbientSamples() {
    this._ambientSamples = [];
  }

  _resetDividers(n) {
    this._laneDividers = [];
    for (let i = 1; i < n; i++) {
      this._laneDividers.push(i / n);
    }
  }

  _laneFromY(centerY) {
    const relY = centerY / this._H;
    for (let i = 0; i < this._laneDividers.length; i++) {
      if (relY < this._laneDividers[i]) return i;
    }
    return this._laneCount - 1;
  }

  init(videoEl, displayCanvas, laneCount = 4) {
    this._video      = videoEl;
    this._dispCanvas = displayCanvas;
    this._dispCtx    = displayCanvas.getContext('2d');
    this._laneCount  = laneCount;
    this._cooldowns  = new Array(laneCount).fill(false);
    this._resetDividers(laneCount);
    this._prevSlice = null;
    this._canvas = document.createElement('canvas');
    this._canvas.width  = this._W;
    this._canvas.height = this._H;
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
  }

  start(onCrossing, onLevel) {
    this.onCrossing = onCrossing;
    this.onLevel    = onLevel;
    this._running   = true;
    this.resetAmbientSamples();
    this._loop();
  }

  stop() { this._running = false; }

  _loop() {
    if (!this._running) return;

    const now = performance.now();
    const delta = now - this._lastFrameTime;
    if (this._lastFrameTime > 0) {
      this._fps = Math.round(1000 / delta);
      if (this._performanceMode === 'high' || this._fps >= 30) {
        this._adaptiveSkip = 1;
      } else if (this._fps >= 20) {
        this._adaptiveSkip = 2;
      } else {
        this._adaptiveSkip = 3;
      }
    }
    this._lastFrameTime = now;

    this._skipFrames++;
    if (this._skipFrames % this._adaptiveSkip === 0) {
      this._analyze();
    }

    this._drawOverlay();
    requestAnimationFrame(() => this._loop());
  }

  setPerformanceMode(mode) {
    this._performanceMode = mode;
    if (mode === 'high') {
      this._W = 48;
      this._frameBufferSize = 5;
    } else if (mode === 'balanced') {
      this._W = 48;
      this._frameBufferSize = 3;
    } else {
      this._W = 24;
      this._frameBufferSize = 2;
    }
    if (this._canvas) {
      this._canvas.width = this._W;
      this._canvas.height = this._H;
    }
  }

  getPerformanceStats() {
    return {
      fps: this._fps,
      skipRate: this._adaptiveSkip,
      mode: this._performanceMode,
      detectionWidth: this._W,
      bufferSize: this._frameBufferSize,
      ambientLight: this._ambientLight,
      falseTriggerCount: this._falseTriggerCount
    };
  }

  // 获取高精度时间戳（毫秒级）
  getHighPrecisionTimestamp() {
    return performance.now();
  }

  _isAxesSwapped() {
    const vw = this._video?.videoWidth  || 0;
    const vh = this._video?.videoHeight || 0;
    const dw = this._dispCanvas?.offsetWidth  || 0;
    const dh = this._dispCanvas?.offsetHeight || 0;
    if (!vw || !vh || !dw || !dh) return false;
    return (vw < vh) !== (dw < dh);
  }

  _analyze() {
    if (!this._video || this._video.readyState < 2) return;
    const W = this._W, H = this._H;

    const vw = this._video.videoWidth  || 640;
    const vh = this._video.videoHeight || 480;

    const swapped = this._isAxesSwapped();

    if (!swapped) {
      const srcX = Math.max(0, Math.round(this._linePos * vw) - W / 2);
      const srcW = Math.min(W, vw - srcX);
      this._ctx.drawImage(this._video, srcX, 0, Math.max(1, srcW), vh, 0, 0, W, H);
    } else {
      const srcY = Math.max(0, Math.round(this._linePos * vh) - W / 2);
      const srcH = Math.min(W, vh - srcY);
      this._ctx.save();
      this._ctx.translate(W, 0);
      this._ctx.rotate(Math.PI / 2);
      this._ctx.drawImage(this._video, 0, srcY, vw, Math.max(1, srcH), 0, 0, H, W);
      this._ctx.restore();
    }

    const slice = this._ctx.getImageData(0, 0, W, H);

    if (!this._prevSlice) {
      this._prevSlice = new Uint8Array(slice.data.length);
      this._prevSlice.set(slice.data);
      return;
    }

    let processedData = slice.data;
    if (this._edgeEnhancement) {
      processedData = this._applyEdgeEnhancement(slice.data, W, H);
    }

    // 计算环境光强度（用于自适应阈值）
    this._updateAmbientLight(slice.data, W, H);

    // 自适应阈值调整
    this._adjustThreshold();

    // Motion per pixel row
    const motionPerRow = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      let rowDiff = 0;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        rowDiff += Math.abs(processedData[i]   - this._prevSlice[i]);
        rowDiff += Math.abs(processedData[i+1] - this._prevSlice[i+1]);
        rowDiff += Math.abs(processedData[i+2] - this._prevSlice[i+2]);
      }
      motionPerRow[y] = rowDiff / (W * 3);
    }

    this._prevSlice.set(slice.data);

    this._frameBuffer.push(motionPerRow);
    if (this._frameBuffer.length > this._frameBufferSize) {
      this._frameBuffer.shift();
    }

    const smoothedMotion = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      let sum = 0;
      for (let frame of this._frameBuffer) {
        sum += frame[y];
      }
      smoothedMotion[y] = sum / this._frameBuffer.length;
    }

    let total = 0;
    for (let i = 0; i < H; i++) total += smoothedMotion[i];
    const level = Math.min(1, total / (H * this._threshold * 2));
    this._lastMotion = level;

    this._motionHistory.push(level);
    if (this._motionHistory.length > this._historySize) {
      this._motionHistory.shift();
    }

    const blobs = this._detectBlobs(smoothedMotion, H);
    this._lastBlobs = blobs;
    this.onLevel?.(level, blobs);

    // 处理每个检测到的blob
    blobs.forEach(blob => {
      const laneIdx = this._laneFromY(blob.center);
      if (this._cooldowns[laneIdx]) return;

      // 误触发防护：检查运动强度
      if (blob.peak < this._minMotionPeak) {
        this._registerFalseTrigger('low_peak');
        return;
      }

      // 趋势验证
      const isTrending = this._isMotionTrending();
      if (!isTrending && blob.peak < this._threshold * 1.2) {
        return;
      }

      // 获取高精度时间戳
      const ts = this.getHighPrecisionTimestamp();

      // Grace period检查（防止开跑瞬间误触发）
      const timeSinceLastFalse = ts - this._lastFalseTrigger;
      if (timeSinceLastFalse < this._gracePeriod) {
        return;
      }

      // 添加到冲线队列（用于精确排序）
      this._addToCrossingQueue(laneIdx, ts, blob.peak);
    });
  }

  // 更新环境光强度
  _updateAmbientLight(data, W, H) {
    let sum = 0;
    const sampleStep = 4; // 每4个像素采样一次
    let count = 0;

    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        const i = (y * W + x) * 4;
        sum += data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
        count++;
      }
    }

    const avgBrightness = sum / count;

    // 添加到样本池
    this._ambientSamples.push(avgBrightness);
    if (this._ambientSamples.length > this._maxAmbientSamples) {
      this._ambientSamples.shift();
    }

    // 计算滑动平均
    this._ambientLight = this._ambientSamples.reduce((a, b) => a + b, 0) / this._ambientSamples.length;
  }

  // 根据环境光自适应调整阈值
  _adjustThreshold() {
    if (this._ambientSamples.length < 10) return;

    const normalizedAmbient = this._ambientLight / 255;

    // 光线越暗，灵敏度越低（阈值越高）
    // 光线越亮，灵敏度越高（阈值越低）
    const adjustmentFactor = 1 + (0.5 - normalizedAmbient) * 0.4;

    // 限制调整范围在0.6-1.4倍
    const factor = Math.max(0.6, Math.min(1.4, adjustmentFactor));
    this._threshold = Math.round(this._baseThreshold * factor);
  }

  // 记录误触发
  _registerFalseTrigger(reason) {
    const now = performance.now();
    // 限制记录频率（同一区域内1秒内只记录一次）
    if (now - this._lastFalseTrigger < 1000) return;

    this._falseTriggerCount++;
    this._lastFalseTrigger = now;
  }

  // 添加到冲线队列
  _addToCrossingQueue(laneIdx, timestamp, peak) {
    this._crossingQueue.push({
      laneIdx,
      timestamp,
      peak,
      addedAt: performance.now()
    });

    // 启动处理定时器（批量处理队列中的事件）
    if (!this._crossingProcessTimer) {
      this._processCrossingQueue();
    }
  }

  // 处理冲线队列（精确排序后触发）
  _processCrossingQueue() {
    if (this._crossingQueue.length === 0) {
      this._crossingProcessTimer = null;
      return;
    }

    // 按时间戳排序
    this._crossingQueue.sort((a, b) => a.timestamp - b.timestamp);

    // 获取当前最早的有效事件
    const now = performance.now();
    const event = this._crossingQueue.shift();

    // 检查是否与上次冲线时间冲突（同道次）
    const sameLaneLastTs = this._lastCrossingTs[laneIdx] || -Infinity;
    if (now - sameLaneLastTs < this._minGapBetweenLane) {
      // 忽略这次冲线（太接近，可能是重复检测）
      this._processCrossingQueue();
      return;
    }

    // 更新最后冲线时间
    this._lastCrossingTs[laneIdx] = event.timestamp;

    const diffMs = event.timestamp - (this._lastCrossingTs['__global'] || event.timestamp);

    // 检测接近冲线（两人差距<300ms）
    if (diffMs < 300 && this._lastCrossingLane >= 0 && this._lastCrossingLane !== event.laneIdx) {
      this.onCloseFinish?.(this._lastCrossingLane, event.laneIdx, Math.round(diffMs));
    }

    this._lastCrossingTs['__global'] = event.timestamp;
    this._lastCrossingLane = event.laneIdx;

    // 设置冷却
    this._cooldowns[event.laneIdx] = true;
    setTimeout(() => {
      if (!this._laneDone.has(event.laneIdx)) this._cooldowns[event.laneIdx] = false;
    }, this.cooldownMs);

    // 触发回调
    this.onCrossing?.(event.laneIdx, event.timestamp);

    // 继续处理队列（每次只处理一个）
    this._crossingProcessTimer = setTimeout(() => this._processCrossingQueue(), 10);
  }

  // 边缘增强算法
  _applyEdgeEnhancement(data, W, H) {
    const enhanced = new Uint8ClampedArray(data.length);
    enhanced.set(data);

    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = (y * W + x) * 4;

        const gx =
          -data[((y-1)*W + (x-1))*4] - 2*data[((y-1)*W + x)*4] - data[((y-1)*W + (x+1))*4] +
           data[((y+1)*W + (x-1))*4] + 2*data[((y+1)*W + x)*4] + data[((y+1)*W + (x+1))*4];

        const magnitude = Math.min(255, Math.abs(gx) * 0.5);

        enhanced[i] = Math.min(255, data[i] + magnitude * 0.3);
        enhanced[i+1] = Math.min(255, data[i+1] + magnitude * 0.3);
        enhanced[i+2] = Math.min(255, data[i+2] + magnitude * 0.3);
      }
    }

    return enhanced;
  }

  _isMotionTrending() {
    if (this._motionHistory.length < 3) return true;

    const recent = this._motionHistory.slice(-3);
    let rising = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i] > recent[i-1]) rising++;
    }

    return rising >= 2;
  }

  _detectBlobs(motionPerRow, H) {
    const THRESH  = this._threshold * 0.7;
    const MIN_PX  = Math.floor(H * 0.08);

    const blobs = [];
    let start = -1;
    let maxM  = 0;

    for (let y = 0; y <= H; y++) {
      const m = y < H ? motionPerRow[y] : 0;
      if (m > THRESH && start < 0) { start = y; maxM = m; }
      else if (m > THRESH)         { if (m > maxM) maxM = m; }
      else if (start >= 0) {
        if (y - start >= MIN_PX) {
          blobs.push({
            top:    start,
            bottom: y,
            center: (start + y) / 2,
            peak:   maxM,
          });
        }
        start = -1; maxM = 0;
      }
    }
    return blobs;
  }

  _drawOverlay() {
    if (!this._dispCanvas) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = this._dispCanvas.offsetWidth;
    const cssH = this._dispCanvas.offsetHeight;
    if (cssW > 0 && cssH > 0) {
      const needW = Math.round(cssW * dpr);
      const needH = Math.round(cssH * dpr);
      if (this._dispCanvas.width !== needW || this._dispCanvas.height !== needH) {
        this._dispCanvas.width  = needW;
        this._dispCanvas.height = needH;
        this._prevSlice = null;
      }
    } else {
      return;
    }

    const dW  = this._dispCanvas.width;
    const dH  = this._dispCanvas.height;
    const ctx = this._dispCtx;

    ctx.clearRect(0, 0, dW, dH);

    this._drawLaneDividers(ctx, dW, dH, dpr);

    const lineX  = Math.floor(this._linePos * dW);
    const motion = this._lastMotion;
    const col    = motion > 0.6 ? '#ff1744' : motion > 0.25 ? '#ffd600' : '#00e676';

    ctx.fillStyle = `${col}22`;
    ctx.fillRect(lineX - 2, 0, 4, dH);

    ctx.shadowColor = col;
    ctx.shadowBlur  = 16 * dpr;
    ctx.strokeStyle = col;
    ctx.lineWidth   = 3 * dpr;
    ctx.setLineDash([12 * dpr, 5 * dpr]);
    ctx.beginPath();
    ctx.moveTo(lineX, 0);
    ctx.lineTo(lineX, dH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    const fontSize = Math.max(11, 13 * dpr);
    ctx.font = `bold ${fontSize}px -apple-system,sans-serif`;
    ctx.textAlign = 'center';
    const labelW = ctx.measureText('终点线').width + 16 * dpr;
    const labelH = fontSize + 10 * dpr;
    const labelX = lineX - labelW / 2;
    const labelY = 6 * dpr;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.roundRect(labelX, labelY, labelW, labelH, 4 * dpr);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.fillText('终点线', lineX, labelY + labelH - 6 * dpr);

    const cy = dH / 2;
    const r  = 18 * dpr;
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur  = 8 * dpr;
    ctx.beginPath();
    ctx.arc(lineX, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.round(14 * dpr)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('↔', lineX, cy);
    ctx.textBaseline = 'alphabetic';

    const barH = Math.floor(motion * dH * 0.8);
    ctx.fillStyle = `rgba(0,230,118,${0.25 + motion * 0.55})`;
    ctx.fillRect(dW - 10 * dpr, dH - barH, 8 * dpr, barH);

    this._lastBlobs.forEach(blob => {
      const bTop = (blob.top    / this._H) * dH;
      const bBot = (blob.bottom / this._H) * dH;
      const lane = this._laneFromY(blob.center) + 1;
      ctx.fillStyle = 'rgba(255,23,68,0.35)';
      ctx.fillRect(lineX - 12 * dpr, bTop, 24 * dpr, bBot - bTop);
      ctx.fillStyle = '#ff1744';
      ctx.font = `bold ${Math.round(12 * dpr)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${lane}`, lineX, (bTop + bBot) / 2);
      ctx.textBaseline = 'alphabetic';
    });
  }

  _drawLaneDividers(ctx, dW, dH, dpr) {
    if (this._laneCount < 2) return;

    ctx.save();
    const handleX = dW * 0.5;
    const handleR = 14 * dpr;

    this._laneDividers.forEach((divY, i) => {
      const y = Math.floor(divY * dH);

      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth   = 1.5 * dpr;
      ctx.setLineDash([8 * dpr, 5 * dpr]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(dW, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle   = 'rgba(255,255,255,0.75)';
      ctx.shadowColor = 'rgba(255,255,255,0.4)';
      ctx.shadowBlur  = 6 * dpr;
      ctx.beginPath();
      ctx.arc(handleX, y, handleR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#000';
      ctx.font = `bold ${Math.round(11 * dpr)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↕', handleX, y);
      ctx.textBaseline = 'alphabetic';
    });

    ctx.font      = `bold ${Math.round(11 * dpr)}px -apple-system,sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let lane = 0; lane < this._laneCount; lane++) {
      const topY    = lane === 0 ? 0 : this._laneDividers[lane - 1] * dH;
      const bottomY = lane === this._laneCount - 1 ? dH : this._laneDividers[lane] * dH;
      const midY    = (topY + bottomY) / 2;
      const done    = this._laneDone.has(lane);

      if (done) {
        ctx.fillStyle = 'rgba(0,230,118,0.08)';
        ctx.fillRect(0, topY, dW, bottomY - topY);
      }

      const laneLabel = `${lane + 1}道`;
      const lw = ctx.measureText(laneLabel).width + 10 * dpr;
      const lh = 16 * dpr;
      ctx.fillStyle = done ? 'rgba(0,180,90,0.75)' : 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.roundRect(4 * dpr, midY - lh / 2, lw, lh, 4 * dpr);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText(laneLabel, 9 * dpr, midY);

      if (done && this._laneFinishLabel[lane]) {
        const timeLabel = this._laneFinishLabel[lane];
        ctx.textAlign = 'right';
        ctx.font = `bold ${Math.round(13 * dpr)}px -apple-system,sans-serif`;
        const tw = ctx.measureText(timeLabel).width + 14 * dpr;
        const th = 20 * dpr;
        ctx.fillStyle = 'rgba(0,140,70,0.8)';
        ctx.beginPath();
        ctx.roundRect(dW - tw - 6 * dpr, midY - th / 2, tw, th, 5 * dpr);
        ctx.fill();
        ctx.fillStyle = '#00ff88';
        ctx.fillText(timeLabel, dW - 13 * dpr, midY);
        ctx.textAlign = 'left';
        ctx.font = `bold ${Math.round(11 * dpr)}px -apple-system,sans-serif`;
      }
    }

    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  captureFrame(width = 640, height = 360, label = null) {
    if (!this._video || this._video.readyState < 2) return null;
    try {
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      const ctx = c.getContext('2d');
      ctx.drawImage(this._video, 0, 0, width, height);

      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([6, 4]);
      for (const d of this._laneDividers) {
        const y = Math.round(d * height);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
      ctx.setLineDash([]);

      const lx = Math.round(this._linePos * width);
      ctx.strokeStyle = 'rgba(255,23,68,0.95)';
      ctx.lineWidth   = 2.5;
      ctx.setLineDash([10, 5]);
      ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, height); ctx.stroke();
      ctx.setLineDash([]);

      if (label) {
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.fillRect(0, height - 36, width, 36);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 17px -apple-system, "PingFang SC", sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, 10, height - 8);
        ctx.textBaseline = 'alphabetic';
      }

      return c.toDataURL('image/jpeg', 0.85);
    } catch { return null; }
  }

  autoDetectLanes(maxLanes = 8) {
    if (!this._video || this._video.readyState < 2) return null;

    const AW = 200, AH = 150;
    const ac   = document.createElement('canvas');
    ac.width   = AW; ac.height = AH;
    const actx = ac.getContext('2d', { willReadFrequently: true });
    actx.drawImage(this._video, 0, 0, AW, AH);
    const img  = actx.getImageData(0, 0, AW, AH).data;

    const swapped = this._isAxesSwapped();
    const N       = swapped ? AW : AH;

    const sliceBrightness = new Float32Array(N);
    if (!swapped) {
      const x0 = Math.floor(AW * 0.20), x1 = Math.floor(AW * 0.80);
      for (let y = 0; y < AH; y++) {
        let s = 0;
        for (let x = x0; x < x1; x++) {
          const i = (y * AW + x) * 4;
          s += img[i] * 0.299 + img[i+1] * 0.587 + img[i+2] * 0.114;
        }
        sliceBrightness[y] = s / (x1 - x0);
      }
    } else {
      const y0 = Math.floor(AH * 0.20), y1 = Math.floor(AH * 0.80);
      for (let x = 0; x < AW; x++) {
        let s = 0;
        for (let y = y0; y < y1; y++) {
          const i = (y * AW + x) * 4;
          s += img[i] * 0.299 + img[i+1] * 0.587 + img[i+2] * 0.114;
        }
        sliceBrightness[x] = s / (y1 - y0);
      }
    }

    const smoothed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      smoothed[i] = (sliceBrightness[Math.max(0, i-1)] +
                     sliceBrightness[i] +
                     sliceBrightness[Math.min(N-1, i+1)]) / 3;
    }

    let mean = 0, maxB = 0;
    for (let i = 0; i < N; i++) { mean += smoothed[i]; if (smoothed[i] > maxB) maxB = smoothed[i]; }
    mean /= N;
    const thresh = mean + (maxB - mean) * 0.30;

    const MIN_GAP = Math.max(3, Math.floor(N / (maxLanes + 1)));
    const peaks = [];
    for (let i = 1; i < N - 1; i++) {
      if (smoothed[i] > thresh &&
          smoothed[i] >= smoothed[i-1] &&
          smoothed[i] >= smoothed[i+1]) {
        if (!peaks.length || i - peaks[peaks.length-1] > MIN_GAP) {
          peaks.push(i);
        }
      }
    }

    if (peaks.length < 1 || peaks.length >= maxLanes) return null;

    const detectedLanes = peaks.length + 1;
    this._laneCount    = detectedLanes;
    this._laneDividers = peaks.map(p => p / N);
    this._cooldowns    = new Array(detectedLanes).fill(false);
    return { lanes: detectedLanes, dividers: this._laneDividers.slice() };
  }

  bindDrag(displayCanvas) {
    displayCanvas.style.touchAction = 'none';
    displayCanvas.style.cursor = 'grab';

    let dragging = null;

    const hitTest = (clientX, clientY) => {
      const rect = displayCanvas.getBoundingClientRect();
      const fx = (clientX - rect.left) / rect.width;
      const fy = (clientY - rect.top)  / rect.height;

      const lineDist = Math.abs(fx - this._linePos);
      const lineCyDist = Math.abs(fy - 0.5);
      if (lineDist < 0.06 && lineCyDist < 0.07) return 'line';

      for (let i = 0; i < this._laneDividers.length; i++) {
        const dyDist = Math.abs(fy - this._laneDividers[i]);
        const dxDist = Math.abs(fx - 0.5);
        if (dyDist < 0.06 && dxDist < 0.12) return { divider: i };
      }

      if (lineDist < 0.08) return 'line';

      return null;
    };

    const onMove = (clientX, clientY) => {
      if (dragging === null) return;
      const rect = displayCanvas.getBoundingClientRect();
      const fx = (clientX - rect.left) / rect.width;
      const fy = (clientY - rect.top)  / rect.height;

      if (dragging === 'line') {
        this._linePos = Math.max(0.05, Math.min(0.95, fx));
      } else {
        const i   = dragging.divider;
        const min = i === 0
          ? 0.05
          : this._laneDividers[i - 1] + 0.04;
        const max = i === this._laneDividers.length - 1
          ? 0.95
          : this._laneDividers[i + 1] - 0.04;
        this._laneDividers[i] = Math.max(min, Math.min(max, fy));
      }
    };

    const onStart = (clientX, clientY) => {
      dragging = hitTest(clientX, clientY) ?? 'line';
      displayCanvas.style.cursor = 'grabbing';
      onMove(clientX, clientY);
    };

    const onEnd = () => {
      dragging = null;
      displayCanvas.style.cursor = 'grab';
    };

    displayCanvas.addEventListener('touchstart', e => {
      e.preventDefault();
      onStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    displayCanvas.addEventListener('touchmove', e => {
      e.preventDefault();
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    displayCanvas.addEventListener('touchend', onEnd);

    displayCanvas.addEventListener('mousedown', e => onStart(e.clientX, e.clientY));
    displayCanvas.addEventListener('mousemove', e => { if (dragging !== null) onMove(e.clientX, e.clientY); });
    displayCanvas.addEventListener('mouseup',   onEnd);
    displayCanvas.addEventListener('mouseleave', onEnd);
  }
}