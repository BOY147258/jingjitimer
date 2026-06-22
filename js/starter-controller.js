// 竞迹计时系统 - 增强型发令控制器 V3.0
// 整合：时钟同步 + 发令音频 + 终点检测

import { clockSync, getServerTime, formatRaceTime } from './clock-sync.js';
import { startAudio } from './start-audio.js';
import { FinishLineDetectorV3 } from './finishline-v3.js';
import { shotManager, RaceState, StateDisplayNames } from './shot-manager.js';

// ── 发令端状态机 ──────────────────────────────────────────────────────────────
export class StarterController {
  constructor() {
    // 核心组件
    this._audio = startAudio;
    this._clockSync = clockSync;
    this._finishDetector = null;

    // 状态
    this._state = RaceState.IDLE;
    this._currentShot = null;
    this._raceStartTime = null;
    this._timerInterval = null;
    this._listeners = [];
    this._countdownInterval = null;

    // 发令序列参数
    this._config = {
      onYourMarksDelay: 1800,
      setDelay: 1200,
      volume: 1.0,
      autoFire: true,
    };

    // 统计
    this._stats = {
      shotsFired: 0,
      recalls: 0,
      avgReactionTime: 0,
    };
  }

  // ── 事件监听 ──────────────────────────────────────────────────────────────
  on(callback) {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter(cb => cb !== callback);
    };
  }

  _emit(event, data) {
    this._listeners.forEach(cb => cb(event, data));
  }

  // ── 初始化 ────────────────────────────────────────────────────────────────
  async init(options = {}) {
    console.log('[StarterV3] 初始化发令端...');

    // 初始化音频
    await this._audio.init();

    // 初始化时钟同步
    await this._clockSync.syncOnce();
    this._clockSync.startAutoSync(30000); // 每 30 秒同步一次

    // 应用配置
    if (options.volume !== undefined) {
      this._config.volume = options.volume;
      this._audio.setVolume(options.volume);
    }

    Object.assign(this._config, options);

    console.log('[StarterV3] 初始化完成');
    console.log('[StarterV3] 时钟同步状态:', this._clockSync.getStatus());

    return this;
  }

  // ── 状态查询 ──────────────────────────────────────────────────────────────
  getState() {
    return this._state;
  }

  getCurrentShot() {
    return this._currentShot;
  }

  getStats() {
    return { ...this._stats };
  }

  // ── 步骤 1: 进入"各就位" ─────────────────────────────────────────────────
  async doOnYourMarks() {
    if (this._state !== RaceState.IDLE && this._state !== RaceState.READY) {
      throw new Error(`当前状态 ${this._state} 不能进入"各就位"`);
    }

    console.log('[StarterV3] 📢 各就位 (On Your Marks)');

    // 播放"各就位"音频
    await this._audio.playOnYourMarks();

    // 更新状态
    this._state = RaceState.ON_YOUR_MARKS;
    this._emit('stateChanged', { state: this._state });

    // 同步状态到服务器
    if (this._currentShot) {
      await shotManager.transition(this._currentShot.id, RaceState.ON_YOUR_MARKS);
    }

    return this;
  }

  // ── 步骤 2: 进入"预备" ───────────────────────────────────────────────────
  async doSet() {
    if (this._state !== RaceState.ON_YOUR_MARKS) {
      throw new Error(`当前状态 ${this._state} 不能进入"预备"`);
    }

    console.log('[StarterV3] 📢 预备 (Set)');

    // 等待各就位完成
    await this._delay(this._config.onYourMarksDelay);

    // 播放"预备"音频
    await this._audio.playSet();

    // 更新状态
    this._state = RaceState.SET;
    this._emit('stateChanged', { state: this._state });

    // 同步状态到服务器
    if (this._currentShot) {
      await shotManager.transition(this._currentShot.id, RaceState.SET);
    }

    return this;
  }

  // ── 步骤 3: 发令枪响 ──────────────────────────────────────────────────────
  async doFire() {
    if (this._state !== RaceState.SET) {
      throw new Error(`当前状态 ${this._state} 不能发令`);
    }

    console.log('[StarterV3] 🔫 发令枪响！');

    // 记录精确的枪响时间
    const gunTime = performance.now();

    // 播放枪声
    await this._audio.playGunshot();

    // 更新状态
    this._state = RaceState.RUNNING;
    this._raceStartTime = gunTime;
    this._stats.shotsFired++;

    // 通知终点端
    this._emit('gunFired', {
      gunTime,
      raceStartTime: gunTime,
    });

    // 同步状态到服务器
    if (this._currentShot) {
      await shotManager.transition(this._currentShot.id, RaceState.RUNNING, {
        actualStartAt: gunTime,
      });
    }

    return { gunTime };
  }

  // ── 步骤 4: 召回重跑 ──────────────────────────────────────────────────────
  async doRecall() {
    if (this._state !== RaceState.RUNNING) {
      throw new Error(`当前状态 ${this._state} 不能召回`);
    }

    console.log('[StarterV3] ⚠️ 召回重跑！');

    // 播放召回哨声
    await this._audio.playRecall();

    // 停止计时器
    this._stopTimer();

    // 记录召回
    this._stats.recalls++;

    // 更新状态
    this._state = RaceState.ABORTED;
    this._raceStartTime = null;

    // 通知终点端
    this._emit('recalled', {});

    // 同步状态到服务器
    if (this._currentShot) {
      await shotManager.abortShot(this._currentShot.id, 'Recall');
    }

    return this;
  }

  // ── 执行完整发令序列 ──────────────────────────────────────────────────────
  async executeFullSequence() {
    if (this._state !== RaceState.IDLE && this._state !== RaceState.READY) {
      throw new Error('当前状态不能开始发令序列');
    }

    try {
      // 1. 各就位
      await this.doOnYourMarks();

      // 2. 等待后预备
      await this._delay(this._config.onYourMarksDelay);
      await this.doSet();

      // 3. 等待后发令
      if (this._config.autoFire) {
        await this._delay(this._config.setDelay);
        const { gunTime } = await this.doFire();
        return { gunTime };
      } else {
        // 等待手动触发
        return { gunTime: null, readyForManualFire: true };
      }

    } catch (error) {
      console.error('[StarterV3] 发令序列执行失败:', error);
      this._emit('error', { error });
      throw error;
    }
  }

  // ── 手动触发发令（在预备后）─────────────────────────────────────────────
  async fireNow() {
    return this.doFire();
  }

  // ── 创建新枪次 ───────────────────────────────────────────────────────────
  async createShot(params) {
    try {
      const shot = await shotManager.createShot({
        eventName: params.eventName || '100米',
        round: params.round || 1,
        group: params.group || 1,
        laneCount: params.laneCount || 8,
      });

      this._currentShot = shot;
      this._state = RaceState.READY;
      this._emit('shotCreated', { shot });

      return shot;
    } catch (error) {
      console.error('[StarterV3] 创建枪次失败:', error);
      throw error;
    }
  }

  // ── 重置 ─────────────────────────────────────────────────────────────────
  reset() {
    this._stopTimer();
    this._state = RaceState.IDLE;
    this._raceStartTime = null;
    this._currentShot = null;
    this._emit('reset', {});
  }

  // ── 获取比赛用时 ─────────────────────────────────────────────────────────
  getRaceTime() {
    if (!this._raceStartTime) return 0;
    return this._clockSync.now() - this._raceStartTime;
  }

  // ── 获取格式化比赛时间 ────────────────────────────────────────────────────
  getFormattedRaceTime() {
    return formatRaceTime(this.getRaceTime());
  }

  // ── 启动计时器 ────────────────────────────────────────────────────────────
  _startTimer() {
    this._stopTimer();

    this._timerInterval = setInterval(() => {
      const raceTime = this.getRaceTime();
      this._emit('tick', {
        raceTime,
        formatted: formatRaceTime(raceTime),
      });
    }, 10); // 10ms 更新间隔
  }

  _stopTimer() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }

  // ── 获取同步后的时间 ──────────────────────────────────────────────────────
  getSyncedTime() {
    return this._clockSync.now();
  }

  getClockSyncStatus() {
    return this._clockSync.getStatus();
  }

  // ── 配置 ─────────────────────────────────────────────────────────────────
  setConfig(config) {
    Object.assign(this._config, config);
    if (config.volume !== undefined) {
      this._audio.setVolume(config.volume);
    }
  }

  // ── 延迟 ─────────────────────────────────────────────────────────────────
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ── 终点端控制器 ──────────────────────────────────────────────────────────────
export class FinishController {
  constructor() {
    this._detector = new FinishLineDetectorV3();
    this._audio = startAudio;
    this._clockSync = clockSync;

    this._video = null;
    this._displayCanvas = null;
    this._running = false;
    this._raceStartTime = null;
    this._detections = [];
    this._listeners = [];
    this._pendingLaneUpdates = [];

    // 配置
    this._config = {
      laneCount: 8,
      threshold: 12,
      blockDuration: 3000,
      cooldownMs: 1500,
      cameraDelay: 0,
    };
  }

