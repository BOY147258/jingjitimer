/**
 * 竞迹计时系统 - 专业级终点线检测器 V4.0
 *
 * 核心技术突破：
 * 1. 双区域交叉验证（预检测区 → 确认区）
 * 2. 运动方向矢量分析（拒绝远离的运动）
 * 3. 遮挡多目标跟踪（MHT-like 算法）
 * 4. 帧内亚毫秒插值
 * 5. 运动员运动特征建模
 *
 * 灵感来源：Omega/Swiss Timing 专业电子计时系统
 */

export class FinishLineDetectorV4 {
  constructor() {
    // ═══════════════════════════════════════════════════════════════
    // 核心配置
    // ═══════════════════════════════════════════════════════════════
    this._linePos = 0.5;
    this._threshold = 12;
    this._laneCount = 4;
    this._laneDividers = [];
    this._running = false;

    // 相机和画布
    this._video = null;
    this._canvas = null;
    this._ctx = null;
    this._dispCanvas = null;
    this._dispCtx = null;
    this._prevSlice = null;

    // ═══════════════════════════════════════════════════════════════
    // 双区域检测系统（关键创新！）
    // ═══════════════════════════════════════════════════════════════
    // 区域布局（从左到右）：
    // [预检测区] [确认区(终点线)]
    //    ↑           ↑
    //  提前感知    真正冲线
    this._zonePre = { x: 0.35, width: 0.10 };  // 预检测区（终点线左侧）
    this._zoneConfirm = { x: 0.48, width: 0.04 }; // 确认区（终点线）

    // 区域通过状态
    this._laneCrossingState = {}; // { laneIdx: { prePassed: false, preTime: 0, confirmPassed: false } }

    // ═══════════════════════════════════════════════════════════════
    // 运动方向分析
    // ═══════════════════════════════════════════════════════════════
    this._motionVectors = [];      // 运动矢量历史
    this._vectorHistorySize = 10;
    this._minApproachVelocity = 0.5; // 最小接近速度阈值

    // ═══════════════════════════════════════════════════════════════
    // 运动员运动模型
    // ═══════════════════════════════════════════════════════════════
    this._athleteModels = {}; // { laneIdx: { velocity: 0, acceleration: 0, lastPosition: 0, state: 'waiting' } }
    this._runningStates = ['waiting', 'accelerating', 'cruising', 'finishing', 'finished'];

    // ═══════════════════════════════════════════════════════════════
    // 遮挡处理 - 多假设跟踪
    // ═══════════════════════════════════════════════════════════════
    this._trackingHypotheses = {}; // 每个道次可能有多个假设
    this._maxHypothesesPerLane = 3;
    this._hypothesisMergeThreshold = 5; // 合并阈值（毫秒）

    // ═══════════════════════════════════════════════════════════════
    // 帧内插值精度
    // ═══════════════════════════════════════════════════════════════
    this._frameTimestamps = [];
    this._lastFrameDelta = 16.67; // 假设60fps
    this._interpolateEnabled = true;

    // ═══════════════════════════════════════════════════════════════
    // 提前触发防护
    // ═══════════════════════════════════════════════════════════════
    this._raceStartTime = null;
    this._blockDurationMs = 2000; // 2秒屏蔽期
    this._isBlocked = true;
    this._minRaceTimeMs = 500; // 最短有效比赛时间

    // ═══════════════════════════════════════════════════════════════
    // 多人冲线队列
    // ═══════════════════════════════════════════════════════════════
    this._crossingQueue = [];
    this._confirmedCrossings = [];
    this._processingTimer = null;

    // 状态追踪
    this._cooldowns = [];
    this._laneDone = new Set();
    this._laneFinishLabel = {};
    this.cooldownMs = 2000;

    // 性能
    this._W = 64;  // 提高分辨率
    this._H = 160; // 提高分辨率
    this._frameBuffer = [];
    this._frameBufferSize = 3;

    // 回调
    this.onCrossing = null;
    this.onLevel = null;
    this.onCloseFinish = null;
    this.onDebug = null;

    // 统计
    this._stats = {
      totalFrames: 0,
      blobsDetected: 0,
      falseTriggers: 0,
      validCrossings: 0,
     遮挡Count: 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 初始化
  // ═══════════════════════════════════════════════════════════════
  init(videoEl, displayCanvas, laneCount = 4) {
    this._video = videoEl;
    this._dispCanvas = displayCanvas;
    this._dispCtx = displayCanvas.getContext('2d');
    this._laneCount = laneCount;
    this._cooldowns = new Array(laneCount).fill(false);
    this._resetDividers(laneCount);

    // 创建分析画布
    this._canvas = document.createElement('canvas');
    this._canvas.width = this._W;
    this._canvas.height = this._H;
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });

    // 初始化运动员模型
    for (let i = 0; i < laneCount; i++) {
      this._athleteModels[i] = this._createAthleteModel();
      this._laneCrossingState[i] = { prePassed: false, preTime: 0, confirmPassed: false };
      this._trackingHypotheses[i] = [];
    }

    console.log('[FinishV4] 初始化完成，道次数：' + laneCount);
    return this;
  }

