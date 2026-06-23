/**
 * PrecisionTimer - 高精度计时器 V3.0
 *
 * 优化：
 * 1. 使用 requestAnimationFrame 实现高精度计时
 * 2. 增加服务器时间同步支持
 * 3. 支持多设备时间校准
 * 4. 智能降帧策略（根据设备性能）
 * 5. 低内存占用模式
 */

export class PrecisionTimer {
  constructor(options = {}) {
    this._startTime = 0;
    this._pausedAt = 0;
    this._running = false;
    this._rafId = null;
    this._listeners = new Set();
    this._lastTick = 0;
    this._offset = 0;
    // 性能自适应
    this._tickInterval = 16; // 默认16ms（约60fps）
    this._elapsedAtLastEmit = 0;
    // 低性能模式检测
    this._frameCount = 0;
    this._fpsStartTime = 0;
    this._currentFps = 60;
    this._lowPerformanceMode = false;
    // 内存优化
    this._lastEmittedSecond = -1;
  }

  setServerOffset(offset) {
    this._offset = offset;
  }

  get elapsed() {
    if (this._running) {
      const local = performance.now() - this._startTime;
      return Math.max(0, local + this._offset);
    }
    return Math.max(0, this._pausedAt + this._offset);
  }

  get running() { return this._running; }

  // 检测设备性能
  _detectPerformance() {
    const now = performance.now();
    if (this._fpsStartTime === 0) {
      this._fpsStartTime = now;
      this._frameCount = 0;
    }

    this._frameCount++;
    const elapsed = now - this._fpsStartTime;

    if (elapsed >= 1000) {
      this._currentFps = this._frameCount;
      this._frameCount = 0;
      this._fpsStartTime = now;

      // 根据FPS调整更新频率
      if (this._currentFps < 30) {
        this._tickInterval = 50; // 低性能模式：20fps更新
        this._lowPerformanceMode = true;
      } else if (this._currentFps < 50) {
        this._tickInterval = 33; // 中等性能：30fps更新
      } else {
        this._tickInterval = 16; // 高性能：60fps更新
      }
    }
  }

  start() {
    if (this._running) return;
    this._startTime = performance.now();
    this._running = true;
    this._lastTick = this._startTime;
    this._tickInterval = 16;
    this._fpsStartTime = 0;
    this._frameCount = 0;
    this._tick();
  }

  stop() {
    if (!this._running) return;
    this._pausedAt = this.elapsed;
    this._running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._emit();
  }

  reset() {
    this.stop();
    this._pausedAt = 0;
    this._startTime = 0;
    this._offset = 0;
    this._lastEmittedSecond = -1;
    this._emit();
  }

  lap() {
    return this.elapsed;
  }

  now() {
    return this.elapsed;
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  // 移除所有监听器（用于内存管理）
  removeAllListeners() {
    this._listeners.clear();
  }

  _tick() {
    if (!this._running) return;

    const now = performance.now();
    const elapsed = now - this._startTime;

    // 检测设备性能
    this._detectPerformance();

    // 智能更新：只在值变化时更新
    const currentSecond = Math.floor(elapsed / 1000);
    const currentCs = Math.floor(elapsed / 10);

    // 比赛前2秒（发令枪响应）或值有变化时更新
    const shouldUpdate = elapsed < 2000 ||
                        currentCs !== Math.floor(this._elapsedAtLastEmit / 10);

    if (shouldUpdate && now - this._lastTick >= this._tickInterval) {
      this._lastTick = now;
      this._elapsedAtLastEmit = elapsed;
      this._emit();
    }

    this._rafId = requestAnimationFrame(() => this._tick());
  }

  _emit() {
    const ms = this.elapsed;
    this._listeners.forEach(fn => {
      try {
        fn(ms);
      } catch (e) {
        console.error('Timer callback error:', e);
      }
    });
  }

  // 获取当前FPS（用于调试）
  getCurrentFps() {
    return this._currentFps;
  }

  // 是否为低性能模式
  isLowPerformanceMode() {
    return this._lowPerformanceMode;
  }

  // 格式化时间：MM:SS.cs
  static format(ms) {
    const t = Math.max(0, Math.round(ms));
    const mi = Math.floor(t / 60000);
    const se = Math.floor((t % 60000) / 1000);
    const cs = Math.floor((t % 1000) / 10);
    return `${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  // 格式化时间：MM:SS.mmm
  static formatFull(ms) {
    const t = Math.max(0, Math.round(ms));
    const mi = Math.floor(t / 60000);
    const se = Math.floor((t % 60000) / 1000);
    const ms2 = t % 1000;
    return `${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}.${String(ms2).padStart(3, '0')}`;
  }

  // 格式化时间：用于外接显示屏
  static formatDisplay(ms) {
    const t = Math.max(0, Math.round(ms));
    const mi = Math.floor(t / 60000);
    const se = Math.floor((t % 60000) / 1000);
    const ms2 = t % 1000;
    if (mi > 0) {
      return `${mi}:${String(se).padStart(2, '0')}.${String(ms2).padStart(3, '0')}`;
    }
    return `${se}.${String(ms2).padStart(3, '0')}`;
  }

  // 格式化时间：简洁格式
  static formatSimple(ms) {
    const t = Math.max(0, Math.round(ms));
    const se = Math.floor(t / 1000);
    const cs = Math.floor((t % 1000) / 10);
    return `${String(se).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  // 格式化时间：比赛用格式（只显示到0.01秒）
  static formatRace(ms) {
    if (ms == null) return '00.00';
    const t = Math.max(0, Math.round(ms));
    const se = Math.floor(t / 1000);
    const cs = Math.floor((t % 1000) / 10);
    return `${String(se).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  // 解析时间字符串为毫秒
  static parse(str) {
    if (!str) return null;
    const parts = str.split(':');
    if (parts.length === 2) {
      const [se, cs] = parts[1].split('.');
      return (parseInt(parts[0]) * 60000) + (parseInt(se) * 1000) + (parseInt(cs) * 10);
    } else if (parts.length === 1) {
      const [se, cs] = parts[0].split('.');
      return (parseInt(se) * 1000) + (parseInt(cs) * 10);
    }
    return null;
  }
}