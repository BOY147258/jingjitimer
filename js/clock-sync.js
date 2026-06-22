// 竞迹计时系统 - 时钟同步模块 V2.0
// 确保多设备时间精确同步，达到专业计时器精度

/**
 * 时钟同步原理（NTP 风格）：
 *
 *     T1 (client send)                    T2 (server receive)
 *        │                                   │
 *        └─────────── Request ────────────────┘
 *                                             │
 *                                             │ Process...
 *                                             │
 *        ┌───────────── Response ─────────────┘
 *        │ T4 (client receive)    T3 (server send)
 *        │
 *        │
 *   Client Time = T1 + (T2 - T1 + T4 - T3) / 2
 *   Round Trip = (T4 - T1) - (T3 - T2)
 *   Offset = ((T2 - T1) + (T3 - T4)) / 2
 */

export class ClockSynchronizer {
  constructor() {
    this._serverUrl = '/api';
    this._offset = 0;           // 时钟偏移量
    this._roundTrip = 0;        // 往返延迟
    this._samples = [];          // 同步样本
    this._maxSamples = 5;        // 最大样本数
    this._syncInterval = null;
    this._listeners = [];
    this._syncing = false;

    // 统计
    this._stats = {
      totalSyncs: 0,
      failedSyncs: 0,
      avgOffset: 0,
      avgRoundTrip: 0,
    };
  }

  /**
   * 添加状态监听器
   */
  on(callback) {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter(cb => cb !== callback);
    };
  }

  _emit(event, data) {
    this._listeners.forEach(cb => cb(event, data));
  }

  /**
   * 执行单次同步
   * @returns {Promise<{offset: number, roundTrip: number, success: boolean}>}
   */
  async syncOnce() {
    if (this._syncing) {
      return { offset: this._offset, roundTrip: this._roundTrip, success: false };
    }

    this._syncing = true;

    try {
      // 发送同步请求
      const t0 = performance.now();

      const response = await fetch(`${this._serverUrl}/ping`, {
        method: 'GET',
        headers: { 'X-Client-Time': t0.toFixed(0) },
      });

      const t4 = performance.now();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const t1 = parseFloat(data.clientTime) || t0;  // 服务器收到的客户端时间
      const t2 = data.serverTime;                    // 服务器时间（发送时）
      const t3 = data.serverTime2 || t2;             // 服务器时间（如果需要更精确）

      // 计算偏移和往返延迟
      // 偏移 = ((T2 - T1) + (T3 - T4)) / 2
      // 往返 = (T4 - T1) - (T3 - T2)

      const offset = ((t2 - t1) + (t4 - t3)) / 2;
      const roundTrip = (t4 - t1) - (t3 - t2);

      // 过滤异常值
      if (Math.abs(offset) < 1000 && roundTrip < 5000) {
        this._samples.push({ offset, roundTrip, timestamp: Date.now() });

        // 保持样本数量
        if (this._samples.length > this._maxSamples) {
          this._samples.shift();
        }

        // 计算平均偏移（使用加权平均，最近的权重更高）
        this._recalculateOffset();
      }

      this._stats.totalSyncs++;
      this._stats.avgOffset = this._offset;
      this._stats.avgRoundTrip = this._roundTrip;

      this._emit('sync', {
        offset: this._offset,
        roundTrip: this._roundTrip,
        samples: this._samples.length,
      });

      return {
        offset: this._offset,
        roundTrip: this._roundTrip,
        success: true,
        precision: this._roundTrip / 2, // 单向精度估算
      };

    } catch (error) {
      this._stats.failedSyncs++;
      console.warn('[ClockSync] 同步失败:', error);
      return { offset: this._offset, roundTrip: this._roundTrip, success: false };

    } finally {
      this._syncing = false;
    }
  }

  /**
   * 重新计算偏移量（加权平均）
   */
  _recalculateOffset() {
    if (this._samples.length === 0) return;

    // 加权平均：最近的样本权重更高
    let totalWeight = 0;
    let weightedSum = 0;
    let rtSum = 0;

    this._samples.forEach((sample, index) => {
      // 权重 = 1 + index（越新的样本权重越高）
      const weight = index + 1;

      // 同时考虑往返延迟（延迟越低权重越高）
      const rtWeight = Math.max(1, 1000 / Math.max(sample.roundTrip, 10));

      const finalWeight = weight * rtWeight;

      weightedSum += sample.offset * finalWeight;
      rtSum += sample.roundTrip * finalWeight;
      totalWeight += finalWeight;
    });

    this._offset = weightedSum / totalWeight;
    this._roundTrip = rtSum / totalWeight;
  }

  /**
   * 启动定时同步
   * @param {number} interval 同步间隔（毫秒）
   */
  startAutoSync(interval = 30000) {
    this.stopAutoSync();

    // 立即同步一次
    this.syncOnce();

    // 定时同步
    this._syncInterval = setInterval(() => {
      this.syncOnce();
    }, interval);

    this._emit('started', { interval });
  }

  /**
   * 停止定时同步
   */
  stopAutoSync() {
    if (this._syncInterval) {
      clearInterval(this._syncInterval);
      this._syncInterval = null;
    }
  }

  /**
   * 获取当前同步时间
   * 这是最重要的方法，用于获取与服务器同步的本地时间
   */
  now() {
    return performance.now() + this._offset;
  }

  /**
   * 获取服务器时间（估算）
   */
  serverTime() {
    return Date.now() + this._offset;
  }

  /**
   * 获取相对时间（从同步点开始）
   */
  elapsed(startTime) {
    return this.now() - startTime;
  }

  /**
   * 获取同步状态
   */
  getStatus() {
    return {
      synced: this._samples.length > 0,
      offset: this._offset,
      roundTrip: this._roundTrip,
      samples: this._samples.length,
      precision: this._roundTrip / 2,
      ...this._stats,
    };
  }

  /**
   * 重置同步状态
   */
  reset() {
    this._samples = [];
    this._offset = 0;
    this._roundTrip = 0;
    this._emit('reset', {});
  }

  /**
   * 手动设置偏移量（用于调试或特殊场景）
   */
  setOffset(offset) {
    this._offset = offset;
    this._emit('manual', { offset });
  }

  /**
   * 获取时间戳（适合存储和比较）
   * 返回毫秒级时间戳
   */
  timestamp() {
    return Math.round(this.now());
  }

  /**
   * 格式化时间显示
   */
  formatTime(ms) {
    if (ms === null || ms === undefined) return '--:--.--';

    const totalMs = Math.abs(ms);
    const sign = ms < 0 ? '-' : '';
    const m = Math.floor(totalMs / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const c = Math.floor((totalMs % 1000) / 10);

    return `${sign}${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
  }

  /**
   * 格式化时间显示（专业格式：HH:MM:SS.mmm）
   */
  formatTimePrecise(ms) {
    if (ms === null || ms === undefined) return '--:--:--.---';

    const totalMs = Math.abs(ms);
    const sign = ms < 0 ? '-' : '';
    const h = Math.floor(totalMs / 3600000);
    const m = Math.floor((totalMs % 3600000) / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const ms3 = Math.floor(totalMs % 1000);

    return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms3).padStart(3, '0')}`;
  }
}

// ── 导出单例 ────────────────────────────────────────────────────────────────
export const clockSync = new ClockSynchronizer();

// ── 兼容性导出 ─────────────────────────────────────────────────────────────
export function getServerTime() {
  return clockSync.now();
}

export function getServerTimestamp() {
  return clockSync.timestamp();
}

export function formatRaceTime(ms) {
  return clockSync.formatTime(ms);
}
