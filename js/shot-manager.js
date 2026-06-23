// 竞迹 AI 计时系统 — 枪次管理器（前端）
// 管理枪次状态、API 调用、WebSocket 同步

// ── 状态定义（与后端保持一致）────────────────────────────────────────────
export const RaceState = {
  IDLE: 'IDLE',
  READY: 'READY',
  ON_YOUR_MARKS: 'ON_YOUR_MARKS',
  SET: 'SET',
  SCHEDULED: 'SCHEDULED',
  RUNNING: 'RUNNING',
  REVIEW: 'REVIEW',
  PUBLISHED: 'PUBLISHED',
  ABORTED: 'ABORTED',
};

export const StateDisplayNames = {
  [RaceState.IDLE]: '空闲',
  [RaceState.READY]: '准备',
  [RaceState.ON_YOUR_MARKS]: '各就位',
  [RaceState.SET]: '预备',
  [RaceState.SCHEDULED]: '待发令',
  [RaceState.RUNNING]: '计时中',
  [RaceState.REVIEW]: '复核中',
  [RaceState.PUBLISHED]: '已发布',
  [RaceState.ABORTED]: '已召回',
};

// ── 枪次管理器 ──────────────────────────────────────────────────────────────
export class ShotManager {
  constructor(apiBaseUrl = '/api') {
    this.apiBaseUrl = apiBaseUrl;
    this.currentShot = null;
    this.listeners = [];
  }

  // ── 事件监听 ──────────────────────────────────────────────────────────────
  on(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  emit(event, data) {
    this.listeners.forEach(cb => {
      try {
        cb(event, data);
      } catch (e) {
        console.error('[ShotManager] Listener error:', e);
      }
    });
  }

  // ── API 调用 ──────────────────────────────────────────────────────────────
  async request(method, path, body = null) {
    const url = `${this.apiBaseUrl}${path}`;
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(url, options);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Request failed');
    }
    return res.json();
  }

  // ── 创建新枪次 ────────────────────────────────────────────────────────────
  async createShot(params) {
    const shot = await this.request('POST', '/shots', params);
    this.currentShot = shot;
    this.emit('shot:created', shot);
    return shot;
  }

  // ── 获取枪次列表 ──────────────────────────────────────────────────────────
  async getShots(filters = {}) {
    let query = '';
    if (filters.roomCode) query += `?roomCode=${filters.roomCode}`;
    if (filters.state) query += `${query ? '&' : '?'}state=${filters.state}`;
    return this.request('GET', `/shots${query}`);
  }

  // ── 获取单个枪次 ──────────────────────────────────────────────────────────
  async getShot(shotId) {
    const shot = await this.request('GET', `/shots/${shotId}`);
    this.currentShot = shot;
    return shot;
  }

  // ── 更新枪次 ──────────────────────────────────────────────────────────────
  async updateShot(shotId, updates) {
    const shot = await this.request('PUT', `/shots/${shotId}`, updates);
    if (this.currentShot?.id === shotId) {
      this.currentShot = shot;
    }
    this.emit('shot:updated', shot);
    return shot;
  }

  // ── 状态转换 ──────────────────────────────────────────────────────────────
  async transition(shotId, newState, data = {}) {
    const shot = await this.request('POST', '/shots/transition', {
      shotId,
      newState,
      data,
    });
    if (this.currentShot?.id === shotId) {
      this.currentShot = shot;
    }
    this.emit('shot:transitioned', { shot, oldState: this.currentShot?.state, newState });
    return shot;
  }

  // ── 终点计时 ──────────────────────────────────────────────────────────────
  async finishLanes(shotId, lanes) {
    const shot = await this.request('POST', `/shots/${shotId}/finish`, { lanes });
    if (this.currentShot?.id === shotId) {
      this.currentShot = shot;
    }
    this.emit('shot:finished', shot);
    return shot;
  }

  // ── 发布成绩 ──────────────────────────────────────────────────────────────
  async publishShot(shotId) {
    const shot = await this.request('POST', `/shots/${shotId}/publish`);
    if (this.currentShot?.id === shotId) {
      this.currentShot = shot;
    }
    this.emit('shot:published', shot);
    return shot;
  }

  // ── 召回重跑 ──────────────────────────────────────────────────────────────
  async abortShot(shotId, reason = '') {
    const shot = await this.request('POST', `/shots/${shotId}/abort`, { reason });
    if (this.currentShot?.id === shotId) {
      this.currentShot = shot;
    }
    this.emit('shot:aborted', { shot, reason });
    return shot;
  }

  // ── 删除枪次 ──────────────────────────────────────────────────────────────
  async deleteShot(shotId) {
    await this.request('DELETE', `/shots/${shotId}`);
    if (this.currentShot?.id === shotId) {
      this.currentShot = null;
    }
    this.emit('shot:deleted', shotId);
  }

  // ── WebSocket 同步 ────────────────────────────────────────────────────────
  handleWSMessage(msg) {
    if (!msg.type) return;

    switch (msg.type) {
      case 'SHOT_CREATED':
      case 'SHOT_UPDATED':
        if (msg.shot) {
          if (this.currentShot?.id === msg.shot.id) {
            this.currentShot = msg.shot;
          }
          this.emit('shot:synced', msg.shot);
        }
        break;

      case 'STATE_CHANGED':
        if (msg.shotId && msg.newState) {
          this.emit('shot:state_changed', { shotId: msg.shotId, newState: msg.newState });
        }
        break;

      case 'SHOT_ABORTED':
        if (msg.shotId) {
          this.emit('shot:aborted', { shotId: msg.shotId, reason: msg.reason });
        }
        break;
    }
  }
}

// ── 格式化时间显示 ──────────────────────────────────────────────────────────
export function formatTime(ms) {
  if (!ms && ms !== 0) return '--:--.--';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const c = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

// ── 获取状态颜色 ────────────────────────────────────────────────────────────
export function getStateColor(state) {
  const colors = {
    [RaceState.IDLE]: '#666',
    [RaceState.READY]: '#4a90e2',
    [RaceState.ON_YOUR_MARKS]: '#f39c12',
    [RaceState.SET]: '#e74c3c',
    [RaceState.SCHEDULED]: '#9b59b6',
    [RaceState.RUNNING]: '#27ae60',
    [RaceState.REVIEW]: '#f39c12',
    [RaceState.PUBLISHED]: '#2ecc71',
    [RaceState.ABORTED]: '#95a5a6',
  };
  return colors[state] || '#666';
}

// ── 导出单例 ────────────────────────────────────────────────────────────────
export const shotManager = new ShotManager();
