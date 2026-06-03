// Cross-device synchronization via WebSocket (with auto-reconnect)
export class Sync {
  constructor() {
    this.room              = null;
    this.role              = null;
    this.clientId          = null;
    this._offset           = 0;   // performance.now() + offset ≈ server Date.now()
    this._ws               = null;
    this._cbs              = new Map();
    this.connected         = false;
    this.peerOnline        = false;
    this.peers             = [];
    this._autoReconnect    = true;
    this._reconnectCount   = 0;
    this.rtt               = null;  // median one-way latency in ms (set after calibrate)
    this.accuracy          = null;  // clock sync accuracy (std deviation in ms)
    this._messageQueue     = [];    // 消息队列，用于连接断开时缓存
    this._nextSeq          = 0;     // 消息序列号
    this._heartbeatTimer   = null;  // 心跳定时器
    this._lastPongTime     = 0;     // 最后一次收到pong的时间
  }

  get finishPeerCount() {
    return this.peers.filter(p => p.role === 'finish').length;
  }
  get observerCount() {
    return this.peers.filter(p => p.role === 'observer').length;
  }

  // Calibrate local clock against server (NTP-lite with outlier rejection)
  async calibrate(attempts = 7) {
    const measurements = [];

    for (let i = 0; i < attempts; i++) {
      try {
        const t1 = performance.now();
        const pingUrl = this._serverHost
          ? `https://${this._serverHost}/ping`
          : '/ping';
        const r = await fetch(pingUrl, {
          cache: 'no-store',
          priority: 'high'  // 优先级高，减少浏览器排队
        });
        const t4 = performance.now();

        if (!r.ok) break;
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('json')) break;
        const { serverTime } = await r.json();
        if (!serverTime) break;

        const rtt = t4 - t1;
        const offset = serverTime - (t1 + rtt / 2);

        measurements.push({ offset, rtt, t1, t4, serverTime });

        if (i < attempts - 1) await new Promise(r => setTimeout(r, 30));
      } catch { break; }
    }

