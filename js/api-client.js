/**
 * API 客户端 - 竞迹计时器
 * 支持重试、断线重连、离线队列
 */

import { addPendingSync, getPendingSyncCount } from './idb.js';

const DEFAULT_CONFIG = {
  baseURL: '',
  timeout: 10000,
  retries: 3,
  retryDelay: 1000,
  offlineQueue: true
};

// Client-side wrapper for the JingJi REST API
const BASE = '';

/**
 * 内部请求方法
 */
async function _req(method, path, body, config = {}) {
  const { retries = 3, timeout = 10000 } = config;
  let lastError;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      opts.signal = controller.signal;

      const r = await fetch(BASE + path, opts);
      clearTimeout(timeoutId);

      if (!r.ok) {
        const error = new Error(`HTTP ${r.status}`);
        error.status = r.status;
        throw error;
      }

      return await r.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) {
        await sleep(DEFAULT_CONFIG.retryDelay * Math.pow(2, attempt));
      }
    }
  }

  // 所有重试失败，尝试离线队列
  if (config.offlineQueue && method !== 'GET') {
    await addPendingSync({ type: 'api', method, path, body, timestamp: Date.now() });
  }

  return null;
}

/**
 * 睡眠函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 离线队列处理
let offlineQueue = [];
let isProcessingQueue = false;

/**
 * 处理离线队列
 */
async function processOfflineQueue() {
  if (isProcessingQueue || !navigator.onLine) return;
  isProcessingQueue = true;

  while (offlineQueue.length > 0) {
    const request = offlineQueue.shift();
    try {
      await _req(request.method, request.path, request.body, { retries: 1 });
      console.log('[API] Synced offline request:', request.path);
    } catch (e) {
      // 重新加入队列
      offlineQueue.push(request);
      break;
    }
  }

  isProcessingQueue = false;
}

// 监听网络状态
window.addEventListener('online', () => {
  console.log('[API] Back online, processing queue');
  processOfflineQueue();
});

/**
 * 带离线支持的请求
 */
async function offlineReq(method, path, body) {
  if (!navigator.onLine) {
    offlineQueue.push({ method, path, body });
    await addPendingSync({ type: 'api', method, path, body, timestamp: Date.now() });
    console.log('[API] Offline, queued request:', path);
    return { queued: true };
  }

  const result = await _req(method, path, body);
  if (result === null && !navigator.onLine) {
    offlineQueue.push({ method, path, body });
    await addPendingSync({ type: 'api', method, path, body, timestamp: Date.now() });
    return { queued: true };
  }

  return result;
}

// 导出 API 客户端
export const ApiClient = {
  // 网络状态
  isOnline: () => navigator.onLine,

  // 待处理队列数量
  getQueueCount: async () => {
    const dbCount = await getPendingSyncCount();
    return dbCount + offlineQueue.length;
  },

  // 处理离线队列
  processQueue: processOfflineQueue,

  // Meets
  getMeets: () => offlineReq('GET', '/api/meets'),
  createMeet: (body) => offlineReq('POST', '/api/meets', body),

  // Events
  getEvents: (meetId) => offlineReq('GET', meetId ? `/api/events?meetId=${meetId}` : '/api/events'),
  createEvent: (body) => offlineReq('POST', '/api/events', body),
  getEvent: (id) => offlineReq('GET', `/api/events/${id}`),

  // Athletes
  getAthletes: (q) => offlineReq('GET', q ? `/api/athletes?q=${encodeURIComponent(q)}` : '/api/athletes'),

  // Results — primary integration point from timer
  saveResult: (body) => offlineReq('POST', '/api/results', body),
  updateResult: (id, body) => offlineReq('PUT', `/api/results/${id}`, body),

  // Rank a group after race
  rankGroup: (eventId, round, group) =>
    offlineReq('POST', '/api/rank', { eventId, round, group }),
};

/**
 * WebSocket 客户端 - 稳定版
 */
export class StableWebSocket {
  constructor(url, options = {}) {
    this.url = url;
    this.options = {
      reconnectInterval: 1000,
      maxReconnectInterval: 30000,
      reconnectDecay: 1.5,
      maxReconnectAttempts: 10,
      heartbeatInterval: 30000,
      ...options
    };

    this.ws = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.listeners = new Map();
    this.isManualClose = false;
    this.isConnected = false;
  }

  /**
   * 连接
   */
  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[WS] Connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emit('open');
        this.startHeartbeat();
      };

      this.ws.onclose = (event) => {
        console.log('[WS] Closed:', event.code, event.reason);
        this.isConnected = false;
        this.stopHeartbeat();
        this.emit('close', event);

        if (!this.isManualClose) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error);
        this.emit('error', error);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'pong') return; // 心跳响应
          this.emit('message', data);
          this.handleMessage(data);
        } catch (e) {
          console.error('[WS] Failed to parse message:', e);
        }
      };
    } catch (error) {
      console.error('[WS] Connection failed:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * 发送消息
   */
  send(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.ws.send(JSON.stringify(data));
    return true;
  }

  /**
   * 关闭连接
   */
  close() {
    this.isManualClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Manual close');
    }
  }

  /**
   * 调度重连
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.log('[WS] Max reconnect attempts reached');
      this.emit('max_attempts_reached');
      return;
    }

    const delay = Math.min(
      this.options.reconnectInterval * Math.pow(this.options.reconnectDecay, this.reconnectAttempts),
      this.options.maxReconnectInterval
    );

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  /**
   * 开始心跳
   */
  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        this.send({ type: 'ping', timestamp: Date.now() });
      }
    }, this.options.heartbeatInterval);
  }

  /**
   * 停止心跳
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 处理消息
   */
  handleMessage(data) {
    this.emit(data.type, data);
  }

  /**
   * 添加事件监听
   */
  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);
  }

  /**
   * 移除事件监听
   */
  off(event, listener) {
    if (!this.listeners.has(event)) return;
    const listeners = this.listeners.get(event);
    const index = listeners.indexOf(listener);
    if (index > -1) listeners.splice(index, 1);
  }

  /**
   * 触发事件
   */
  emit(event, ...args) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event).forEach(listener => listener(...args));
  }
}

// 导出默认实例
export default ApiClient;
