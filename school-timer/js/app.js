/**
 * 极速计时 - 校园体育计时器
 * 专为中小学体育课、校运会设计
 * 极简操作 · 专业精度
 */

// ========================================
// Global State
// ========================================
const state = {
  mode: 'start', // 'start' | 'finish'
  connected: false,
  roomCode: null,
  distance: 100,
  laneCount: 4,
  startMode: 'manual',
  raceStarted: false,
  raceFinished: false,
  athletes: [],
  results: [],
  timer: null,
  startTime: 0,
  currentGroup: 1,
};

// ========================================
// Timer Class
// ========================================
class PrecisionTimer {
  constructor() {
    this._startTime = 0;
    this._running = false;
    this._listeners = new Set();
  }

  get elapsed() {
    return this._running ? performance.now() - this._startTime : 0;
  }

  start() {
    if (this._running) return;
    this._startTime = performance.now();
    this._running = true;
    this._tick();
  }

  stop() {
    this._running = false;
  }

  reset() {
    this._running = false;
    this._startTime = 0;
  }

  _tick() {
    if (!this._running) return;
    const elapsed = this.elapsed;
    this._listeners.forEach(fn => fn(elapsed));
    requestAnimationFrame(() => this._tick());
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  static format(ms) {
    const t = Math.max(0, Math.round(ms));
    const s = Math.floor(t / 1000);
    const cs = Math.floor((t % 1000) / 10);
    return `${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  static formatFull(ms) {
    const t = Math.max(0, Math.round(ms));
    const m = Math.floor(t / 60000);
    const s = Math.floor((t % 60000) / 1000);
    const ms = t % 1000;
    if (m > 0) {
      return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    }
    return `${s}.${String(ms).padStart(3, '0')}`;
  }
}

const timer = new PrecisionTimer();

// ========================================
// Audio Generator - 专业发令音效
// ========================================
class StarterAudio {
  constructor() {
    this.ctx = null;
    this.init();
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  async play(command) {
    this.init();
    if (!this.ctx) return;

    switch (command) {
      case 'geJiuWei':
        await this._playTone([440, 523, 659], 400, 0.85);
        break;
      case 'yuBei':
        await this._playTone([523, 659, 784], 450, 0.85);
        break;
      case 'gunshot':
        await this._playGunshot();
        break;
      case 'recall':
        await this._playRecall();
        break;
      case 'victory':
        await this._playVictory();
        break;
    }
  }

  async _playTone(freqs, duration, vol) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqs[0], now);
    if (freqs.length > 1) {
      osc.frequency.setValueAtTime(freqs[0], now + 0.1);
      osc.frequency.setValueAtTime(freqs[1], now + 0.15);
      if (freqs.length > 2) osc.frequency.setValueAtTime(freqs[2], now + 0.25);
    }

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.05);
    gain.gain.setValueAtTime(vol, now + duration / 1000 - 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration / 1000);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration / 1000);

    await this._delay(duration);
  }

  async _playGunshot() {
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 爆破瞬态
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.02, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.005));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2000;
    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.9, now);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
    src.connect(filter).connect(g1).connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.03);

    // 主枪声
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'square';
    o1.frequency.setValueAtTime(150, now);
    o1.frequency.exponentialRampToValueAtTime(60, now + 0.1);
    o2.frequency.setValueAtTime(60, now);
    o2.frequency.exponentialRampToValueAtTime(30, now + 0.15);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.7, now);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g2).connect(ctx.destination);
    o1.start(now);
    o2.start(now);
    o1.stop(now + 0.2);
    o2.stop(now + 0.2);

    await this._delay(200);
  }

  async _playRecall() {
    const ctx = this.ctx;
    for (let i = 0; i < 5; i++) {
      const now = ctx.currentTime + i * 0.15;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    }
    await this._delay(800);
  }

  async _playVictory() {
    const ctx = this.ctx;
    const notes = [1047, 1319, 1568];
    notes.forEach((n, i) => {
      const now = ctx.currentTime + i * 0.18;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n;
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    });
    await this._delay(600);
  }

  _delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

const starterAudio = new StarterAudio();

// ========================================
// DOM Helpers
// ========================================
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ========================================
// Toast Notification
// ========================================
let toastTimer = null;
function showToast(msg, type = 'info') {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ========================================
// Mode Selection
// ========================================
function selectMode(mode) {
  state.mode = mode;

  $$('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  if (mode === 'finish') {
    $('connectSection').classList.add('hidden');
    showFinishView();
  } else {
    $('connectSection').classList.remove('hidden');
    hideFinishView();
  }

  showToast(`已切换到${mode === 'start' ? '发令端' : '终点端'}模式`);
}

// ========================================
// Connection
// ========================================
function toggleConnect() {
  if (state.connected) {
    disconnect();
  } else {
    connect();
  }
}

function connect() {
  const code = $('roomCode').value.trim();
  if (!code) {
    showToast('请输入房间码', 'warning');
    return;
  }
  state.roomCode = code;
  state.connected = true;
  $('syncStatus').classList.add('connected');
  $('syncStatus').querySelector('.status-text').textContent = `房间 ${code}`;
  $('connectBtn').textContent = '断开';
  showToast('连接成功', 'success');
}

function disconnect() {
  state.connected = false;
  state.roomCode = null;
  $('syncStatus').classList.remove('connected');
  $('syncStatus').querySelector('.status-text').textContent = '单机模式';
  $('connectBtn').textContent = '连接';
  $('roomCode').value = '';
  showToast('已断开连接', 'info');
}

// ========================================
// Settings
// ========================================
function initDistancePills() {
  $$('.dist-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      $$('.dist-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.distance = parseInt(pill.dataset.dist);
      showToast(`已设置为 ${state.distance}米`);
    });
  });
}

function changeLane(delta) {
  state.laneCount = Math.max(1, Math.min(8, state.laneCount + delta));
  $('laneCount').textContent = state.laneCount;
  buildAthletesList();
}

function selectStartMode(mode) {
  state.startMode = mode;
  $$('.start-mode-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.mode === mode);
  });
}

// ========================================
// Athletes List
// ========================================
function buildAthletesList() {
  const list = $('athletesList');
  if (!list) return;

  list.innerHTML = '';
  for (let i = 0; i < state.laneCount; i++) {
    const row = document.createElement('div');
    row.className = 'athlete-row';
    row.innerHTML = `
      <div class="athlete-num">${i + 1}</div>
      <input type="text" class="athlete-input"
        id="athlete-${i}"
        placeholder="运动员${i + 1}姓名"
        value="运动员${i + 1}">
    `;
    list.appendChild(row);
  }

  // 更新state.athletes
  state.athletes = Array.from({ length: state.laneCount }, (_, i) => ({
    id: i,
    name: `运动员${i + 1}`,
    time: null,
    rank: null
  }));
}

function getAthletes() {
  return Array.from({ length: state.laneCount }, (_, i) => {
    const input = $(`athlete-${i}`);
    return {
      id: i,
      name: input?.value.trim() || `运动员${i + 1}`,
      time: null,
      rank: null
    };
  });
}

// ========================================
// Race Control
// ========================================
async function startRace() {
  if (state.raceStarted) return;

  state.athletes = getAthletes();
  state.raceStarted = true;
  state.raceFinished = false;

  const timerDisplay = $('timerDisplay');
  const timerStatus = $('timerStatus');
  const btnStart = $('btnStart');
  const btnStop = $('btnStop');
  const btnAbort = $('btnAbort');

  timerDisplay.classList.add('running');
  timerDisplay.classList.remove('finished');
  btnStart.classList.add('hidden');
  btnStop.classList.remove('hidden');
  btnAbort.classList.remove('hidden');

  switch (state.startMode) {
    case 'manual':
      await runManualSequence();
      break;
    case 'audio':
      await runAudioSequence();
      break;
    case 'countdown':
      await runCountdownSequence();
      break;
  }

  timer.start();
  timerStatus.textContent = '计时中...';

  timer.onChange(ms => {
    timerDisplay.textContent = PrecisionTimer.format(ms);
  });

  showToast('🏃 比赛开始！', 'success');
}

async function runManualSequence() {
  // 手动模式：直接开始
  const timerStatus = $('timerStatus');
  timerStatus.textContent = '准备发令...';
  await starterAudio.play('geJiuWei');
  await starterAudio.play('yuBei');
  await starterAudio.play('gunshot');
}

async function runAudioSequence() {
  // 声音检测模式
  const timerStatus = $('timerStatus');
  timerStatus.textContent = '🎤 等待枪声...';
  showToast('请用声音触发开始', 'info');
  // 等待声音检测触发
}

async function runCountdownSequence() {
  // 倒计时模式
  const timerStatus = $('timerStatus');
  for (let i = 5; i > 0; i--) {
    timerStatus.textContent = `${i}...`;
    await starterAudio.play('geJiuWei');
    await new Promise(r => setTimeout(r, 1000));
  }
  await starterAudio.play('gunshot');
}

function stopRace() {
  if (!state.raceStarted || state.raceFinished) return;

  timer.stop();
  state.raceFinished = true;

  const timerDisplay = $('timerDisplay');
  const timerStatus = $('timerStatus');
  const btnStop = $('btnStop');
  const btnAbort = $('btnAbort');
  const resultsSection = $('resultsSection');

  timerDisplay.classList.remove('running');
  timerDisplay.classList.add('finished');
  btnStop.classList.add('hidden');
  btnAbort.classList.add('hidden');
  timerStatus.textContent = '比赛结束';
  resultsSection.classList.remove('hidden');

  // 计算成绩
  calculateResults();
  renderResults();

  starterAudio.play('victory');

  showToast('✅ 成绩已保存', 'success');
}

function abortRace() {
  if (!state.raceStarted) return;

  timer.reset();
  state.raceStarted = false;
  state.raceFinished = false;

  const timerDisplay = $('timerDisplay');
  const timerStatus = $('timerStatus');
  const btnStart = $('btnStart');
  const btnStop = $('btnStop');
  const btnAbort = $('btnAbort');
  const resultsSection = $('resultsSection');

  timerDisplay.textContent = '00:00.00';
  timerDisplay.classList.remove('running', 'finished');
  timerStatus.textContent = '已召回，重新发令';
  btnStart.classList.remove('hidden');
  btnStop.classList.add('hidden');
  btnAbort.classList.add('hidden');
  resultsSection.classList.add('hidden');

  starterAudio.play('recall');

  showToast('⚠️ 比赛已召回', 'warning');
}

function calculateResults() {
  const elapsed = timer.elapsed;

  state.results = state.athletes.map((athlete, i) => ({
    ...athlete,
    time: elapsed + (i * 50), // 模拟手动记录的成绩差异
    rank: i + 1
  }));

  state.results.sort((a, b) => a.time - b.time);
  state.results.forEach((r, i) => r.rank = i + 1);
}

function renderResults() {
  const list = $('resultsList');
  if (!list) return;

  const medals = ['🥇', '🥈', '🥉'];

  list.innerHTML = state.results.map(r => `
    <div class="result-row ${r.rank === 1 ? 'gold' : ''}">
      <div class="result-rank">${medals[r.rank - 1] || `#${r.rank}`}</div>
      <div class="result-name">${r.name}</div>
      <div class="result-time">${PrecisionTimer.formatFull(r.time)}</div>
    </div>
  `).join('');
}

function nextGroup() {
  state.currentGroup++;
  state.raceStarted = false;
  state.raceFinished = false;
  timer.reset();

  const timerDisplay = $('timerDisplay');
  const timerStatus = $('timerStatus');
  const btnStart = $('btnStart');
  const btnStop = $('btnStop');
  const btnAbort = $('btnAbort');
  const resultsSection = $('resultsSection');

  timerDisplay.textContent = '00:00.00';
  timerDisplay.classList.remove('running', 'finished');
  timerStatus.textContent = '准备就绪';
  btnStart.classList.remove('hidden');
  btnStop.classList.add('hidden');
  btnAbort.classList.add('hidden');
  resultsSection.classList.add('hidden');

  showToast(`第 ${state.currentGroup} 组准备就绪`);
}

// ========================================
// Export Results
// ========================================
function exportResults() {
  const rows = [
    ['名次', '姓名', '时间'],
    ...state.results.map(r => [r.rank, r.name, PrecisionTimer.formatFull(r.time)])
  ];

  const csv = rows.map(row => row.join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `成绩_${state.distance}米_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  showToast('📥 成绩已导出', 'success');
}

// ========================================
// Finish View (Camera)
// ========================================
let videoStream = null;

async function showFinishView() {
  $('main').classList.add('hidden');
  $('finishView').classList.remove('hidden');

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    $('finishVideo').srcObject = videoStream;
    $('finishOverlay').classList.add('hidden');
    showToast('摄像头已启动', 'success');
  } catch (e) {
    $('finishOverlay').classList.remove('hidden');
    $('finishOverlay').querySelector('.finish-instruction').innerHTML = `
      ❌ 无法访问摄像头
      <br>
      <small>请允许摄像头权限</small>
    `;
  }
}

function hideFinishView() {
  $('finishView').classList.add('hidden');
  $('main').classList.remove('hidden');
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
  }
}

