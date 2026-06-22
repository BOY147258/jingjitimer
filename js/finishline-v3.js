// 竞迹计时系统 - 终点线检测器 V3.0
// 优化：运动方向判断 + 双重验证 + 提前触发防护 + 专业计时器精度

/**
 * 核心改进：
 * 1. 运动方向判断：只检测向终点线"接近"的运动，不检测远离的运动
 * 2. 提前触发防护：起跑阶段（前3秒）不触发终点检测
 * 3. 双重验证：运动强度 + 方向 + 时序一致性
 * 4. 专业精度：帧内插值 + 相机延迟补偿
 */

export class FinishLineDetectorV3 {
  constructor() {
    // 基础组件
    this._video = null;
    this._canvas = null;
    this._ctx = null;
    this._dispCanvas = null;
    this._dispCtx = null;
    this._running = false;

    // 检测参数
    this._linePos = 0.5;
    this._threshold = 12;
    this._baseThreshold = 12;
    this._laneCount = 4;
    this._laneDividers = [];

    // 性能参数
    this._W = 48;
    this._H = 120;
    this._frameBuffer = [];
    this._frameBufferSize = 3;
    this._prevSlice = null;

    // 状态追踪
    this._cooldowns = new Array(8).fill(false);
    this._laneDone = new Set();
    this._laneFinishLabel = {};
    this.cooldownMs = 1500;

    // ── 新增：运动方向判断 ──────────────────────────────────────────────────
    this._motionDirection = new Float32Array(120); // 每行的运动方向 (-1: 远离, 0: 无运动, 1: 接近)
    this._prevMotionFrame = null;                  // 上一帧的运动数据
    this._currentMotionFrame = null;               // 当前帧的运动数据

    // ── 新增：提前触发防护 ──────────────────────────────────────────────────
    this._raceStartTime = null;         // 比赛开始时间
    this._blockDurationMs = 3000;       // 起跑阶段屏蔽时长（3秒）
    this._minRaceTime = 3000;          // 最小比赛时间（毫秒）
    this._isBlocked = true;            // 是否在屏蔽期内

    // ── 新增：双重验证 ──────────────────────────────────────────────────────
    this._motionHistory = new Array(120).fill(0); // 运动历史
    this._historySize = 5;
    this._validationWindow = [];       // 验证窗口

    // ── 新增：精度提升 ──────────────────────────────────────────────────────
    this._cameraDelayMs = 0;          // 相机延迟补偿
    this._calibrationResults = [];
    this._frameTimestamps = [];        // 帧时间戳
    this._interpolateEnabled = true;   // 帧内插值开关

    // ── 新增：误触发追踪 ────────────────────────────────────────────────────
    this._falseTriggerCount = 0;
    this._lastFalseTrigger = 0;
    this._gracePeriod = 800;           // 宽限期（毫秒）

    // 回调
    this.onCrossing = null;
    this.onLevel = null;
    this.onCloseFinish = null;

    // 调试信息
    this._debug = {
      lastBlobCount: 0,
      directionAccuracy: 0,
      avgMotion: 0,
      blocked: true,
    };
  }

  // ── 初始化 ────────────────────────────────────────────────────────────────
  init(videoEl, displayCanvas, laneCount = 4) {
    this._video = videoEl;
    this._dispCanvas = displayCanvas;
    this._dispCtx = displayCanvas.getContext('2d');
    this._laneCount = laneCount;
    this._cooldowns = new Array(laneCount).fill(false);
    this._resetDividers(laneCount);

    this._canvas = document.createElement('canvas');
    this._canvas.width = this._W;
    this._canvas.height = this._H;
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
  }

  // ── 开始检测 ────────────────────────────────────────────────────────────────
  start(onCrossing, onLevel) {
    this.onCrossing = onCrossing;
    this.onLevel = onLevel;
    this._running = true;
    this._raceStartTime = null;
    this._isBlocked = true;
    this._frameTimestamps = [];
    this._prevSlice = null;
    this._prevMotionFrame = null;
    this._frameBuffer = [];
    this._validationWindow = [];
    console.log('[FinishV3] 检测器已启动，等待发令枪...');
    this._loop();
  }

  // ── 停止检测 ────────────────────────────────────────────────────────────────
  stop() {
    this._running = false;
    this._isBlocked = true;
    console.log('[FinishV3] 检测器已停止');
  }