  // ── 事件监听 ──────────────────────────────────────────────────────────────
  on(callback) {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter(cb => cb !== callback);
    };
  }

  _emit(event, data) {
    this._listeners.forEach(cb => cb(event, data));
  }

  // ── 初始化 ────────────────────────────────────────────────────────────────
  init(videoEl, displayCanvas, options = {}) {
    this._video = videoEl;
    this._displayCanvas = displayCanvas;

    // 应用配置
    Object.assign(this._config, options);

    // 初始化检测器
    this._detector.init(videoEl, displayCanvas, this._config.laneCount);
    this._detector.threshold = this._config.threshold;
    this._detector.cooldownMs = this._config.cooldownMs;
    this._detector.setCalibrationResult(this._config.cameraDelay);

    // 设置回调
    this._detector.onCrossing = this._handleCrossing.bind(this);
    this._detector.onLevel = this._handleLevel.bind(this);
    this._detector.onCloseFinish = this._handleCloseFinish.bind(this);

    // 绑定拖拽
    this._detector.bindDrag?.(displayCanvas);

    return this;
  }

  // ── 开始检测 ────────────────────────────────────────────────────────────────
  start() {
    if (this._running) return;

    this._running = true;
    this._detections = [];
    this._detector.reset();
    this._detector.start(
      this._handleCrossing.bind(this),
      this._handleLevel.bind(this)
    );

    console.log('[FinishV3] 终点检测已启动');
    this._emit('started', {});
  }

  // ── 停止检测 ────────────────────────────────────────────────────────────────
  stop() {
    this._running = false;
    this._detector.stop();
    console.log('[FinishV3] 终点检测已停止');
    this._emit('stopped', { detections: this._detections });
  }

  // ── 发令枪响：解除屏蔽 ──────────────────────────────────────────────────────
  onGunFire(gunTime) {
    console.log('[FinishV3] 收到发令信号，解除终点检测屏蔽');

    // 使用同步后的时间
    this._raceStartTime = gunTime || this._clockSync.now();

    // 通知检测器
    this._detector.onStartSignal();

    // 播放确认音
    this._audio.playBeep(50, 1200);

    // 开始录像（如果有）
    this._emit('raceStarted', { startTime: this._raceStartTime });
  }

  // ── 召回：重新屏蔽 ──────────────────────────────────────────────────────────
  onRecall() {
    console.log('[FinishV3] 收到召回信号');

    this._raceStartTime = null;
    this._detector.stop();

    // 重置检测器
    this._detector.reset();
    this._detector.start(
      this._handleCrossing.bind(this),
      this._handleLevel.bind(this)
    );

    // 播放召回音
    this._audio.playRecall();

    this._emit('recalled', {});
  }

  // ── 处理冲线 ────────────────────────────────────────────────────────────────
  _handleCrossing(laneIdx, finishTime) {
    // 计算实际成绩（相对于发令枪响）
    const raceTime = finishTime - this._raceStartTime;

    console.log(`[FinishV3] 🏁 道次 ${laneIdx + 1} 冲线！成绩: ${formatRaceTime(raceTime)}`);

    const detection = {
      lane: laneIdx,
      rawFinishTime: finishTime,
      raceTime: raceTime,
      timestamp: Date.now(),
    };

    this._detections.push(detection);

    // 播放确认音
    this._audio.playBeep(100, 1000);

    // 标记该道次已完成
    this._detector.setLaneDone(laneIdx, formatRaceTime(raceTime));

    // 通知
    this._emit('crossing', detection);
  }

  // ── 处理运动等级 ──────────────────────────────────────────────────────────────
  _handleLevel(level, blobs) {
    this._emit('level', { level, blobs });
  }

  // ── 处理接近冲线 ──────────────────────────────────────────────────────────────
  _handleCloseFinish(lane1, lane2, diffMs) {
    console.log(`[FinishV3] ⚠️ 接近冲线！道次 ${lane1 + 1} 和 ${lane2 + 1} 差距 ${diffMs}ms`);

    // 播放警告音
    this._audio.playBeep(200, 600);

    this._emit('closeFinish', { lane1, lane2, diffMs });
  }

  // ── 获取检测结果 ──────────────────────────────────────────────────────────────
  getDetections() {
    return [...this._detections].sort((a, b) => a.raceTime - b.raceTime);
  }

  // ── 配置 ──────────────────────────────────────────────────────────────────────
  setLaneCount(count) {
    this._config.laneCount = count;
    this._detector._laneCount = count;
  }

  setThreshold(threshold) {
    this._config.threshold = threshold;
    this._detector.threshold = threshold;
  }

  setCalibration(cameraDelayMs) {
    this._config.cameraDelay = cameraDelayMs;
    this._detector.setCalibrationResult(cameraDelayMs);
  }

  // ── 获取调试信息 ──────────────────────────────────────────────────────────────
  getDebugInfo() {
    return this._detector.getDebugInfo?.() || {};
  }

  // ── 重置 ──────────────────────────────────────────────────────────────────────
  reset() {
    this._detector.reset();
    this._detections = [];
    this._raceStartTime = null;
    this._emit('reset', {});
  }
}

// ── 导出单例 ────────────────────────────────────────────────────────────────
export const starterController = new StarterController();
export const finishController = new FinishController();

// ── 导出工厂函数 ───────────────────────────────────────────────────────────
export function createStarterController() {
  return new StarterController();
}

export function createFinishController() {
  return new FinishController();
}
