// 竞迹 AI 计时系统 — 主控制器（简化版）
// 精准、简洁、快速反应

import { shotManager, RaceState, StateDisplayNames, formatTime } from './shot-manager.js';
import { AIFinishLineDetector } from './ai-detector.js';

// ── 全局状态 ────────────────────────────────────────────────────────────────
const state = {
  role: null,              // 'starter' | 'finish' | 'observer'
  roomCode: null,
  ws: null,
  currentShot: null,
  clockOffset: 0,          // 与服务器的时钟偏移（ms）
  aiDetector: null,
  startTimeLocal: null,    // 本地记录的起跑时间
};

// ── 初始化 ──────────────────────────────────────────────────────────────────
export async function init() {
  console.log('[App] 竞迹 AI 计时系统 v2.0');

  // 时钟同步
  await syncClock();

  // 监听状态变化
  shotManager.on(handleShotEvent);

  console.log('[App] 初始化完成');
}

// ── 时钟同步（NTP 风格）────────────────────────────────────────────────────
async function syncClock() {
  try {
    const t0 = Date.now();
    const res = await fetch('/ping');
    const t3 = Date.now();
    const data = await res.json();
    const t1 = data.serverTime; // 服务器发送时间
    const t2 = data.serverTime; // 服务器接收时间（简化，认为相同）

    // 计算时钟偏移
    state.clockOffset = ((t1 - t0) + (t2 - t3)) / 2;

    console.log(`[Clock] 同步完成，偏移: ${state.clockOffset.toFixed(1)}ms`);
  } catch (e) {
    console.warn('[Clock] 同步失败，使用本地时间', e);
  }
}

// ── 获取同步后的服务器时间 ──────────────────────────────────────────────────
function getServerTime() {
  return Date.now() + state.clockOffset;
}

// ── 连接 WebSocket ──────────────────────────────────────────────────────────
export function connectRoom(roomCode, role) {
  state.roomCode = roomCode;
  state.role = role;

  // WebSocket URL（支持本地和远程）
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location.host;
  const wsUrl = `${protocol}//${host}/ws?room=${roomCode}&role=${role}`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.log(`[WS] 已连接到房间 ${roomCode}，角色: ${role}`);
    showToast(`✅ 已连接到房间 ${roomCode}`);
  };

  state.ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWSMessage(msg);
    } catch (e) {
      console.error('[WS] 消息解析失败', e);
    }
  };

  state.ws.onerror = (err) => {
    console.error('[WS] 连接错误', err);
    showToast('❌ 连接失败', 'error');
  };

  state.ws.onclose = () => {
    console.log('[WS] 连接已关闭');
    showToast('⚠️ 连接已断开', 'warning');
  };
}

// ── 处理 WebSocket 消息 ─────────────────────────────────────────────────────
function handleWSMessage(msg) {
  console.log('[WS] 收到消息:', msg.type);

  switch (msg.type) {
    case 'JOINED':
      console.log(`[WS] 加入成功，ID: ${msg.clientId}`);
      break;

    case 'PEER_JOINED':
      console.log(`[WS] 新设备加入: ${msg.role}`);
      showToast(`📱 ${msg.role} 已加入`);
      break;

    case 'PEER_LEFT':
      console.log(`[WS] 设备离开: ${msg.role}`);
      break;

    case 'START_SCHEDULED':
      // 发令端预约了发令时间
      handleScheduledStart(msg);
      break;

    case 'SHOT_UPDATED':
      // 枪次状态更新
      if (msg.shot) {
        state.currentShot = msg.shot;
        updateUI();
      }
      break;

    case 'FINISH_DETECTED':
      // 终点端检测到冲线
      handleFinishDetected(msg);
      break;
  }

  // 传递给 shotManager 处理
  shotManager.handleWSMessage(msg);
}

// ── 发送 WebSocket 消息 ─────────────────────────────────────────────────────
function sendWS(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(msg));
  } else {
    console.warn('[WS] 未连接，无法发送消息');
  }
}

// ── 发令端：创建枪次 ────────────────────────────────────────────────────────
export async function createShot(params) {
  try {
    const shot = await shotManager.createShot({
      roomCode: state.roomCode,
      eventName: params.eventName || '100米',
      round: params.round || 1,
      group: params.group || 1,
      laneCount: params.laneCount || 8,
    });

    state.currentShot = shot;

    // 广播给所有设备
    sendWS({
      type: 'SHOT_CREATED',
      shot: shot,
    });

    return shot;
  } catch (e) {
    console.error('[Starter] 创建枪次失败', e);
    showToast('❌ 创建失败: ' + e.message, 'error');
    throw e;
  }
}

// ── 发令端：状态转换 ────────────────────────────────────────────────────────
export async function transitionState(newState, data = {}) {
  if (!state.currentShot) {
    throw new Error('没有活动的枪次');
  }

  try {
    const shot = await shotManager.transition(state.currentShot.id, newState, data);
    state.currentShot = shot;

    // 广播状态变化
    sendWS({
      type: 'STATE_CHANGED',
      shotId: shot.id,
      newState: newState,
      data: data,
    });

    return shot;
  } catch (e) {
    console.error('[Starter] 状态转换失败', e);
    showToast('❌ ' + e.message, 'error');
    throw e;
  }
}