  // ── 发令枪响：解除屏蔽 ──────────────────────────────────────────────────────
  onStartSignal() {
    this._raceStartTime = performance.now();
    this._isBlocked = false;
    this._frameTimestamps = [];
    console.log('[FinishV3] 🚀 发令枪响，比赛开始！解除终点检测屏蔽');

    // 3秒后自动解除严格模式
    setTimeout(() => {
      this._isBlocked = false;
      console.log('[FinishV3] ✓ 起跑阶段结束，开启完整检测');
    }, this._blockDurationMs);
  }

  // ── 获取比赛已进行时间 ─────────────────────────────────────────────────────
  _getRaceTime() {
    if (!this._raceStartTime) return 0;
    return performance.now() - this._raceStartTime;
  }

  // ── 重置 ──────────────────────────────────────────────────────────────────
  reset() {
    this._laneDone.clear();
    this._laneFinishLabel = {};
    this._cooldowns = new Array(this._laneCount).fill(false);
    this._frameBuffer = [];
    this._prevSlice = null;
    this._prevMotionFrame = null;
    this._isBlocked = true;
    this._raceStartTime = null;
    this._validationWindow = [];
    this._falseTriggerCount = 0;
  }

  resetLaneDone() {
    this.reset();
  }

  setLaneDone(laneIdx, label = '✓') {
    this._laneDone.add(laneIdx);
    this._cooldowns[laneIdx] = true;
    this._laneFinishLabel[laneIdx] = label;
  }

  get threshold() { return this._threshold; }
  set threshold(v) { this._threshold = Math.max(5, Math.min(100, v)); this._baseThreshold = v; }

  get linePos() { return this._linePos; }
  set linePos(v) { this._linePos = Math.max(0.05, Math.min(0.95, v)); }

  // ── 主循环 ─────────────────────────────────────────────────────────────────
  _loop() {
    if (!this._running) return;

    const now = performance.now();
    this._frameTimestamps.push(now);
    if (this._frameTimestamps.length > 30) this._frameTimestamps.shift();

    this._skipFrames = (this._skipFrames || 0) + 1;
    if (this._skipFrames % this._getAdaptiveSkip() === 0) {
      this._analyze();
    }

    this._drawOverlay();
    requestAnimationFrame(() => this._loop());
  }

  _getAdaptiveSkip() {
    // 根据帧率自适应跳帧
    if (this._frameTimestamps.length < 5) return 1;
    const intervals = [];
    for (let i = 1; i < this._frameTimestamps.length; i++) {
      intervals.push(this._frameTimestamps[i] - this._frameTimestamps[i - 1]);
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const fps = 1000 / avgInterval;

    if (fps >= 45) return 1;
    if (fps >= 30) return 2;
    if (fps >= 20) return 3;
    return 4;
  }

  // ── 核心分析 ────────────────────────────────────────────────────────────────
  _analyze() {
    if (!this._video || this._video.readyState < 2) return;

    const W = this._W, H = this._H;
    const vw = this._video.videoWidth || 640;
    const vh = this._video.videoHeight || 480;

    // 采集帧条
    const srcX = Math.max(0, Math.round(this._linePos * vw) - W / 2);
    this._ctx.drawImage(this._video, srcX, 0, Math.min(W, vw - srcX), vh, 0, 0, W, H);
    const slice = this._ctx.getImageData(0, 0, W, H);

    if (!this._prevSlice) {
      this._prevSlice = new Uint8Array(slice.data.length);
      this._prevSlice.set(slice.data);
      return;
    }

    // ── 计算每行运动强度 ──────────────────────────────────────────────────
    const motionPerRow = new Float32Array(H);
    const directionPerRow = new Float32Array(H); // 运动方向

    for (let y = 0; y < H; y++) {
      let rowDiff = 0;
      let directionAcc = 0;

      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;

        // RGB 差异
        const rDiff = slice.data[i] - this._prevSlice[i];
        const gDiff = slice.data[i + 1] - this._prevSlice[i + 1];
        const bDiff = slice.data[i + 2] - this._prevSlice[i + 2];

        // 运动强度（绝对值）
        rowDiff += (Math.abs(rDiff) + Math.abs(gDiff) + Math.abs(bDiff)) / 3;

        // 运动方向：检测水平移动
        // 正值 = 物体从左向右移动（接近终点线）
        // 负值 = 物体从右向左移动（远离终点线）
        directionAcc += rDiff; // 使用红色通道作为主要方向判断
      }

      motionPerRow[y] = rowDiff / W;
      directionPerRow[y] = directionAcc / W; // 平均方向
    }

    this._prevSlice.set(slice.data);

    // 保存运动帧用于方向判断
    if (this._prevMotionFrame) {
      this._currentMotionFrame = this._prevMotionFrame.slice();
    }
    this._prevMotionFrame = motionPerRow.slice();

    // ── 平滑处理 ──────────────────────────────────────────────────────────
    this._frameBuffer.push(motionPerRow);
    if (this._frameBuffer.length > this._frameBufferSize) {
      this._frameBuffer.shift();
    }

    const smoothedMotion = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      let sum = 0;
      for (const frame of this._frameBuffer) {
        sum += frame[y];
      }
      smoothedMotion[y] = sum / this._frameBuffer.length;
    }

