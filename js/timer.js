/**
 * PrecisionTimer - 高精度计时器 V2.0
 *
 * 优化：
 * 1. 使用 requestAnimationFrame 实现高精度计时
 * 2. 增加服务器时间同步支持
 * 3. 支持多设备时间校准
 * 4. 提升响应速度
 */

export class PrecisionTimer {
  constructor() {
    this._startTime = 0;
    this._pausedAt = 0;
    this._running = false;
    this._rafId = null;
    this._listeners = new Set();
    this._lastTick = 0;
    this._offset = 0; // 服务器时间偏移
  }

  // 设置服务器时间偏移（用于多设备同步）
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

  start() {
    if (this._running) return;
    this._startTime = performance.now();
    this._running = true;
    this._lastTick = this._startTime;
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
    this._emit();
  }

  lap() {
    return this.elapsed;
  }

  // 获取当前时间（带偏移）
  now() {
    return this.elapsed;
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _tick() {
    if (!this._running) return;

    const now = performance.now();
    const elapsed = now - this._startTime;

    // 使用 RAF，但限制更新频率以减少性能消耗
    // 对于短距离比赛，前200ms每帧更新，之后每50ms更新一次
    const tickInterval = elapsed < 200 ? 16 : 50;

    if (now - this._lastTick >= tickInterval) {
      this._lastTick = now;
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

  // 格式化时间：MM:SS.cs（分:秒.百分秒）
  static format(ms) {
    const t = Math.max(0, Math.round(ms));
    const mi = Math.floor(t / 60000);
    const se = Math.floor((t % 60000) / 1000);
    const cs = Math.floor((t % 1000) / 10);
    return `${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  // 格式化时间：MM:SS.mmm（分:秒.毫秒）
  static formatFull(ms) {
    const t = Math.max(0, Math.round(ms));
    const mi = Math.floor(t / 60000);
    const se = Math.floor((t % 60000) / 1000);
    const ms2 = t % 1000;
    return `${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}.${String(ms2).padStart(3, '0')}`;
  }

  // 格式化时间：用于外接显示屏（不显示前导零）
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

  // 格式化时间：简洁格式 SS.ss
  static formatSimple(ms) {
    const t = Math.max(0, Math.round(ms));
    const se = Math.floor(t / 1000);
    const cs = Math.floor((t % 1000) / 10);
    return `${String(se).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }
}