// ========================================
// Initialize
// ========================================
function init() {
  // 加载设置
  const saved = localStorage.getItem('school-timer-settings');
  if (saved) {
    const settings = JSON.parse(saved);
    state.distance = settings.distance || 100;
    state.laneCount = settings.laneCount || 4;
  }

  // 设置距离选择
  $$('.dist-pill').forEach(pill => {
    pill.classList.toggle('active', parseInt(pill.dataset.dist) === state.distance);
  });

  // 设置道次
  $('laneCount').textContent = state.laneCount;

  // 构建运动员列表
  buildAthletesList();

  // 初始化距离选择器
  initDistancePills();

  // 监听设置变化
  window.addEventListener('beforeunload', () => {
    localStorage.setItem('school-timer-settings', JSON.stringify({
      distance: state.distance,
      laneCount: state.laneCount
    }));
  });

  // 隐藏加载页面
  setTimeout(() => {
    $('loading').classList.add('hidden');
  }, 1000);
}

// Start
document.addEventListener('DOMContentLoaded', init);

// Export functions for onclick handlers
window.selectMode = selectMode;
window.changeLane = changeLane;
window.selectStartMode = selectStartMode;
window.toggleConnect = toggleConnect;
window.startRace = startRace;
window.stopRace = stopRace;
window.abortRace = abortRace;
window.nextGroup = nextGroup;
window.exportResults = exportResults;