    if (measurements.length > 0) {
      // 剔除RTT异常值（使用IQR方法）
      const rtts = measurements.map(m => m.rtt).sort((a, b) => a - b);
      const q1 = rtts[Math.floor(rtts.length * 0.25)];
      const q3 = rtts[Math.floor(rtts.length * 0.75)];
      const iqr = q3 - q1;
      const maxRtt = q3 + 1.5 * iqr;

      // 只保留RTT正常的测量
      const filtered = measurements.filter(m => m.rtt <= maxRtt);

      if (filtered.length > 0) {
        // 使用中位数作为最终结果（更稳定）
        const offsets = filtered.map(m => m.offset).sort((a, b) => a - b);
        const validRtts = filtered.map(m => m.rtt).sort((a, b) => a - b);

        this._offset = offsets[Math.floor(offsets.length / 2)];
        this.rtt = Math.round(validRtts[Math.floor(validRtts.length / 2)] / 2);

        // 计算精度（标准差）
        const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
        const variance = offsets.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / offsets.length;
        this.accuracy = Math.sqrt(variance);
      }
    }
  }

  // Server-synchronized "now" in ms (comparable across devices)
  serverNow() { return performance.now() + this._offset; }

  // Join a room via WebSocket (initial connection)
  // serverHost: optional override, e.g. 'jingjitimer.onrender.com'
  async join(room, role, serverHost) {
    this.room            = room;
    this.role            = role;
    this._serverHost     = serverHost || null;
    this._autoReconnect  = true;
    this._reconnectCount = 0;
    await this.calibrate();
    return this._connect(true);
  }

  // Internal: create/replace the WebSocket
  _connect(firstTime) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, v) => { if (!settled) { settled = true; fn(v); } };

      const host  = this._serverHost || location.host;
      const proto = (this._serverHost || location.protocol === 'https:') ? 'wss:' : 'ws:';
      const url   = `${proto}//${host}/ws?room=${encodeURIComponent(this.room)}&role=${encodeURIComponent(this.role)}`;
      this._ws    = new WebSocket(url);

      this._ws.onmessage = e => {
        try {
          const event = JSON.parse(e.data);

          if (event.type === 'JOINED') {
            this.clientId        = event.clientId;
            this.connected       = true;
            this._reconnectCount = 0;
            this.peers           = (event.peers || []).map(r => ({ role: r, clientId: null }));
            this.peerOnline      = this.peers.length > 0;
            this._lastPongTime   = Date.now();

            // 刷新队列中的消息
            this._flushMessageQueue();

            // 启动心跳检测
            this._startHeartbeat();

            if (firstTime) {
              settle(resolve, event);
            } else {
              // Reconnected — fire RECONNECTED callbacks
              (this._cbs.get('RECONNECTED') || []).forEach(cb => cb(event));
            }
          }

          if (event.type === 'PONG') {
            this._lastPongTime = Date.now();
          }

          if (event.type === 'PEER_JOINED') {
            this.peers.push({ role: event.role, clientId: event.clientId });
            this.peerOnline = true;
          }
          if (event.type === 'PEER_LEFT') {
            this.peers      = this.peers.filter(p => p.clientId !== event.clientId);
            this.peerOnline = this.peers.length > 0;
          }

          const cbs = this._cbs.get(event.type) || [];
          cbs.forEach(cb => cb(event));
          const all = this._cbs.get('*') || [];
          all.forEach(cb => cb(event));
        } catch {}
      };

      this._ws.onerror = () => {
        if (firstTime) settle(reject, new Error('WebSocket connection failed'));
      };

      this._ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected  = false;
        this.peerOnline = false;

        if (firstTime && !wasConnected) {
          settle(reject, new Error('Connection closed before joining'));
          return;
        }

        // Fire DISCONNECTED callbacks so UI can show reconnect indicator
        (this._cbs.get('DISCONNECTED') || []).forEach(cb => cb({}));

        // Auto-reconnect with exponential backoff (max 20s)
        if (this._autoReconnect && this.room) {
          const delay = Math.min(1200 * (1.6 ** this._reconnectCount), 20000);
          this._reconnectCount++;
          setTimeout(() => this._reconnect(), delay);
        }
      };

      if (firstTime) {
        setTimeout(() => settle(reject, new Error('Connection timeout')), 8000);
      }
    });
  }

  async _reconnect() {
    try {
      await this.calibrate(2);
      this._connect(false); // fire-and-forget; reconnect loop handled via onclose
    } catch { /* onclose will retry */ }
  }

  // Send event to all peers in room via WebSocket (with message queue)
  send(type, data = {}) {
    const event = {
      type,
      ...data,
      _serverTime: this.serverNow(),
      _role: this.role,
      _clientId: this.clientId,
      _seq: this._nextSeq++  // 消息序列号，用于检测丢包
    };

    // 如果连接未打开，加入队列
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      this._messageQueue.push(event);
      return false;
    }

    try {
      this._ws.send(JSON.stringify(event));
      return true;
    } catch (e) {
      console.warn('[Sync] Send failed:', e);
      this._messageQueue.push(event);
      return false;
    }
  }

  // 批量发送队列中的消息
  _flushMessageQueue() {
    if (this._messageQueue.length === 0) return;

    const toSend = this._messageQueue.splice(0, 50); // 一次最多发50条
    toSend.forEach(event => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        try {
          this._ws.send(JSON.stringify(event));
        } catch (e) {
          console.warn('[Sync] Flush failed:', e);
        }
      }
    });
  }

  on(type, cb) {
    if (!this._cbs.has(type)) this._cbs.set(type, []);
    this._cbs.get(type).push(cb);
  }

  // 启动心跳检测
  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        // 发送PING
        this.send('PING', { timestamp: Date.now() });

        // 检测是否超时（10秒内没收到PONG）
        const now = Date.now();
        if (now - this._lastPongTime > 10000) {
          console.warn('[Sync] Heartbeat timeout, reconnecting...');
          this._ws.close();
        }
      }
    }, 5000); // 每5秒一次心跳
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  disconnect() {
    this._autoReconnect = false;
    this._stopHeartbeat();
    this._ws?.close();
    this._ws       = null;
    this.connected = false;
    this.peers     = [];
    this._messageQueue = [];
  }

  // 获取当前连接状态信息（用于调试）
  getStats() {
    return {
      connected: this.connected,
      rtt: this.rtt,
      accuracy: this.accuracy,
      offset: this._offset,
      peers: this.peers.length,
      queueSize: this._messageQueue.length,
      reconnectCount: this._reconnectCount
    };
  }
}

// Generate a random 4-digit room code (used as default suggestion)
export function generateRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}