// ── 发令端：预约发令（精准模式）────────────────────────────────────────────
export async function scheduleFire(delayMs = 2000) {
  // 计算预约时间（使用同步后的服务器时间）
  const scheduledStartAt = getServerTime() + delayMs;

  await transitionState(RaceState.SCHEDULED, { scheduledStartAt });

  // 广播预约时间
  sendWS({
    type: 'START_SCHEDULED',
    shotId: state.currentShot.id,
    startAt: scheduledStartAt,
  });

  // 本地倒计时
  const countdown = setInterval(() => {
    const remaining = scheduledStartAt - getServerTime();
    if (remaining <= 0) {
      clearInterval(countdown);
      executeFire(scheduledStartAt);
    } else {
      updateCountdown(remaining);
    }
  }, 50);
}

// ── 发令端：执行发令 ────────────────────────────────────────────────────────
async function executeFire(actualStartAt) {
  state.startTimeLocal = actualStartAt;

  // 播放枪声
  playGunSound();

  // 转换到 RUNNING 状态
  await transitionState(RaceState.RUNNING, { actualStartAt });

  // 开始计时器
  startTimer(actualStartAt);
}

// ── 终点端：处理预约发令 ────────────────────────────────────────────────────
function handleScheduledStart(msg) {
  const startAt = msg.startAt;
  const now = getServerTime();
  const delay = startAt - now;

  console.log(`[Finish] 预约发令，${delay}ms 后开始`);

  // 倒计时
  setTimeout(() => {
    startFinishDetection(startAt);
  }, delay);
}

// ── 终点端：开始检测 ────────────────────────────────────────────────────────
function startFinishDetection(startTime) {
  state.startTimeLocal = startTime;

  if (!state.aiDetector) {
    state.aiDetector = new AIFinishLineDetector({
      mode: 'manual', // 当前使用手动模式
      laneCount: state.currentShot?.laneCount || 8,
    });
  }

  state.aiDetector.start(startTime);

  // 监听检测事件
  state.aiDetector.on((event, data) => {
    if (event === 'detection') {
      handleLocalDetection(data);
    }
  });
}

// ── 终点端：本地检测到冲线 ──────────────────────────────────────────────────
function handleLocalDetection(detection) {
  console.log(`[Finish] 道次 ${detection.lane + 1} 冲线: ${detection.finishTime}ms`);

  // 广播给所有设备
  sendWS({
    type: 'FINISH_DETECTED',
    shotId: state.currentShot.id,
    lane: detection.lane,
    finishTime: detection.finishTime,
    confidence: detection.confidence,
    method: detection.method,
  });

  // 视觉和声音反馈
  showToast(`🏁 道次 ${detection.lane + 1}: ${formatTime(detection.finishTime)}`);
  playBeep();
}

// ── 发令端/成绩端：处理终点检测 ─────────────────────────────────────────────
function handleFinishDetected(msg) {
  if (!state.currentShot || state.currentShot.id !== msg.shotId) return;

  // 更新本地枪次数据
  const lanes = [...state.currentShot.lanes];
  lanes[msg.lane] = {
    ...lanes[msg.lane],
    finishTimeMs: msg.finishTime,
    aiConfidence: msg.confidence,
    aiMethod: msg.method,
    needsReview: msg.confidence < 0.85,
  };

  state.currentShot.lanes = lanes;
  updateUI();
}

// ── 计时器 ──────────────────────────────────────────────────────────────────
function startTimer(startTime) {
  const timerInterval = setInterval(() => {
    if (state.currentShot?.state !== RaceState.RUNNING) {
      clearInterval(timerInterval);
      return;
    }

    const elapsed = getServerTime() - startTime;
    updateTimerDisplay(elapsed);
  }, 50);
}

// ── UI 更新 ─────────────────────────────────────────────────────────────────
function updateUI() {
  // 触发自定义事件，让各个 UI 组件响应
  window.dispatchEvent(new CustomEvent('shot-updated', {
    detail: { shot: state.currentShot }
  }));
}

function updateTimerDisplay(elapsed) {
  window.dispatchEvent(new CustomEvent('timer-tick', {
    detail: { elapsed }
  }));
}

function updateCountdown(remaining) {
  window.dispatchEvent(new CustomEvent('countdown-tick', {
    detail: { remaining }
  }));
}

// ── 工具函数 ────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  window.dispatchEvent(new CustomEvent('show-toast', {
    detail: { message, type }
  }));
}

function playGunSound() {
  // TODO: 实现枪声播放
  const audio = new Audio('/sounds/gunshot.mp3');
  audio.play().catch(e => console.warn('播放失败', e));
}

function playBeep() {
  const audio = new Audio('/sounds/beep.mp3');
  audio.play().catch(e => console.warn('播放失败', e));
}

// ── 枪次管理事件处理 ────────────────────────────────────────────────────────
function handleShotEvent(event, data) {
  console.log('[Shot Event]', event, data);
  updateUI();
}

// ── 导出 API ────────────────────────────────────────────────────────────────
export const app = {
  init,
  connectRoom,
  createShot,
  transitionState,
  scheduleFire,
  getState: () => state,
  getServerTime,
};

// 全局暴露（用于调试）
if (typeof window !== 'undefined') {
  window.JingJiApp = app;
}