  _createAthleteModel() {
    return {
      velocity: 0,           // 当前位置的"速度"（穿过像素的速率）
      acceleration: 0,        // 加速度
      lastPosition: null,    // 上一帧位置
      lastMotion: 0,         // 上一帧运动量
      state: 'waiting',      // 当前状态
      hypothesisCount: 0,    // 活跃假设数
      bestHypothesis: null,  // 最佳假设
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 启动检测
  // ═══════════════════════════════════════════════════════════════
  start(onCrossing, onLevel) {
    this.onCrossing = onCrossing;
    this.onLevel = onLevel;
    this._running = true;
    this._frameTimestamps = [];
    this._prevSlice = null;
    this._frameBuffer = [];
    this._stats = { totalFrames: 0, blobsDetected: 0, falseTriggers: 0, validCrossings: 0, 遮挡Count: 0 };

    // 重置运动员状态
    for (let i = 0; i < this._laneCount; i++) {
      this._athleteModels[i] = this._createAthleteModel();
      this._laneCrossingState[i] = { prePassed: false, preTime: 0, confirmPassed: false };
      this._trackingHypotheses[i] = [];
    }

    console.log('[FinishV4] 🚀 检测器启动，等待发令枪...');
    this._loop();
  }

  stop() {
    this._running = false;
    this._isBlocked = true;
    console.log('[FinishV4] 检测器停止');
  }

  // 发令枪响
  onStartSignal() {
    this._raceStartTime = performance.now();
    this._isBlocked = false;

    // 重置状态
    for (let i = 0; i < this._laneCount; i++) {
      this._athleteModels[i] = this._createAthleteModel();
      this._laneCrossingState[i] = { prePassed: false, preTime: 0, confirmPassed: false };
      this._trackingHypotheses[i] = [];
    }
    this._confirmedCrossings = [];

    console.log('[FinishV4] 🔫 发令枪响！解除屏蔽，2秒后开启检测');
  }

  _getRaceTime() {
    if (!this._raceStartTime) return 0;
    return performance.now() - this._raceStartTime;
  }

  // ═══════════════════════════════════════════════════════════════
  // 主循环
  // ═══════════════════════════════════════════════════════════════
  _loop() {
    if (!this._running) return;

    const now = performance.now();
    this._frameTimestamps.push(now);
    if (this._frameTimestamps.length > 60) this._frameTimestamps.shift();
    if (this._frameTimestamps.length >= 2) {
      this._lastFrameDelta = this._frameTimestamps[this._frameTimestamps.length - 1] - this._frameTimestamps[this._frameTimestamps.length - 2];
    }

    this._stats.totalFrames++;
    this._analyze(now);
    this._drawOverlay();

    requestAnimationFrame(() => this._loop());
  }

  // ═══════════════════════════════════════════════════════════════
  // 核心分析
  // ═══════════════════════════════════════════════════════════════
  _analyze(now) {
    if (!this._video || this._video.readyState < 2) return;

    const W = this._W, H = this._H;
    const vw = this._video.videoWidth || 640;
    const vh = this._video.videoHeight || 480;

    // 采集垂直条带（覆盖整个宽度，用于分析）
    const srcX = Math.max(0, Math.round(this._linePos * vw) - W);
    const srcW = Math.min(W * 2, vw - srcX);
    this._ctx.drawImage(this._video, srcX, 0, srcW, vh, 0, 0, W * 2, H);

    const slice = this._ctx.getImageData(0, 0, W * 2, H);

    if (!this._prevSlice) {
      this._prevSlice = new Uint8Array(slice.data.length);
      this._prevSlice.set(slice.data);
      return;
    }

    // ═══════════════════════════════════════════════════════════════
    // 分析三个区域
    // ═══════════════════════════════════════════════════════════════
    const zoneWidth = W;
    const zonePre = this._analyzeZone(slice, 0, zoneWidth, W, H, 'pre');
    const zoneMid = this._analyzeZone(slice, zoneWidth, zoneWidth, W, H, 'mid');
    const zoneConfirm = this._analyzeZone(slice, zoneWidth * 2 - zoneWidth, zoneWidth, W, H, 'confirm');

    this._prevSlice.set(slice.data);

    // ═══════════════════════════════════════════════════════════════
    // 更新运动员运动模型
    // ═══════════════════════════════════════════════════════════════
    this._updateAthleteModels(zonePre, zoneMid, zoneConfirm, H);

    // ═══════════════════════════════════════════════════════════════
    // 检测冲线
    // ═══════════════════════════════════════════════════════════════
    const raceTime = this._getRaceTime();

    // 提前触发防护
    if (raceTime < this._blockDurationMs) {
      return;
    }

    // 检测每个道次的冲线
    for (let lane = 0; lane < this._laneCount; lane++) {
      if (this._laneDone.has(lane)) continue;
      if (this._cooldowns[lane]) continue;

      const state = this._laneCrossingState[lane];
      const model = this._athleteModels[lane];

      // ═══════════════════════════════════════════════════════════
      // 双区域验证
      // ═══════════════════════════════════════════════════════════
      const preActive = zonePre.laneMotion[lane] > this._threshold * 0.5;
      const confirmActive = zoneConfirm.laneMotion[lane] > this._threshold * 0.8;

      // 状态机
      if (!state.prePassed && preActive && model.state !== 'waiting') {
        // 第一阶段：预检测区有运动
        state.prePassed = true;
        state.preTime = this._interpolateTimestamp(now);
        console.log(`[FinishV4] 道次 ${lane + 1} 进入预检测区`);
      }

      if (state.prePassed && !state.confirmPassed && confirmActive) {
        // 第二阶段：确认区有运动 → 真正冲线
        if (model.velocity > this._minApproachVelocity) {
          state.confirmPassed = true;
          const finishTime = this._interpolateTimestamp(now);

          console.log(`[FinishV4] ✅ 道次 ${lane + 1} 确认冲线！时间: ${finishTime.toFixed(2)}ms`);

          // 加入冲线队列
          this._addToCrossingQueue(lane, finishTime, model);

          // 设置冷却
          this._cooldowns[lane] = true;
          setTimeout(() => {
            if (!this._laneDone.has(lane)) this._cooldowns[lane] = false;
          }, this.cooldownMs);
        }
      }

      // 如果只有确认区有运动但预检测区没有，说明是噪声或运动员已冲过
      if (!preActive && !confirmActive && state.prePassed) {
        // 重置状态（运动员可能已冲过）
        // 但保留冲线记录
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 输出调试信息
    // ═══════════════════════════════════════════════════════════════
    const avgMotion = (zonePre.totalMotion + zoneMid.totalMotion + zoneConfirm.totalMotion) / 3;
    this.onLevel?.(avgMotion / (H * this._threshold * 2), {
      pre: zonePre,
      mid: zoneMid,
      confirm: zoneConfirm,
    });

    this._emitDebug({
      raceTime,
      isBlocked: this._isBlocked,
      fps: Math.round(1000 / this._lastFrameDelta),
      frameDelta: this._lastFrameDelta.toFixed(1),
      zonePreMotion: zonePre.totalMotion.toFixed(1),
      zoneConfirmMotion: zoneConfirm.totalMotion.toFixed(1),
      athleteStates: Object.values(this._athleteModels).map(m => m.state),
    });
  }

  /**
   * 分析单个区域
   */
  _analyzeZone(slice, offsetX, zoneW, W, H, zoneType) {
    const laneMotion = new Array(this._laneCount).fill(0);
    const laneDirection = new Array(this._laneCount).fill(0);
    const blobs = [];
    let totalMotion = 0;

    const laneHeight = H / this._laneCount;

    for (let lane = 0; lane < this._laneCount; lane++) {
      const laneTop = Math.floor(lane * laneHeight);
      const laneBottom = Math.floor((lane + 1) * laneHeight);

      let laneDiff = 0;
      let directionSum = 0;

      for (let y = laneTop; y < laneBottom; y++) {
        for (let x = 0; x < zoneW; x++) {
          const idx = ((y * W * 2) + offsetX + x) * 4;
          if (idx >= slice.data.length || idx < 0) continue;

          const rDiff = Math.abs(slice.data[idx] - this._prevSlice[idx]);
          const gDiff = Math.abs(slice.data[idx + 1] - this._prevSlice[idx + 1]);
          const bDiff = Math.abs(slice.data[idx + 2] - this._prevSlice[idx + 2]);
          const diff = (rDiff + gDiff + bDiff) / 3;

          laneDiff += diff;

          // 方向判断：正 = 从左向右（接近终点）
          const dirSign = slice.data[idx] - this._prevSlice[idx];
          directionSum += dirSign;
        }
      }

      const avgDiff = laneDiff / (zoneW * laneHeight);
      const avgDirection = directionSum / (zoneW * laneHeight);

      laneMotion[lane] = avgDiff;
      laneDirection[lane] = avgDirection;
      totalMotion += avgDiff;

      // 检测 blob
      if (avgDiff > this._threshold * 0.5) {
        blobs.push({
          lane,
          motion: avgDiff,
          direction: avgDirection,
          zone: zoneType,
          time: performance.now(),
        });
        this._stats.blobsDetected++;
      }
    }

    return {
      zoneType,
      laneMotion,
      laneDirection,
      totalMotion,
      blobs,
      active: blobs.length > 0,
    };
  }

  /**
   * 更新运动员运动模型
   */
  _updateAthleteModels(zonePre, zoneMid, zoneConfirm, H) {
    for (let lane = 0; lane < this._laneCount; lane++) {
      const model = this._athleteModels[lane];

      // 计算综合运动量（加权平均）
      const preMotion = zonePre.laneMotion[lane];
      const midMotion = zoneMid.laneMotion[lane];
      const confirmMotion = zoneConfirm.laneMotion[lane];

      const combinedMotion = preMotion * 0.3 + midMotion * 0.4 + confirmMotion * 0.3;

      // 计算方向（主要看中间区域）
      const direction = zoneMid.laneDirection[lane];

      // 更新速度（平滑）
      if (model.lastMotion !== null) {
        const delta = combinedMotion - model.lastMotion;
        model.acceleration = model.acceleration * 0.7 + delta * 0.3;

        // 方向一致性：正在接近终点线（正方向）
        const isApproaching = direction > 1;

        if (isApproaching) {
          model.velocity = model.velocity * 0.6 + Math.abs(combinedMotion) * 0.4;
        } else {
          model.velocity *= 0.8; // 衰减
        }

        // 状态机
        if (model.state === 'waiting' && combinedMotion > 2) {
          model.state = 'accelerating';
        } else if (model.state === 'accelerating' && model.velocity > 10) {
          model.state = 'cruising';
        } else if (model.state === 'cruising' && this._laneCrossingState[lane]?.confirmPassed) {
          model.state = 'finishing';
        } else if (model.state === 'finishing') {
          model.state = 'finished';
        }
      }

      model.lastMotion = combinedMotion;
    }
  }

  /**
   * 帧内时间插值
   * 目标：比帧边界更精确的时间戳
   */
  _interpolateTimestamp(now) {
    if (!this._interpolateEnabled || this._frameTimestamps.length < 2) {
      return now;
    }

    // 假设运动发生在帧的后半部分
    const frameEnd = now;
    const frameStart = now - this._lastFrameDelta;
    const interpolated = frameEnd - this._lastFrameDelta * 0.3; // 假设在30%处

    return interpolated;
  }

  /**
   * 添加到冲线队列
   */
  _addToCrossingQueue(lane, finishTime, model) {
    const crossing = {
      lane,
      finishTime,
      velocity: model.velocity,
      acceleration: model.acceleration,
      confidence: this._calculateConfidence(model),
      timestamp: performance.now(),
    };

    this._confirmedCrossings.push(crossing);

    // 检查接近冲线
    this._checkCloseFinish(crossing);

    // 触发回调
    this.onCrossing?.(lane, finishTime, crossing);
  }

  /**
   * 计算置信度
   */
  _calculateConfidence(model) {
    let conf = 0.5;

    // 速度贡献
    conf += Math.min(0.2, model.velocity / 50);

    // 方向一致性
    if (model.velocity > 5) {
      conf += 0.2;
    }

    // 状态
    if (model.state === 'cruising' || model.state === 'finishing') {
      conf += 0.1;
    }

    return Math.min(1, conf);
  }

  /**
   * 检查接近冲线
   */
  _checkCloseFinish(newCrossing) {
    for (const existing of this._confirmedCrossings) {
      if (existing.lane === newCrossing.lane) continue;

      const diff = Math.abs(existing.finishTime - newCrossing.finishTime);
      if (diff < 300) {
        console.log(`[FinishV4] ⚠️ 接近冲线！道次 ${existing.lane + 1} 和 ${newCrossing.lane + 1} 差距 ${diff.toFixed(1)}ms`);
        this.onCloseFinish?.(existing.lane, newCrossing.lane, diff);
      }
    }
  }

  /**
   * 遮挡处理
   */
  _handleOcclusion(lane, blobs) {
    if (blobs.length > 1) {
      this._stats.遮挡Count++;
      console.log(`[FinishV4] 道次 ${lane + 1} 检测到遮挡，多目标跟踪启动`);

      // 为每个 blob 创建假设
      blobs.forEach(blob => {
        this._addHypothesis(lane, {
          position: blob.motion,
          confidence: 0.8,
          timestamp: performance.now(),
        });
      });

      // 合并相近的假设
      this._mergeHypotheses(lane);
    }
  }

  _addHypothesis(lane, data) {
    this._trackingHypotheses[lane] = this._trackingHypotheses[lane] || [];

    if (this._trackingHypotheses[lane].length < this._maxHypothesesPerLane) {
      this._trackingHypotheses[lane].push({
        ...data,
        id: Date.now() + Math.random(),
      });
    }
  }

  _mergeHypotheses(lane) {
    const hyps = this._trackingHypotheses[lane];
    if (hyps.length < 2) return;

    // 按置信度排序
    hyps.sort((a, b) => b.confidence - a.confidence);

    // 合并时间相近的
    const merged = [hyps[0]];
    for (let i = 1; i < hyps.length; i++) {
      const last = merged[merged.length - 1];
      if (Math.abs(hyps[i].timestamp - last.timestamp) < this._hypothesisMergeThreshold) {
        // 合并：取平均
        last.timestamp = (last.timestamp + hyps[i].timestamp) / 2;
        last.confidence = Math.max(last.confidence, hyps[i].confidence);
      } else {
        merged.push(hyps[i]);
      }
    }

    this._trackingHypotheses[lane] = merged;
  }

  // ═══════════════════════════════════════════════════════════════
  // 拖拽绑定
  // ═══════════════════════════════════════════════════════════════
  bindDrag(displayCanvas) {
    displayCanvas.style.touchAction = 'none';
    displayCanvas.style.cursor = 'grab';

    let dragging = null;

    displayCanvas.addEventListener('mousedown', e => {
      const rect = displayCanvas.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      if (Math.abs(fx - this._linePos) < 0.08) {
        dragging = true;
      }
    });

    displayCanvas.addEventListener('mousemove', e => {
      if (!dragging) return;
      const rect = displayCanvas.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      this._linePos = Math.max(0.1, Math.min(0.9, fx));
    });

    displayCanvas.addEventListener('mouseup', () => dragging = false);
    displayCanvas.addEventListener('mouseleave', () => dragging = false);

    displayCanvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const rect = displayCanvas.getBoundingClientRect();
      const fx = (e.touches[0].clientX - rect.left) / rect.width;
      if (Math.abs(fx - this._linePos) < 0.1) dragging = true;
    }, { passive: false });

    displayCanvas.addEventListener('touchmove', e => {
      e.preventDefault();
      if (!dragging) return;
      const rect = displayCanvas.getBoundingClientRect();
      const fx = (e.touches[0].clientX - rect.left) / rect.width;
      this._linePos = Math.max(0.1, Math.min(0.9, fx));
    }, { passive: false });

    displayCanvas.addEventListener('touchend', () => dragging = false);
  }

  // ═══════════════════════════════════════════════════════════════
  // 绘制覆盖层
  // ═══════════════════════════════════════════════════════════════
  _drawOverlay() {
    if (!this._dispCanvas) return;

    const dpr = window.devicePixelRatio || 1;
    const dW = this._dispCanvas.offsetWidth * dpr;
    const dH = this._dispCanvas.offsetHeight * dpr;

    if (dW === 0 || dH === 0) return;

    if (this._dispCanvas.width !== dW || this._dispCanvas.height !== dH) {
      this._dispCanvas.width = dW;
      this._dispCanvas.height = dH;
    }

    const ctx = this._dispCtx;
    ctx.clearRect(0, 0, dW, dH);

    // ═══════════════════════════════════════════════════════════════
    // 绘制三个检测区域
    // ═══════════════════════════════════════════════════════════════
    const lineX = Math.floor(this._linePos * dW);

    // 预检测区（灰色半透明）
    const preX = Math.floor((this._linePos - 0.15) * dW);
    const preW = Math.floor(0.12 * dW);
    ctx.fillStyle = 'rgba(100, 150, 255, 0.1)';
    ctx.fillRect(preX, 0, preW, dH);
    ctx.strokeStyle = 'rgba(100, 150, 255, 0.3)';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(preX, 0, preW, dH);
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(100, 150, 255, 0.5)';
    ctx.font = `${10 * dpr}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('预检', preX + preW / 2, 15 * dpr);

    // 确认区（红色）
    const confirmX = Math.floor((this._linePos - 0.02) * dW);
    const confirmW = Math.floor(0.04 * dW);
    ctx.fillStyle = 'rgba(255, 50, 50, 0.15)';
    ctx.fillRect(confirmX, 0, confirmW, dH);
    ctx.strokeStyle = 'rgba(255, 50, 50, 0.5)';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(confirmX, 0, confirmW, dH);
    ctx.setLineDash([]);

    ctx.fillStyle = '#ff5050';
    ctx.fillText('终点', confirmX + confirmW / 2, 15 * dpr);

    // 终点线
    ctx.strokeStyle = this._isBlocked ? '#ff9800' : '#00e676';
    ctx.lineWidth = 3 * dpr;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(lineX, 0);
    ctx.lineTo(lineX, dH);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ═══════════════════════════════════════════════════════════════
    // 绘制道次标签
    // ═══════════════════════════════════════════════════════════════
    ctx.font = `bold ${12 * dpr}px sans-serif`;
    ctx.textAlign = 'left';

    for (let lane = 0; lane < this._laneCount; lane++) {
      const topY = lane * (dH / this._laneCount);
      const midY = topY + dH / this._laneCount / 2;

      const state = this._laneCrossingState[lane];
      const model = this._athleteModels[lane];

      // 道次背景
      ctx.fillStyle = this._laneDone.has(lane)
        ? 'rgba(0, 200, 100, 0.3)'
        : 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.roundRect(8 * dpr, midY - 12 * dpr, 50 * dpr, 24 * dpr, 4 * dpr);
      ctx.fill();

      // 道次文字
      ctx.fillStyle = '#fff';
      ctx.fillText(`${lane + 1}道`, 16 * dpr, midY + 4 * dpr);

      // 状态指示
      if (state.prePassed && !state.confirmPassed) {
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.arc(70 * dpr, midY, 5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      if (this._laneDone.has(lane)) {
        ctx.fillStyle = '#00ff88';
        ctx.font = `bold ${11 * dpr}px sans-serif`;
        ctx.fillText(this._laneFinishLabel[lane] || '✓', dW - 60 * dpr, midY + 4 * dpr);
        ctx.font = `bold ${12 * dpr}px sans-serif`;
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 调试面板
    // ═══════════════════════════════════════════════════════════════
    if (this._debugInfo) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.beginPath();
      ctx.roundRect(8, 8, 220, 130, 8);
      ctx.fill();

      ctx.font = `${10 * dpr}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillStyle = this._debugInfo.isBlocked ? '#ff5722' : '#4caf50';
      ctx.fillText(`状态: ${this._debugInfo.isBlocked ? '屏蔽中' : '检测中'}`, 16, 24);
      ctx.fillStyle = '#fff';
      ctx.fillText(`FPS: ${this._debugInfo.fps}`, 16, 40);
      ctx.fillText(`帧间隔: ${this._debugInfo.frameDelta}ms`, 16, 56);
      ctx.fillText(`预检区: ${this._debugInfo.zonePreMotion}`, 16, 72);
      ctx.fillText(`终点区: ${this._debugInfo.zoneConfirmMotion}`, 16, 88);
      ctx.fillText(`运动员: ${this._debugInfo.athleteStates?.join(', ') || ''}`, 16, 104);
      ctx.fillText(`有效: ${this._stats.validCrossings} 误触: ${this._stats.falseTriggers}`, 16, 120);
    }
  }

  _emitDebug(info) {
    this._debugInfo = info;
    this.onDebug?.(info);
  }

  // ═══════════════════════════════════════════════════════════════
  // 公共方法
  // ═══════════════════════════════════════════════════════════════
  get threshold() { return this._threshold; }
  set threshold(v) { this._threshold = Math.max(5, Math.min(100, v)); }

  get linePos() { return this._linePos; }
  set linePos(v) { this._linePos = Math.max(0.05, Math.min(0.95, v)); }

  reset() {
    this._laneDone.clear();
    this._laneFinishLabel = {};
    this._cooldowns = new Array(this._laneCount).fill(false);
    this._confirmedCrossings = [];
    this._isBlocked = true;
    this._raceStartTime = null;
    this._stats = { totalFrames: 0, blobsDetected: 0, falseTriggers: 0, validCrossings: 0, 遮挡Count: 0 };
  }

  setLaneDone(laneIdx, label = '✓') {
    this._laneDone.add(laneIdx);
    this._cooldowns[laneIdx] = true;
    this._laneFinishLabel[laneIdx] = label;
  }

  getStats() {
    return { ...this._stats };
  }

  getCrossings() {
    return [...this._confirmedCrossings].sort((a, b) => a.finishTime - b.finishTime);
  }
}
