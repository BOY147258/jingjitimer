/**
 * 性能监控模块
 * 用于监控和优化应用性能
 */

/**
 * 性能指标收集器
 */
export class PerformanceMonitor {
  constructor() {
    this.metrics = {
      fps: [],
      memory: [],
      detection: [],
      network: [],
      render: []
    };
    this.lastFrameTime = performance.now();
    this.frameCount = 0;
    this.isMonitoring = false;
    this.rafId = null;
  }

  /**
   * 开始监控
   */
  start() {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    this.monitorFrame();
    this.monitorMemory();
    console.log('[Performance] Started monitoring');
  }

  /**
   * 停止监控
   */
  stop() {
    if (!this.isMonitoring) return;
    this.isMonitoring = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    console.log('[Performance] Stopped monitoring');
  }

  /**
   * 监控帧率
   */
  monitorFrame() {
    const now = performance.now();
    const delta = now - this.lastFrameTime;
    const fps = 1000 / delta;

    this.metrics.fps.push({
      value: fps,
      timestamp: now
    });

    // 只保留最近60个样本
    if (this.metrics.fps.length > 60) {
      this.metrics.fps.shift();
    }

    this.lastFrameTime = now;
    this.frameCount++;

    this.rafId = requestAnimationFrame(() => this.monitorFrame());
  }

  /**
   * 监控内存使用
   */
  monitorMemory() {
    if (performance.memory) {
      this.metrics.memory.push({
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        timestamp: performance.now()
      });

      if (this.metrics.memory.length > 60) {
        this.metrics.memory.shift();
      }
    }
  }

  /**
   * 记录检测时间
   */
  recordDetection(duration) {
    this.metrics.detection.push({
      value: duration,
      timestamp: performance.now()
    });
  }

  /**
   * 记录网络延迟
   */
  recordNetworkLatency(latency) {
    this.metrics.network.push({
      value: latency,
      timestamp: performance.now()
    });
  }

  /**
   * 记录渲染时间
   */
  recordRenderTime(duration) {
    this.metrics.render.push({
      value: duration,
      timestamp: performance.now()
    });
  }

  /**
   * 获取统计摘要
   */
  getStats() {
    const avgFPS = this.calculateAverage(this.metrics.fps);
    const minFPS = this.calculateMin(this.metrics.fps);
    const maxFPS = this.calculateMax(this.metrics.fps);

    let memoryInfo = null;
    if (this.metrics.memory.length > 0) {
      const latest = this.metrics.memory[this.metrics.memory.length - 1];
      memoryInfo = {
        used: this.formatBytes(latest.usedJSHeapSize),
        total: this.formatBytes(latest.totalJSHeapSize),
        limit: this.formatBytes(latest.jsHeapSizeLimit),
        percentage: ((latest.usedJSHeapSize / latest.jsHeapSizeLimit) * 100).toFixed(1)
      };
    }

    const avgLatency = this.calculateAverage(this.metrics.network);
    const avgDetection = this.calculateAverage(this.metrics.detection);
    const avgRender = this.calculateAverage(this.metrics.render);

    return {
      fps: {
        current: this.metrics.fps.length > 0
          ? this.metrics.fps[this.metrics.fps.length - 1].value.toFixed(1)
          : 0,
        average: avgFPS.toFixed(1),
        min: minFPS.toFixed(1),
        max: maxFPS.toFixed(1),
        samples: this.metrics.fps.length
      },
      memory: memoryInfo,
      latency: avgLatency > 0 ? avgLatency.toFixed(0) + 'ms' : 'N/A',
      detection: avgDetection > 0 ? avgDetection.toFixed(1) + 'ms' : 'N/A',
      render: avgRender > 0 ? avgRender.toFixed(1) + 'ms' : 'N/A',
      frameCount: this.frameCount
    };
  }

  /**
   * 输出性能报告
   */
  report() {
    const stats = this.getStats();
    console.group('[Performance Report]');
    console.log('FPS:', stats.fps);
    console.log('Memory:', stats.memory);
    console.log('Network Latency:', stats.latency);
    console.log('Detection Time:', stats.detection);
    console.log('Render Time:', stats.render);
    console.log('Total Frames:', stats.frameCount);
    console.groupEnd();
    return stats;
  }

  /**
   * 清除所有指标
   */
  reset() {
    this.metrics = {
      fps: [],
      memory: [],
      detection: [],
      network: [],
      render: []
    };
    this.frameCount = 0;
  }

  // 辅助方法
  calculateAverage(arr) {
    if (arr.length === 0) return 0;
    const sum = arr.reduce((acc, m) => acc + m.value, 0);
    return sum / arr.length;
  }

  calculateMin(arr) {
    if (arr.length === 0) return 0;
    return Math.min(...arr.map(m => m.value));
  }

  calculateMax(arr) {
    if (arr.length === 0) return 0;
    return Math.max(...arr.map(m => m.value));
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

/**
 * 网络状态监控
 */
export class NetworkMonitor {
  constructor() {
    this.listeners = [];
    this.status = navigator.onLine ? 'online' : 'offline';
    this.type = navigator.connection?.effectiveType || 'unknown';

    this.setupListeners();
  }

  setupListeners() {
    window.addEventListener('online', () => {
      this.status = 'online';
      this.type = navigator.connection?.effectiveType || 'unknown';
      this.notify({ status: 'online', type: this.type });
    });

    window.addEventListener('offline', () => {
      this.status = 'offline';
      this.notify({ status: 'offline' });
    });

    if (navigator.connection) {
      navigator.connection.addEventListener('change', () => {
        this.type = navigator.connection.effectiveType;
        this.notify({ type: this.type });
      });
    }
  }

  onChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  notify(data) {
    this.listeners.forEach(cb => cb(data));
  }

  getStatus() {
    return {
      online: navigator.onLine,
      type: this.type,
      downlink: navigator.connection?.downlink,
      rtt: navigator.connection?.rtt,
      saveData: navigator.connection?.saveData
    };
  }
}

/**
 * 长任务监控
 */
export class LongTaskMonitor {
  constructor(threshold = 50) {
    this.threshold = threshold;
    this.longTasks = [];
  }

  start() {
    if ('PerformanceObserver' in window) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > this.threshold) {
            this.longTasks.push({
              duration: entry.duration,
              startTime: entry.startTime,
              attribution: entry.attribution
            });
            console.warn('[LongTask]', entry.duration.toFixed(2) + 'ms', entry.attribution);

            // 只保留最近20个
            if (this.longTasks.length > 20) {
              this.longTasks.shift();
            }
          }
        }
      });

      observer.observe({ entryTypes: ['longtask'] });
      return observer;
    }
    return null;
  }

  getLongTasks() {
    return this.longTasks;
  }
}

// 全局性能监控实例
export const perfMonitor = new PerformanceMonitor();
export const networkMonitor = new NetworkMonitor();

// 自动启动（仅在生产环境）
if (import.meta.env?.PROD) {
  perfMonitor.start();
}