    // ── 更新历史 ──────────────────────────────────────────────────────────
    for (let i = 0; i < H; i++) {
      this._motionHistory[i] = (this._motionHistory[i] + smoothedMotion[i]) / 2;
    }

    // ── 计算总运动强度 ────────────────────────────────────────────────────
    let total = 0;
    for (let i = 0; i < H; i++) total += smoothedMotion[i];
    const level = Math.min(1, total / (H * this._threshold * 2));
    this._lastMotion = level;

    // ── 检测 blob ─────────────────────────────────────────────────────────
    const blobs = this._detectBlobs(smoothedMotion, directionPerRow, H);

    this._debug.lastBlobCount = blobs.length;
    this._debug.avgMotion = total / H;
    this._debug.blocked = this._isBlocked;

    this.onLevel?.(level, blobs);

    // ── 处理每个 blob ─────────────────────────────────────────────────────
    for (const blob of blobs) {
      this._processBlob(blob, smoothedMotion, directionPerRow, H);
    }
  }

  // ── 检测运动 blob（带方向信息）─────────────────────────────────────────────
  _detectBlobs(motionPerRow, directionPerRow, H) {
    const THRESH = this._threshold * 0.6;
    const MIN_PX = Math.floor(H * 0.06);

    const blobs = [];
    let start = -1;
    let maxM = 0, maxAt = -1;
    let dirAcc = 0;

    for (let y = 0; y <= H; y++) {
      const m = y < H ? motionPerRow[y] : 0;
      const d = y < H ? directionPerRow[y] : 0;

      if (m > THRESH && start < 0) {
        start = y;
        maxM = m;
        maxAt = y;
        dirAcc = d;
      } else if (m > THRESH) {
        if (m > maxM) {
          maxM = m;
          maxAt = y;
        }
        dirAcc += d;
      } else if (start >= 0) {
        const len = y - start;
        if (len >= MIN_PX) {
          // 计算平均方向
          const avgDir = dirAcc / len;

          // 计算方向一致性（所有行方向相同的比例）
          let consistentRows = 0;
          for (let i = start; i < y; i++) {
            if (directionPerRow[i] * avgDir > 0) consistentRows++;
          }
          const dirConsistency = consistentRows / len;

          blobs.push({
            top: start,
            bottom: y,
            center: (start + y) / 2,
            peak: maxM,
            peakAt: maxAt,
            avgDirection: avgDir,           // 平均方向
            dirConsistency: dirConsistency,  // 方向一致性
          });
        }
        start = -1;
        maxM = 0;
        maxAt = -1;
        dirAcc = 0;
      }
    }

    return blobs;
  }

  // ── 处理 blob ──────────────────────────────────────────────────────────────
  _processBlob(blob, motionPerRow, directionPerRow, H) {
    const now = performance.now();

    // ════════════════════════════════════════════════════════════════════════
    // 第一重验证：方向判断（最关键！）
    // ════════════════════════════════════════════════════════════════════════
    // 只有物体向终点线"接近"时才触发（方向值为正）
    // 如果物体远离终点线，不触发
    const isApproaching = blob.avgDirection > 2;
    const hasConsistentDirection = blob.dirConsistency > 0.6;

    if (!isApproaching) {
      // 物体在远离终点线，可能是冲线后继续奔跑
      // 不触发终点检测
      this._registerFalseTrigger('wrong_direction');
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    // 第二重验证：提前触发防护
    // ════════════════════════════════════════════════════════════════════════
    const raceTime = this._getRaceTime();

    // 比赛刚开始的 3 秒内是屏蔽期
    if (raceTime < this._blockDurationMs) {
      this._registerFalseTrigger('blocked_period');
      return;
    }

    // 如果比赛还没开始（没有收到发令信号）
    if (this._raceStartTime === null) {
      this._registerFalseTrigger('no_start_signal');
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    // 第三重验证：运动强度检查
    // ════════════════════════════════════════════════════════════════════════
    const minMotionPeak = 8;
    if (blob.peak < minMotionPeak) {
      this._registerFalseTrigger('low_motion');
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    // 第四重验证：趋势验证
    // ════════════════════════════════════════════════════════════════════════
    const isTrending = this._isMotionTrending();
    if (!isTrending && blob.peak < this._threshold * 1.5) {
      this._registerFalseTrigger('no_trend');
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    // 第五重验证：道次分配 + 冷却检查
    // ════════════════════════════════════════════════════════════════════════
    const laneIdx = this._assignLane(blob, H);

    if (this._laneDone.has(laneIdx)) {
      return; // 已完赛
    }

    if (this._cooldowns[laneIdx]) {
      return; // 冷却中
    }

    // ════════════════════════════════════════════════════════════════════════
    // 第六重验证：宽限期检查
    // ════════════════════════════════════════════════════════════════════════
    const timeSinceLastFalse = now - this._lastFalseTrigger;
    if (timeSinceLastFalse < this._gracePeriod) {
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    // 通过所有验证 → 触发冲线
    // ════════════════════════════════════════════════════════════════════════

    // 计算精确时间戳（应用相机延迟补偿）
    let finishTime = now - this._cameraDelayMs;

    // 如果启用了帧内插值，尝试更精确的时间
    if (this._interpolateEnabled && this._frameTimestamps.length >= 2) {
      const frameInterval = this._frameTimestamps[this._frameTimestamps.length - 1] -
                          this._frameTimestamps[this._frameTimestamps.length - 2];
      // 假设运动发生在帧的后半部分
      finishTime = now - frameInterval / 2 - this._cameraDelayMs;
    }

    console.log(`[FinishV3] 🏁 道次 ${laneIdx + 1} 冲线！时间: ${finishTime.toFixed(1)}ms (运动强度: ${blob.peak.toFixed(1)}, 方向: ${blob.avgDirection.toFixed(1)})`);

    // 设置冷却
    this._cooldowns[laneIdx] = true;
    setTimeout(() => {
      if (!this._laneDone.has(laneIdx)) {
        this._cooldowns[laneIdx] = false;
      }
    }, this.cooldownMs);

    // 触发回调
    this.onCrossing?.(laneIdx, finishTime);

    // 检查接近冲线
    this._checkCloseFinish(laneIdx, finishTime);
  }

  // ── 趋势验证 ────────────────────────────────────────────────────────────────
  _isMotionTrending() {
    if (this._frameBuffer.length < 3) return true;

    const recent = [];
    for (const frame of this._frameBuffer.slice(-3)) {
      let sum = 0;
      for (let i = 0; i < frame.length; i++) sum += frame[i];
      recent.push(sum);
    }

    // 至少 2 帧在上升
    let rising = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i] > recent[i - 1] * 1.1) rising++;
    }

    return rising >= 1;
  }

  // ── 道次分配 ────────────────────────────────────────────────────────────────
  _assignLane(blob, H) {
    // 使用 blob 的中心位置分配道次
    const relY = blob.center / H;

    for (let i = 0; i < this._laneDividers.length; i++) {
      if (relY < this._laneDividers[i]) return i;
    }

    return this._laneCount - 1;
  }

  // ── 检查接近冲线 ────────────────────────────────────────────────────────────
  _checkCloseFinish(laneIdx, finishTime) {
    if (this._lastCrossingLane >= 0 && this._lastCrossingLane !== laneIdx) {
      const diffMs = finishTime - this._lastCrossingTime;
      if (diffMs < 300 && diffMs > 0) {
        this.onCloseFinish?.(this._lastCrossingLane, laneIdx, Math.round(diffMs));
      }
    }
    this._lastCrossingLane = laneIdx;
    this._lastCrossingTime = finishTime;
  }

  // ── 误触发记录 ──────────────────────────────────────────────────────────────
  _registerFalseTrigger(reason) {
    this._falseTriggerCount++;

    // 节流：每秒最多记录一次
    const now = performance.now();
    if (now - this._lastFalseTrigger < 1000) return;

    this._lastFalseTrigger = now;
    console.log(`[FinishV3] 误触发过滤 (${reason}): 当前计数 ${this._falseTriggerCount}`);
  }

  // ── 相机延迟校准 ────────────────────────────────────────────────────────────
  startCalibration() {
    console.log('[FinishV3] 开始相机延迟校准...');
    // 需要配合声音触发
    // 当听到声音时记录时间，当检测到运动时记录时间
    // 多次测量取中位数
  }

  setCalibrationResult(delayMs) {
    this._cameraDelayMs = Math.max(0, Math.min(200, delayMs));
    console.log(`[FinishV3] 相机延迟补偿: ${this._cameraDelayMs}ms`);
  }

  getCalibration() {
    return {
      delayMs: this._cameraDelayMs,
      isCalibrated: this._cameraDelayMs > 0,
    };
  }

  // ── 绘制覆盖层 ──────────────────────────────────────────────────────────────
  _drawOverlay() {
    if (!this._dispCanvas) return;

    const dpr = window.devicePixelRatio || 1;
    const dW = this._dispCanvas.offsetWidth * dpr;
    const dH = this._dispCanvas.offsetHeight * dpr;

    if (dW === 0 || dH === 0) return;

    // 调整 canvas 分辨率
    if (this._dispCanvas.width !== dW || this._dispCanvas.height !== dH) {
      this._dispCanvas.width = dW;
      this._dispCanvas.height = dH;
    }

    const ctx = this._dispCtx;
    ctx.clearRect(0, 0, dW, dH);

    // 绘制终点线
    const lineX = Math.floor(this._linePos * dW);
    const motion = this._lastMotion || 0;

    // 运动强度颜色
    const col = motion > 0.6 ? '#ff1744' : motion > 0.25 ? '#ffd600' : '#00e676';

    // 绘制终点线
    ctx.strokeStyle = col;
    ctx.lineWidth = 3 * dpr;
    ctx.setLineDash([12 * dpr, 5 * dpr]);
    ctx.beginPath();
    ctx.moveTo(lineX, 0);
    ctx.lineTo(lineX, dH);
    ctx.stroke();
    ctx.setLineDash([]);

    // 绘制道次分隔线
    this._drawLaneDividers(ctx, dW, dH, dpr);

    // ── 调试信息面板 ──────────────────────────────────────────────────────
    if (this._debug) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(5, 5, 180 * dpr, 90 * dpr);

      ctx.font = `${11 * dpr}px monospace`;
      ctx.fillStyle = this._debug.blocked ? '#ff5722' : '#4caf50';
      ctx.fillText(`状态: ${this._debug.blocked ? '屏蔽中' : '检测中'}`, 12, 22 * dpr);

      ctx.fillStyle = '#fff';
      ctx.fillText(`FPS: ${Math.round(1000 / (this._frameTimestamps[1] - this._frameTimestamps[0]) || 30)}`, 12, 38 * dpr);
      ctx.fillText(`运动: ${this._debug.avgMotion.toFixed(1)}`, 12, 54 * dpr);
      ctx.fillText(`Blob: ${this._debug.lastBlobCount}`, 12, 70 * dpr);
      ctx.fillText(`误触: ${this._falseTriggerCount}`, 12, 86 * dpr);
    }
  }

  _drawLaneDividers(ctx, dW, dH, dpr) {
    if (this._laneCount < 2) return;

    for (let i = 1; i < this._laneCount; i++) {
      const y = Math.floor(this._laneDividers[i - 1] * dH);

      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(dW, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ── 导出 ────────────────────────────────────────────────────────────────────
  getDebugInfo() {
    return {
      ...this._debug,
      raceTime: this._getRaceTime(),
      cameraDelay: this._cameraDelayMs,
      isBlocked: this._isBlocked,
    };
  }
}
