import { PrecisionTimer   } from './timer.js';
import { AudioDetector    } from './audio.js';
import { VideoRecorder    } from './recorder.js';
import { Sync, generateRoomCode } from './sync2.js';
import { FinishLineDetector }     from './finishline.js';
import { ApiClient }              from './api-client.js';
import { exportCSV, exportXLSX, exportPDF } from './export.js';
import { initLanguage, createLangSwitcher } from './i18n.js';

const MAX_LANES = 8;

// ── Global state ───────────────────────────────────────
const state = {
  role:         'solo',   // 'solo' | 'start' | 'finish'
  laneCount:    4,
  lapCount:     1,        // laps per race (1 = sprint, 4 = 1600m, etc.)
  distance:     100,      // race distance in metres
  trackLength:  400,      // track length in metres
  perfMode:     'balanced', // 'high' | 'balanced' | 'low' - 性能模式
  perfMonitoringEnabled: false, // 性能监控开关（默认关闭）
  practiceMode: false,    // 练习模式标记
  currentRound: 1,
  currentGroup: 1,
  meetId:       null,
  eventId:      null,
  lanes:        [],
  startMode:    'manual',
  videoEnabled: true,
  facingMode:   'environment',
  micGranted:   false,
  camGranted:   false,
  raceStarted:  false,
  raceFinished: false,
  // sync
  roomCode:     null,
  clientId:     null,
  peerConnected:false,
  raceStartServerTime: null,
  // 房间锁定状态
  roomLocked:   false,    // 房间号是否已锁定（连接后锁定）
  // finish device — per-lane multi-lap tracking
  recordingStart: null,
  crossings:    [],
  finishRecorderBlob: null,
  laneCrossings:       {},
  laneLastCrossingTime:{},
  lanesDone:           0,
  // session history: all completed groups this session (used for observer catch-up)
  sessionHistory: [],
  // lane sync between start ↔ finish device
  finishDeviceLanes: null,  // lane count last reported by finish device (null = not yet known)
  // finish device: auto-detected lane count is the authority — start device cannot override
  autoDetectedLanes: null,  // set by finish device when auto-detect succeeds
  // observer device
  obsResults:   [],   // crossings this group
  obsHistory:   [],   // array of {round,group,results[]}
  obsRaceInfo:  {},   // latest RACE_CONFIG payload
  // 导出相关
  lastRace:     null, // 最后一场比赛数据，用于导出
};

const timer    = new PrecisionTimer();
const audio    = new AudioDetector();
const recorder = new VideoRecorder();
const sync     = new Sync();
const detector = new FinishLineDetector();

// ── 专业发令音效生成器 V3.0 ────────────────────────────
class StarterAudioGenerator {
  constructor() { this.audioCtx = null; this.initialized = false; }
  init() {
    if (this.initialized) return;
    try { this.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); this.initialized = true; } catch {}
  }
  async playGeJiuWei() { // "各就位" - 中文语音合成，音量加大
    this.init(); if (!this.audioCtx) return;
    const utterance = new SpeechSynthesisUtterance('各就位');
    const voices = speechSynthesis.getVoices();
    const chineseVoice = voices.find(v => v.lang.includes('zh')) || voices.find(v => v.lang.includes('CN')) || voices[0];
    if (chineseVoice) utterance.voice = chineseVoice;
    utterance.lang = 'zh-CN';
    utterance.rate = 0.8;   // 稍慢更清晰
    utterance.pitch = 0.7;   // 低沉有力
    utterance.volume = 1.5;  // 最大音量
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
    await new Promise(r => setTimeout(r, 800));
  }
  async playYuBei() { // "预备" - 中文语音合成，音量加大
    this.init(); if (!this.audioCtx) return;
    const utterance = new SpeechSynthesisUtterance('预备');
    const voices = speechSynthesis.getVoices();
    const chineseVoice = voices.find(v => v.lang.includes('zh')) || voices.find(v => v.lang.includes('CN')) || voices[0];
    if (chineseVoice) utterance.voice = chineseVoice;
    utterance.lang = 'zh-CN';
    utterance.rate = 0.8;
    utterance.pitch = 0.7;
    utterance.volume = 1.5;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
    await new Promise(r => setTimeout(r, 600));
  }
  async playGunshot() { // 专业电子发令枪声 - 2000Hz/1.5秒/有力
    this.init(); if (!this.audioCtx) return;
    const ctx = this.audioCtx, now = ctx.currentTime;
    const FREQ = 2000, DURATION = 1.5;

    // 1. 起始爆破 (0-40ms)
    const nb = ctx.createBuffer(1, ctx.sampleRate * 0.04, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for(let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.008));
    const ns = ctx.createBufferSource(); ns.buffer = nb;
    const nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 800;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(1.0, now); ng.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    ns.connect(nf); nf.connect(ng); ng.connect(ctx.destination);

    // 2. 主体哨音 (0-1400ms) - 2000Hz正弦波
    const mainOsc = ctx.createOscillator(), mainGain = ctx.createGain();
    mainOsc.type = 'sine'; mainOsc.frequency.setValueAtTime(FREQ, now);
    mainGain.gain.setValueAtTime(0, now);
    mainGain.gain.linearRampToValueAtTime(1.0, now + 0.02);
    mainGain.gain.setValueAtTime(1.0, now + 1.3);
    mainGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    mainOsc.connect(mainGain); mainGain.connect(ctx.destination);

    // 3. 泛音层 (0-1200ms) - 增加力度感
    const harmOsc = ctx.createOscillator(), harmGain = ctx.createGain();
    harmOsc.type = 'sine'; harmOsc.frequency.setValueAtTime(FREQ * 2, now);
    harmGain.gain.setValueAtTime(0, now);
    harmGain.gain.linearRampToValueAtTime(0.3, now + 0.02);
    harmGain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    harmOsc.connect(harmGain); harmGain.connect(ctx.destination);

    // 4. 低频轰鸣 (0-300ms) - 增加厚重感
    const lowOsc = ctx.createOscillator(), lowGain = ctx.createGain();
    lowOsc.type = 'sine'; lowOsc.frequency.setValueAtTime(120, now); lowOsc.frequency.exponentialRampToValueAtTime(60, now + 0.3);
    lowGain.gain.setValueAtTime(0.5, now); lowGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    lowOsc.connect(lowGain); lowGain.connect(ctx.destination);

    // 启动
    ns.start(now); mainOsc.start(now); harmOsc.start(now); lowOsc.start(now);
    // 停止
    ns.stop(now + 0.04); mainOsc.stop(now + 1.5); harmOsc.stop(now + 1.2); lowOsc.stop(now + 0.3);

    await new Promise(r => setTimeout(r, 1600));
  }
  async playRecall() { // 召回信号
    this.init(); if (!this.audioCtx) return;
    const ctx = this.audioCtx;
    for(let i=0;i<5;i++){
      const now = ctx.currentTime+i*0.15, osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type='sine'; osc.frequency.value=660;
      g.gain.setValueAtTime(0.5,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.08);
      osc.connect(g); g.connect(ctx.destination); osc.start(now); osc.stop(now+0.1);
    }
    await new Promise(r=>setTimeout(r,800));
  }
  async playVictory() { // 胜利音效
    this.init(); if (!this.audioCtx) return;
    const ctx = this.audioCtx, notes=[1047,1319,1568];
    notes.forEach((n,i)=>{
      const now = ctx.currentTime+i*0.18, osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type='sine'; osc.frequency.value=n;
      g.gain.setValueAtTime(0.4,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.2);
      osc.connect(g); g.connect(ctx.destination); osc.start(now); osc.stop(now+0.25);
    });
    await new Promise(r=>setTimeout(r,600));
  }
}
const starterAudio = new StarterAudioGenerator();

// 预加载中文语音（防止首次使用时延迟）
if (speechSynthesis) {
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  // 提前触发一次语音加载
  setTimeout(() => { speechSynthesis.cancel(); }, 100);
}

// ── Tone generator (no library needed) ────────────────
let _audioCtx;
function beep(freq = 880, durationMs = 100, vol = 0.4) {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain);
    gain.connect(_audioCtx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(vol, _audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + durationMs / 1000);
    osc.start();
    osc.stop(_audioCtx.currentTime + durationMs / 1000);
  } catch {}
}
function startBeep() {
  // Three short beeps then a long one = classic starter signal
  beep(880, 80); setTimeout(() => beep(880, 80), 150); setTimeout(() => beep(880, 80), 300);
  setTimeout(() => beep(1320, 300), 500);
}

let mainStream   = null;
let toastTimer   = null;
let selectedRole = null;   // role being selected in UI (before confirm)

// ── DOM shortcuts ──────────────────────────────────────
const $ = id => document.getElementById(id);

const DOM = {
  // Overlays
  loading:     $('loading'),
  roleOverlay: $('role-overlay'),
  permOverlay: $('perm-overlay'),
  toast:       $('toast'),
  // Header
  appTitle:    $('app-title'),
  syncBadge:   $('sync-badge'),
  syncRoom:    $('sync-room'),
  pillMic:     $('pill-mic'),
  pillCam:     $('pill-cam'),
  // Tab bars
  tabBarStart: $('tab-bar-start'),
  // Role select
  btnRoleSolo:    $('btn-role-solo'),
  btnRoleStart:   $('btn-role-start'),
  btnRoleFinish:  $('btn-role-finish'),
  roomPanel:       $('room-panel'),
  roomCodeSetWrap: $('room-code-set-wrap'),
  roomCodeSet:     $('room-code-set'),
  btnRoomSuggest:  $('btn-room-suggest'),
  roomCodeInputW:  $('room-code-input-wrap'),
  roomCodeInput:   $('room-code-input'),
  roomStatus:      $('room-status'),
  btnConnect:      $('btn-connect'),
  serverUrlInput:  $('server-url-input'),
  serverCurrent:   $('server-current'),
  btnRoleConfirm:  $('btn-role-confirm'),
  // Setup
  raceName:       $('race-name'),
  laneCountDisp:  $('lane-count-display'),
  laneInputs:     $('lane-inputs'),
  sensPannel:     $('audio-sens-panel'),
  sensSlider:     $('sensitivity'),
  sensVal:        $('sens-val'),
  levelFill:      $('level-fill'),
  levelLine:      $('level-line'),
  monitorStatus:  $('monitor-status'),
  chkVideo:       $('chk-video'),
  camPreviewBox:  $('cam-preview-box'),
  setupVideo:     $('setup-video'),
  camPlaceholder: $('cam-placeholder'),
  btnFlipCam:     $('btn-flip-cam'),
  // Race (start device)
  raceVideo:      $('race-video'),
  raceCanvas:     $('race-canvas'),
  recBadge:       $('rec-badge'),
  camOffMsg:      $('cam-off-msg'),
  timerDisplay:   $('timer-display'),
  timerSub:       $('timer-sub'),
  vizWrap:        $('visualizer-wrap'),
  visualizer:     $('visualizer'),
  visLabel:       $('vis-label'),
  btnStart:       $('btn-race-start'),
  btnStop:        $('btn-race-stop'),
  btnAbort:       $('btn-race-abort'),
  btnReset:       $('btn-race-reset'),
  lanesWrap:      $('lanes-wrap'),
  // Observer device
  obsConnDot:     $('obs-conn-dot'),
  obsStateLabel:  $('obs-state-label'),
  obsRoomBadge:   $('obs-room-badge'),
  obsInfoBar:     $('obs-info-bar'),
  obsTableWrap:   $('obs-table-wrap'),
  obsHistoryList: $('obs-history-list'),
  btnObsExport:   $('btn-obs-export'),
  // Setup
  orgName:        $('org-name'),
  // Results
  resultsCurrent: $('results-current'),
  resultsTitle:   $('results-race-title'),
  resultsMeta:    $('results-meta'),
  resultsTableW:  $('results-table-wrap'),
  videoReplayCard:$('video-replay-card'),
  replayVideo:    $('replay-video'),
  btnDlVideo:     $('btn-dl-video'),
  btnExportCsv:   $('btn-export-csv'),
  btnExportXlsx:  $('btn-export-xlsx'),
  btnExportPdf:   $('btn-export-pdf'),
  btnBatchExport: $('btn-batch-export'),
  btnClearRes:    $('btn-clear-results'),
  historyList:    $('history-list'),
  trendCanvas:    $('trend-canvas'),
  trendStats:     $('trend-stats'),
  trendBest:      $('trend-best'),
  trendAvg:       $('trend-avg'),
  trendCount:     $('trend-count'),
  trendEmpty:     $('trend-empty'),
  btnToggleTrend: $('btn-toggle-trend'),
  // Finish device – fullscreen
  finishVideoFs:    $('finish-video-fs'),
  finishCanvasFs:   $('finish-canvas-fs'),
  fsConnDot:        $('fs-conn-dot'),
  fsStateLabel:     $('fs-state-label'),
  fsRecDot:         $('fs-rec-dot'),
  fsResults:        $('fs-results'),
  fsEnd:            $('fs-end'),
  fsEndList:        $('fs-end-list'),
  btnFsNextGroup:   $('btn-fs-next-group'),
  btnFsDownload:    $('btn-fs-download'),
  fsSettingsPanel:  $('fs-settings-panel'),
  fsSensSlider:     $('fs-sensitivity'),
  fsSensVal:        $('fs-sens-val'),
  fsPerfStats:      $('fs-perf-stats'),
  fsFpsVal:         $('fs-fps-val'),
  fsModeVal:        $('fs-mode-val'),
  fsLevelFill:      $('fs-level-fill'),
  fsDetectStatus:   $('fs-detect-status'),
  btnFsFlip:        $('btn-fs-flip'),
  btnFsSettings:    $('btn-fs-settings'),
  btnFsSettingsClose:$('btn-fs-settings-close'),
};

// ── WeChat / browser detection ─────────────────────────
function isWeChat() { return /MicroMessenger/i.test(navigator.userAgent); }
function isHTTPS()  { return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'; }

// ── 全局错误处理 ─────────────────────────────────────────
window.addEventListener('error', (e) => {
  const msg = e.message || '未知错误';
  console.error('[App Error]', msg, e);
  // 忽略一些常见的无害错误
  if (msg.includes('ResizeObserver') || msg.includes('Non-Error')) return;
  showToast(`系统错误: ${msg}`, 'error');
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[Unhandled Promise]', e.reason);
});

// ── Init ───────────────────────────────────────────────
async function init() {
  // 超时保护：5秒后强制显示界面
  const timeoutId = setTimeout(() => {
    console.warn('[Init] 初始化超时，强制显示界面');
    forceShowInterface();
  }, 5000);

  try {
    // 尝试恢复之前的会话状态
    try {
      const savedState = sessionStorage.getItem('jingji-session');
      if (savedState) {
        const parsed = JSON.parse(savedState);
        if (parsed.roomCode) state.roomCode = parsed.roomCode;
      }
    } catch (e) { console.warn('[Init] 恢复会话状态失败:', e); }

    loadSettings();
    buildLaneInputs();
    attachEventListeners();
    applySettingsToDOM();
    loadHistory();
    timer.onChange(ms => { DOM.timerDisplay.textContent = PrecisionTimer.format(ms); });

    // WeChat browser can't use camera/mic at all – tell user to open in real browser
    if (isWeChat()) {
      clearTimeout(timeoutId);
      showWeChatWarning();
      return;
    }
  } catch (e) {
    console.error('[Init] 初始化错误:', e);
  } finally {
    clearTimeout(timeoutId);
    forceShowInterface();
  }
}

function forceShowInterface() {
  // 确保 loading 隐藏，角色选择显示
  const loading = document.getElementById('loading');
  const roleOverlay = document.getElementById('role-overlay');
  if (loading) loading.classList.add('hidden');
  if (roleOverlay) roleOverlay.classList.remove('hidden');
}


function updateLapDisplay() {
  const el = $('lap-count-display');
  if (el) el.textContent = state.lapCount;
}


function recomputeLaps() {
  state.lapCount = Math.max(1, Math.ceil(state.distance / state.trackLength));
  updateLapDisplay();
  saveSettings();
}

// 快速应用模板
function applyQuickTemplate(distance, lanes) {
  state.distance = distance;
  state.laneCount = lanes;

  // 更新UI
  const distSel = $('race-distance');
  if (distSel) {
    distSel.value = String(distance);
  }
  DOM.laneCountDisp.textContent = lanes;

  // 更新圈数
  recomputeLaps();

  // 重新构建道次
  buildLaneInputs();

  // 保存并广播
  saveSettings();
  broadcastConfig();

  showToast(`已应用 ${distance}m ${lanes}道模板`, 'success');
}

// Read athlete names live from input fields (no need to call buildLanes first)
function getCurrentRoster() {
  return Array.from({ length: state.laneCount }, (_, i) => {
    const inp = $(`lane-input-${i}`);
    return { id: i, name: inp?.value.trim() || `运动员 ${i + 1}` };
  });
}

// Push current config to all finish devices immediately
function broadcastConfig() {
  if (state.role !== 'start' || !sync.connected) return;
  sync.send('RACE_CONFIG', {
    lapsNeeded:  state.lapCount,
    distance:    state.distance,
    trackLength: state.trackLength,
    laneCount:   state.laneCount,
    roster:      getCurrentRoster(),
  });
}

let _configTimer = null;
function debouncedBroadcastConfig() {
  clearTimeout(_configTimer);
  _configTimer = setTimeout(broadcastConfig, 350);
}

function saveSettings() {
  try {
    localStorage.setItem('race-settings', JSON.stringify({
      distance:    state.distance,
      trackLength: state.trackLength,
      laneCount:   state.laneCount,
      perfMode:    state.perfMode,
      serverHost:  DOM.serverUrlInput?.value.trim() || '',
    }));
  } catch {}
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('race-settings') || '{}');
    if (s.distance)    state.distance    = Number(s.distance);
    if (s.trackLength) state.trackLength = Number(s.trackLength);
    if (s.laneCount)   state.laneCount   = Math.min(12, Math.max(1, Number(s.laneCount)));
    if (s.perfMode)    state.perfMode    = s.perfMode; // 性能模式
    if (s.serverHost)  state.serverHost  = s.serverHost; // 服务器地址
    state.lapCount = Math.max(1, Math.ceil(state.distance / state.trackLength));
  } catch {}
}

// 加载服务器设置
function loadServerSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('race-settings') || '{}');
    if (DOM.serverUrlInput) {
      DOM.serverUrlInput.value = s.serverHost || '';
    }
    if (DOM.serverCurrent) {
      DOM.serverCurrent.textContent = location.host;
    }
    // 高亮当前选中的预设按钮
    document.querySelectorAll('.server-preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.server === (s.serverHost || ''));
    });
  } catch {}
}

function applySettingsToDOM() {
  DOM.laneCountDisp.textContent = state.laneCount;
  updateLapDisplay();
  const distSel = $('race-distance');
  const stdVals = ['60','80','100','200','400','800','1000','1500'];
  if (distSel) {
    if (stdVals.includes(String(state.distance))) {
      distSel.value = String(state.distance);
    } else {
      distSel.value = 'custom';
      $('custom-dist-row')?.classList.remove('hidden');
      const ci = $('custom-dist-input');
      if (ci) ci.value = state.distance;
    }
  }
  $('btn-track-200')?.classList.toggle('active', state.trackLength === 200);
  $('btn-track-400')?.classList.toggle('active', state.trackLength === 400);

  // Apply performance mode to UI
  if (state.perfMode) {
    document.querySelectorAll('.perf-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === state.perfMode);
    });
  }
}

// ── Role selection ─────────────────────────────────────
function selectRole(role) {
  selectedRole = role;
  [DOM.btnRoleSolo, DOM.btnRoleStart, DOM.btnRoleFinish, $('btn-role-observer')]
    .forEach(b => b?.classList.remove('selected'));

  if (role === 'solo') {
    DOM.roomPanel.classList.add('hidden');
    DOM.btnRoleConfirm.classList.remove('hidden');
    DOM.btnRoleSolo.classList.add('selected');
    _hideRoomLockedIndicator();
  } else if (role === 'start') {
    DOM.roomPanel.classList.remove('hidden');
    DOM.roomCodeSetWrap.classList.remove('hidden');
    DOM.roomCodeInputW.classList.add('hidden');
    DOM.btnRoleConfirm.classList.add('hidden');
    // Pre-fill with a suggestion; user can clear and type anything
    if (!DOM.roomCodeSet.value) DOM.roomCodeSet.value = generateRoomCode();
    DOM.btnRoleStart.classList.add('selected');
    _updateRoomLockedIndicator();
  } else if (role === 'finish') {
    DOM.roomPanel.classList.remove('hidden');
    DOM.roomCodeSetWrap.classList.add('hidden');
    DOM.roomCodeInputW.classList.remove('hidden');
    DOM.btnRoleConfirm.classList.add('hidden');
    DOM.btnRoleFinish.classList.add('selected');
    _hideRoomLockedIndicator();
  } else if (role === 'observer') {
    DOM.roomPanel.classList.remove('hidden');
    DOM.roomCodeSetWrap.classList.add('hidden');
    DOM.roomCodeInputW.classList.remove('hidden');
    DOM.btnRoleConfirm.classList.add('hidden');
    $('btn-role-observer')?.classList.add('selected');
    _hideRoomLockedIndicator();
  }
}

// 显示/更新房间锁定状态指示器
function _updateRoomLockedIndicator() {
  const lockIndicator = $('room-lock-indicator');
  if (!lockIndicator) return;

  if (state.roomLocked) {
    lockIndicator.classList.remove('hidden');
    lockIndicator.innerHTML = '<span class="lock-icon">&#128274;</span> 房间已锁定';
    // 锁定房间号输入
    DOM.roomCodeSet.disabled = true;
    DOM.roomCodeSet.readOnly = true;
    DOM.roomCodeSet.style.opacity = '0.7';
    DOM.roomCodeSet.style.cursor = 'not-allowed';
    DOM.btnRoomSuggest?.classList.add('hidden');
  } else {
    lockIndicator.classList.add('hidden');
    // 解锁房间号输入
    DOM.roomCodeSet.disabled = false;
    DOM.roomCodeSet.readOnly = false;
    DOM.roomCodeSet.style.opacity = '';
    DOM.roomCodeSet.style.cursor = '';
    DOM.btnRoomSuggest?.classList.remove('hidden');
  }
}

// 隐藏房间锁定状态指示器
function _hideRoomLockedIndicator() {
  const lockIndicator = $('room-lock-indicator');
  if (lockIndicator) lockIndicator.classList.add('hidden');
}

async function connectToRoom() {
  DOM.roomStatus.textContent = '连接中...';
  DOM.roomStatus.className   = 'room-status';
  DOM.btnConnect.disabled    = true;

  if (selectedRole === 'start') {
    const code = DOM.roomCodeSet.value.trim();
    state.roomCode = code || String(Math.floor(1000 + Math.random() * 9000));
    if (!code) DOM.roomCodeSet.value = state.roomCode;
  } else if (selectedRole === 'finish' || selectedRole === 'observer') {
    const code = DOM.roomCodeInput?.value.trim();
    if (!code) {
      DOM.roomStatus.textContent = '请输入发令端的房间码';
      DOM.roomStatus.className   = 'room-status error';
      DOM.btnConnect.disabled    = false;
      return;
    }
    state.roomCode = code;
  }

  const serverHost = ($('server-url-input')?.value.trim()) || null;

  try {
    await sync.join(state.roomCode, selectedRole, serverHost);
    state.clientId      = sync.clientId;
    state.peerConnected = sync.peerOnline;
    state.roomLocked    = true; // 连接成功后锁定房间号
    updateLatencyBadge();

    const fc = sync.finishPeerCount;
    DOM.roomStatus.textContent = fc > 0
      ? `✅ 已连接，终点端 ${fc} 个在线`
      : `✅ 已加入房间 ${state.roomCode}（等待终点端）`;
    DOM.roomStatus.className = 'room-status connected';

    // 更新房间锁定状态UI
    _updateRoomLockedIndicator();

    // Register sync events
    registerSyncEvents();

    // Show confirm button
    DOM.btnRoleConfirm.classList.remove('hidden');
    showToast(`已加入房间 ${state.roomCode}`, 'success');
  } catch (e) {
    const isWsErr = e.message?.toLowerCase().includes('websocket') || e.message?.includes('failed');
    const isStartLocked = e.code === 'START_DEVICE_LOCKED' || e.message?.includes('已有发令端');

    if (isStartLocked) {
      DOM.roomStatus.innerHTML = '❌ 该房间已有发令端设备<br><span style="font-size:11px;color:#aaa">请使用其他房间码，或让现有发令端退出后再试</span>';
      DOM.roomStatus.className = 'room-status error';
      showToast('该房间已有发令端设备', 'error');
    } else if (isWsErr) {
      DOM.roomStatus.innerHTML = '⚠️ 服务器未连接（离线模式）<br><span style="font-size:11px;color:#aaa">多设备同步暂不可用，可继续使用本机计时。</span>';
      DOM.roomStatus.className = 'room-status warn';
      // 离线模式下发令端仍可继续
      if (selectedRole === 'start') {
        state.roomLocked = true;
        _updateRoomLockedIndicator();
        DOM.btnRoleConfirm.classList.remove('hidden');
      }
    } else {
      DOM.roomStatus.innerHTML = '⚠️ 连接失败：' + e.message;
      DOM.roomStatus.className = 'room-status warn';
    }
    DOM.btnConnect.disabled  = false;
    // Still allow proceeding — start role can work as standalone timer
    if (selectedRole === 'start' && !isStartLocked) {
      DOM.btnRoleConfirm.classList.remove('hidden');
    }
  }
}

function registerSyncEvents() {
  sync.on('PEER_JOINED', e => {
    state.peerConnected = true;
    const fc = sync.finishPeerCount;
    if (e.role === 'finish') {
      showToast(`终点端已上线（共 ${fc} 个）`, 'success');
      updateConnStatus(true);
      if (DOM.roomStatus) DOM.roomStatus.textContent = `✅ 已连接，终点端 ${fc} 个在线`;
      // Push current config immediately so finish device syncs right away
      if (state.role === 'start') setTimeout(broadcastConfig, 300);
    } else if (e.role === 'observer') {
      showToast('成绩记录端已上线', 'success');
      updateConnStatus(true);
      // 补发本场已完成的所有组成绩，让晚加入的记录端也能看到历史
      if (state.role === 'start' && state.sessionHistory?.length) {
        setTimeout(() => sync.send('RACE_HISTORY', { groups: state.sessionHistory }), 400);
      }
    } else {
      showToast('对端已上线', 'success');
      updateConnStatus(true);
    }
    updateFinishBadge();
  });
  sync.on('PEER_LEFT', e => {
    const fc = sync.finishPeerCount;
    state.peerConnected = sync.peerOnline;
    if (e.role === 'finish') {
      showToast(fc > 0 ? `一个终点端离线（剩余 ${fc} 个）` : '终点端已离线', 'warn');
      // Clear finish device lane sync if no finish devices remain
      if (fc === 0) { state.finishDeviceLanes = null; updateLaneSyncStatus(); }
    } else {
      showToast('对端已离线', 'warn');
    }
    updateConnStatus(sync.peerOnline);
    updateFinishBadge();
  });

  // 监听发令端锁定状态变化
  sync.on('START_DEVICE_LOCKED', () => {
    state.roomLocked = true;
    _updateRoomLockedIndicator();
    showToast('发令端已锁定房间', 'warn');
  });

  // 监听发令端解锁（发令端离开时）
  sync.on('START_DEVICE_UNLOCKED', () => {
    state.roomLocked = false;
    _updateRoomLockedIndicator();
    showToast('发令端已离开，房间解锁', 'success');
  });
  sync.on('DISCONNECTED', () => {
    showToast('⚠️ 连接断开，正在重连...', 'warn');
    updateConnStatus(false);
    if (state.role === 'observer') obsSetConnected(false);
  });
  sync.on('RECONNECTED', () => {
    showToast('✅ 已重新连接', 'success');
    updateConnStatus(true);
    updateLatencyBadge();
    if (state.role === 'observer') obsSetConnected(true);
    if (state.role === 'start') setTimeout(broadcastConfig, 300);
  });

  // ── Observer events ──────────────────────────────────
  sync.on('RACE_CONFIG', e => {
    if (state.role === 'observer') {
      state.obsRaceInfo = e;
      obsUpdateInfoBar();
      obsSetConnected(true);
    }
  });
  sync.on('RACE_START', e => {
    if (state.role === 'observer') {
      state.raceStartServerTime = e._serverTime;
      state.obsResults = [];
      obsRenderTable();
      obsSetState('🏃 比赛进行中...');
      if (DOM.btnObsExport) DOM.btnObsExport.disabled = true;
    }
  });
  sync.on('CROSSING', e => {
    if (state.role === 'observer') {
      state.obsResults.push(e);
      obsRenderTable();
    }
  });
  sync.on('CROSSING_SPLIT', e => {
    if (state.role === 'observer') obsAddSplit(e);
  });
  sync.on('RACE_END', () => {
    if (state.role === 'observer') {
      const ri = state.obsRaceInfo;
      state.obsHistory.unshift({
        round:   ri.round || state.currentRound,
        group:   ri.group || state.currentGroup,
        dist:    ri.distance,
        results: [...state.obsResults],
      });
      obsRenderHistory();
      obsSetState('✅ 比赛结束 — 可导出');
      if (DOM.btnObsExport) DOM.btnObsExport.disabled = false;
    }
  });
  sync.on('LANE_DNF', e => {
    if (state.role === 'observer') {
      state.obsResults.push({ ...e, isDNF: true });
      obsRenderTable();
    }
  });

  // ── 成绩历史补发（晚加入的记录端接收历史）──────────────
  sync.on('RACE_HISTORY', e => {
    if (state.role !== 'observer') return;
    if (!Array.isArray(e.groups)) return;
    // Prepend historical groups, avoiding duplicates
    const existingIds = new Set(state.obsHistory.map(g => g.id));
    e.groups.forEach(g => {
      if (!existingIds.has(g.id)) {
        state.obsHistory.push({
          id:      g.id,
          round:   g.round,
          group:   g.group,
          dist:    g.distance,
          results: g.results || [],
        });
        existingIds.add(g.id);
      }
    });
    state.obsHistory.sort((a, b) => (b.id || 0) - (a.id || 0));
    obsRenderHistory();
    showToast(`📋 已接收 ${e.groups.length} 组历史成绩`, 'success');
  });

  sync.on('RACE_GROUP_RESULT', e => {
    if (state.role !== 'observer') return;
    const existingIds = new Set(state.obsHistory.map(g => g.id));
    if (!existingIds.has(e.id)) {
      state.obsHistory.unshift({
        id:      e.id,
        round:   e.round,
        group:   e.group,
        dist:    e.distance,
        results: e.results || [],
      });
      obsRenderHistory();
    }
  });

  sync.on('RACE_CONFIG', e => {
    if (state.role !== 'finish') return;
    if (e.lapsNeeded)  state.lapCount    = e.lapsNeeded;
    if (e.distance)    state.distance    = e.distance;
    if (e.trackLength) state.trackLength = e.trackLength;

    // ── 道次：发令端的最终设置优先（操作员的决定）──────────
    // The operator on the start device makes the final call on lane count.
    // Auto-detect is a suggestion that gets adopted, but manual changes override it.
    // Show a toast if the incoming count differs from what we auto-detected.
    if (Array.isArray(e.roster) && e.roster.length) {
      const incomingCount = e.roster.length;
      if (state.autoDetectedLanes && incomingCount !== state.autoDetectedLanes) {
        showToast(`⚙️ 发令端设置 ${incomingCount} 道（摄像头识别 ${state.autoDetectedLanes} 道）`, 'info');
      }
      state.laneCount = incomingCount;
      state.lanes = e.roster.map(r => ({
        id: r.id, name: r.name, time: null, rank: null, dnf: false, lapTimes: [], currentLap: 0,
      }));
    } else if (e.laneCount && e.laneCount !== state.laneCount) {
      if (state.autoDetectedLanes && e.laneCount !== state.autoDetectedLanes) {
        showToast(`⚙️ 发令端设置 ${e.laneCount} 道（摄像头识别 ${state.autoDetectedLanes} 道）`, 'info');
      }
      state.laneCount = e.laneCount;
    }

    // Re-init detector with current lane count (only when not mid-race)
    if (!state.raceStarted && DOM.finishVideoFs?.srcObject) {
      detector.stop();
      detector.init(DOM.finishVideoFs, DOM.finishCanvasFs, state.laneCount);
      detector.bindDrag(DOM.finishCanvasFs);
      detector.start(null, level => {
        const pct = Math.min(100, level * 100);
        if (DOM.fsLevelFill) DOM.fsLevelFill.style.width = `${pct}%`;
      });
    }

    // Show confirmed config in status label
    if (DOM.fsStateLabel && !state.raceStarted) {
      const lapStr = state.lapCount > 1 ? ` · ${state.lapCount}圈` : '';
      const srcTag = state.autoDetectedLanes ? '📷' : '📡';
      DOM.fsStateLabel.textContent = `✅ ${srcTag} ${state.laneCount}道 · ${state.distance}m${lapStr} 已就绪`;
      DOM.fsStateLabel.style.color = 'var(--green)';
      setTimeout(() => { if (DOM.fsStateLabel) DOM.fsStateLabel.style.color = ''; }, 1500);
    }
  });
  sync.on('RACE_START', e => {
    state.raceStartServerTime = e._serverTime;
    if (state.role === 'finish') onFinishDeviceRaceStart(e);
    if (state.role === 'start')  { /* start device sent this, timer already running */ }
  });
  sync.on('CROSSING_SPLIT', e => {
    if (state.role === 'start') onStartDeviceReceiveSplit(e);
  });
  sync.on('LANE_DNF', e => {
    if (state.role !== 'finish') return;
    const laneIdx = e.laneIdx;
    // Mark lane as fully done so finish device doesn't wait for it
    state.laneCrossings[laneIdx] = state.lapCount;
    state.lanesDone++;
    showToast(`${e.athleteName || `道次${laneIdx+1}`} 已弃赛`, 'warn');
    if (state.lanesDone >= state.laneCount) setTimeout(onFinishDeviceRaceEnd, 800);
  });
  sync.on('CROSSING', e => {
    if (state.role === 'start') onStartDeviceReceiveCrossing(e);
  });
  sync.on('RACE_END', () => {
    if (state.role === 'finish') onFinishDeviceRaceEnd();
  });
  // ── 自动识别道次：终点端执行 → 发令端接收结果 ──────────
  sync.on('AUTO_DETECT_REQUEST', () => {
    if (state.role !== 'finish') return;
    const result = detector.autoDetectLanes(8);
    if (result) {
      state.laneCount = result.lanes;
      showToast(`📐 识别到 ${result.lanes} 条跑道`, 'success');
      updateLaneStatusBar();
      sync.send('AUTO_DETECT_RESULT', { lanes: result.lanes });
    } else {
      showToast('自动识别失败，请确保跑道清晰可见', 'warn');
      sync.send('AUTO_DETECT_RESULT', { lanes: null });
    }
  });

  sync.on('AUTO_DETECT_RESULT', e => {
    if (state.role !== 'start') return;
    if (e.lanes) {
      const prev = state.laneCount;
      state.finishDeviceLanes = e.lanes;
      // ── 自动采用终点端识别结果：终点端看得见跑道，是道次权威 ──
      state.laneCount = e.lanes;
      DOM.laneCountDisp.textContent = e.lanes;
      buildLaneInputs(); saveSettings(); broadcastConfig();
      updateLaneSyncStatus();
      if (prev !== e.lanes) {
        showToast(`📷 终点端识别到 ${e.lanes} 道，已自动同步`, 'success');
      } else {
        showToast(`✅ 终点端已同步：${e.lanes} 条跑道`, 'success');
      }
    } else {
      showToast('终点端识别失败，请手动设置道次', 'warn');
    }
  });

  sync.on('RACE_ABORT', () => {
    if (state.role === 'finish') {
      // Reset finish device back to waiting state
      state.raceStarted  = false;
      state.raceFinished = false;
      state.laneCrossings       = {};
      state.laneLastCrossingTime = {};
      state.lanesDone            = 0;
      if (DOM.fsResults) DOM.fsResults.innerHTML = '';
      if (DOM.fsEnd)     DOM.fsEnd.classList.add('hidden');
      if (DOM.fsStateLabel) DOM.fsStateLabel.textContent = '⚠️ 比赛召回 — 等待重新发令';
      for (let i = 0; i < state.laneCount; i++) {
        const btn = $(`fs-btn-done-${i}`);
        if (btn) btn.disabled = false;
      }
      starterAudio.playRecall();
      showToast('⚠️ 比赛召回，等待重新发令', 'warn');
    }
    if (state.role === 'observer') {
      state.obsResults = [];
      obsRenderTable();
      obsSetState('⚠️ 比赛召回，等待重新发令');
    }
  });
}

// ── WeChat warning overlay ─────────────────────────────
function showWeChatWarning() {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.style.cssText = 'z-index:9999;flex-direction:column;gap:16px;padding:24px;text-align:center';
  ov.innerHTML = `
    <div style="font-size:48px">📱</div>
    <div style="font-size:18px;font-weight:700;color:#ff6200">请用手机浏览器打开</div>
    <div style="font-size:14px;color:#888;line-height:1.7">
      微信内置浏览器不支持摄像头和麦克风。<br>
      请点击右上角 <b style="color:#fff">···</b> → <b style="color:#fff">在浏览器中打开</b>
    </div>
    <div style="font-size:13px;color:#555;margin-top:8px">
      iOS: Safari &nbsp;|&nbsp; Android: Chrome
    </div>`;
  document.getElementById('app').appendChild(ov);
}

// ── Confirm role and proceed ───────────────────────────
function confirmRole() {
  state.role = selectedRole;
  DOM.roleOverlay.classList.add('hidden');

  if (state.role === 'solo' || state.role === 'start') {
    DOM.tabBarStart.classList.remove('hidden');
    DOM.appTitle.textContent = state.role === 'start' ? '🔫 发令端' : '竞迹';
    if (state.roomCode) {
      DOM.syncBadge.classList.remove('hidden');
      DOM.syncRoom.textContent = state.roomCode;
    }
  } else if (state.role === 'finish') {
    DOM.tabBarStart.classList.add('hidden');
    DOM.appTitle.textContent = '🏁 终点端';
    DOM.syncBadge.classList.remove('hidden');
    DOM.syncRoom.textContent = state.roomCode;
    $('tab-finish-main').classList.remove('hidden');
    const fsRoomBadge = $('fs-room-badge');
    if (fsRoomBadge) fsRoomBadge.textContent = state.roomCode;
  } else if (state.role === 'observer') {
    DOM.tabBarStart.classList.add('hidden');
    DOM.appTitle.textContent = '📋 成绩端';
    DOM.syncBadge.classList.remove('hidden');
    DOM.syncRoom.textContent = state.roomCode;
    $('tab-observer-main').classList.remove('hidden');
    if (DOM.obsRoomBadge) DOM.obsRoomBadge.textContent = `房间 ${state.roomCode}`;
  }

  // Auto-request permissions immediately — no extra overlay click needed
  requestPermissions();
}

// ── Permissions ────────────────────────────────────────
async function requestPermissions() {
  DOM.permOverlay.classList.add('hidden');

  if (!navigator.mediaDevices?.getUserMedia) {
    showToast(isHTTPS() ? '浏览器不支持摄像头' : '需要HTTPS才能使用摄像头，请用浏览器打开', 'warn');
    return;
  }

  // Request mic
  let audioStream = null;
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    state.micGranted = true;
    setStatusPill('mic', true);
  } catch {
    state.micGranted = false;
    setStatusPill('mic', false);
  }

  // Request camera — try multiple constraint levels as fallback
  let videoStream = null;
  const camConstraints = [
    { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } },
    { video: { facingMode: 'environment' } },
    { video: { facingMode: 'user' } },
    { video: true },
  ];
  for (const c of camConstraints) {
    try {
      videoStream = await navigator.mediaDevices.getUserMedia(c);
      state.camGranted = true;
      state.facingMode = (c.video?.facingMode) || state.facingMode;
      setStatusPill('cam', true);
      break;
    } catch { videoStream = null; }
  }
  if (!videoStream) {
    state.camGranted = false;
    setStatusPill('cam', false);
    const hint = !isHTTPS() ? '（HTTP模式下iOS不支持摄像头，安卓可用）' : '';
    showToast(`摄像头未能启动${hint}`, 'warn');
  }

  // Merge into combined stream
  const tracks = [];
  if (audioStream) audioStream.getAudioTracks().forEach(t => tracks.push(t));
  if (videoStream) videoStream.getVideoTracks().forEach(t => tracks.push(t));
  if (tracks.length) mainStream = new MediaStream(tracks);

  // Init audio detection
  if (state.micGranted && mainStream) {
    try { await audio.initFromStream(mainStream); startAudioMonitor(); } catch {}
  }

  // Attach camera to UI
  if (state.camGranted && mainStream) {
    recorder.initFromStream(mainStream);
    if (state.role === 'finish') {
      setupFinishCamera();
    } else {
      DOM.setupVideo.srcObject = mainStream;
      DOM.setupVideo.classList.add('active');
      DOM.camPlaceholder.style.display = 'none';
      DOM.btnFlipCam.classList.remove('hidden');
      DOM.raceVideo.srcObject = mainStream;
      DOM.camOffMsg.style.display = 'none';

      // Detector init happens in enterRace() once the race tab is visible
    }
  } else {
    if (state.role !== 'finish') {
      DOM.chkVideo.checked = false;
      state.videoEnabled   = false;
    }
  }
}

// ── Finish device camera setup ─────────────────────────
function setupFinishCamera() {
  DOM.finishVideoFs.srcObject = mainStream;

  const resizeCanvas = () => {
    const c = DOM.finishCanvasFs;
    // Use the element's actual CSS pixel size — reliable in all orientations.
    // Fall back to window dimensions only if layout hasn't run yet.
    const w = c.offsetWidth  || window.innerWidth;
    const h = c.offsetHeight || window.innerHeight;
    if (w > 0 && h > 0) {
      c.width  = Math.round(w * devicePixelRatio);
      c.height = Math.round(h * devicePixelRatio);
    }
    c.style.width  = '100%';
    c.style.height = '100%';
  };
  setTimeout(resizeCanvas, 200);
  // orientationchange fires before layout updates; wait 350 ms for the new dimensions
  window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 350));
  window.addEventListener('resize', () => setTimeout(resizeCanvas, 50));
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resizeCanvas).observe(DOM.finishCanvasFs);
  }

  detector.init(DOM.finishVideoFs, DOM.finishCanvasFs, state.laneCount);
  detector.bindDrag(DOM.finishCanvasFs);

  // ── Auto-detect lanes when the first video frame is ready ──────────────
  const tryAutoDetect = () => {
    if (state.raceStarted) return;   // don't disturb an active race
    const result = detector.autoDetectLanes(8);
    if (result) {
      state.laneCount         = result.lanes;
      state.autoDetectedLanes = result.lanes;  // mark finish device as authoritative
      showToast(`📐 自动识别到 ${result.lanes} 条跑道`, 'success');
      updateLaneStatusBar();
      if (sync.connected) sync.send('AUTO_DETECT_RESULT', { lanes: result.lanes });
    }
    // Show floating auto-detect button once camera is ready
    const pill = $('fs-auto-pill');
    if (pill) pill.classList.remove('hidden');
  };
  // First attempt after metadata loads (gives video dimensions)
  DOM.finishVideoFs.addEventListener('loadedmetadata', () => setTimeout(tryAutoDetect, 800), { once: true });
  // Second attempt after first paint (frame data available)
  DOM.finishVideoFs.addEventListener('canplay', () => setTimeout(tryAutoDetect, 1500), { once: true });

  // Preview monitoring — no crossing callbacks until race starts
  detector.start(null, (level) => {
    const pct = Math.min(100, level * 100);
    if (DOM.fsLevelFill) DOM.fsLevelFill.style.width = `${pct}%`;
    if (DOM.fsDetectStatus) DOM.fsDetectStatus.textContent =
      level > 0.3 ? `🔴 检测到动作 (${Math.round(pct)}%)` : `🟢 监听中 (${Math.round(pct)}%)`;
  });

  if (DOM.fsStateLabel) DOM.fsStateLabel.textContent = '摄像头就绪，等待连接...';
}

// ── Audio monitor ──────────────────────────────────────
function startAudioMonitor() {
  if (!audio.ready) return;
  audio.resume();
  audio.startMonitor(
    () => { if (state.startMode === 'audio' && !state.raceStarted) beginRace(); },
    (level, waveform) => {
      updateLevelBar(level);
      if (state.raceStarted && !state.raceFinished) drawVisualizer(waveform);
    }
  );
}

function updateLevelBar(level) {
  const pct = Math.min(100, level * 100 * 2.5);
  if (DOM.levelFill) DOM.levelFill.style.width = `${pct}%`;
  if (DOM.monitorStatus) DOM.monitorStatus.textContent =
    level >= audio.threshold ? '🔊 检测到声音！' : `🎤 监听中... (${Math.round(pct)}%)`;
}

function drawVisualizer(data) {
  const canvas = DOM.visualizer;
  const ctx    = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth * devicePixelRatio || 360;
  const H = canvas.height = 52 * devicePixelRatio;
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath(); ctx.strokeStyle = '#00e676'; ctx.lineWidth = 2;
  const sw = W / data.length;
  for (let i = 0; i < data.length; i++) {
    const y = (data[i] / 255) * H;
    i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * sw, y);
  }
  ctx.stroke();
  const thY = (1 - audio.threshold * 0.5) * H;
  ctx.strokeStyle = 'rgba(255,98,0,0.5)'; ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(0, thY); ctx.lineTo(W, thY); ctx.stroke();
  ctx.setLineDash([]);
}

// ── Start/Solo device race flow ────────────────────────
function buildLaneInputs() {
  DOM.laneInputs.innerHTML = '';
  for (let i = 0; i < state.laneCount; i++) {
    const row = document.createElement('div');
    row.className = 'lane-input-row';
    row.innerHTML = `<div class="lane-num">${i+1}</div>
      <input type="text" id="lane-input-${i}" placeholder="运动员 ${i+1}" value="运动员 ${i+1}">`;
    DOM.laneInputs.appendChild(row);
  }
  // Sync name changes to finish device in real time
  DOM.laneInputs.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', debouncedBroadcastConfig);
  });
}

function buildLanes() {
  state.lanes = Array.from({ length: state.laneCount }, (_, i) => {
    const input = $(`lane-input-${i}`);
    return {
      id: i,
      name: input ? input.value.trim() || `运动员 ${i+1}` : `运动员 ${i+1}`,
      time: null, rank: null, dnf: false,
      lapTimes: [],   // ms for each completed lap
      currentLap: 0,
    };
  });
}

function renderLaneCards() {
  DOM.lanesWrap.innerHTML = '';
  const multiLap = state.lapCount > 1;
  state.lanes.forEach((lane, idx) => {
    const card = document.createElement('div');
    card.className = 'lane-card';
    card.id        = `lane-card-${lane.id}`;
    card.style.animationDelay = `${idx * 40}ms`;
    card.innerHTML = `
      <div class="lane-num-badge">${lane.id+1}</div>
      <div class="lane-info">
        <div class="lane-name">${lane.name}</div>
        <div class="lane-time" id="lane-time-${lane.id}">等待发令...</div>
        ${multiLap ? `<div class="lane-lap-info" id="lane-lap-${lane.id}">圈 0/${state.lapCount}</div>` : ''}
        <div class="lane-laps" id="lane-laps-${lane.id}"></div>
      </div>
      <span class="lane-rank" id="lane-rank-${lane.id}"></span>
      <div class="lane-btns">
        <button class="btn-finish" id="btn-finish-${lane.id}" disabled>${multiLap ? '过线' : '到达终点'}</button>
        <button class="btn-dnf hidden" id="btn-dnf-${lane.id}">DNF</button>
      </div>`;
    DOM.lanesWrap.appendChild(card);
    card.querySelector(`#btn-finish-${lane.id}`)
        .addEventListener('click', () => finishLane(lane.id));
    card.querySelector(`#btn-dnf-${lane.id}`)
        .addEventListener('click', () => markDNF(lane.id));
  });
}

function finishLane(id) {
  if (!state.raceStarted || state.raceFinished) return;
  const lane = state.lanes[id];
  if (lane.time !== null) return;

  const elapsed = timer.lap();
  lane.currentLap++;
  lane.lapTimes.push(elapsed - (lane.lapTimes.reduce((s,t) => s+t, 0)));

  const lapInfoEl = $(`lane-lap-${id}`);
  const lapsEl    = $(`lane-laps-${id}`);

  if (lane.currentLap < state.lapCount) {
    // Mid-race lap — show split, keep running
    const lapMs = lane.lapTimes[lane.lapTimes.length - 1];
    if (lapInfoEl) lapInfoEl.textContent = `圈 ${lane.currentLap}/${state.lapCount}`;
    if (lapsEl) {
      const sp = document.createElement('span');
      sp.className = 'lap-split';
      sp.textContent = `第${lane.currentLap}圈 ${PrecisionTimer.formatFull(lapMs)}`;
      lapsEl.appendChild(sp);
    }
    showToast(`${lane.name} 第${lane.currentLap}圈 ${PrecisionTimer.formatFull(lapMs)}`, 'success');
    return;
  }

  // Final lap — finish
  lane.time = elapsed;
  lane.rank = state.lanes.filter(l => l.time !== null).length;

  const card   = $(`lane-card-${id}`);
  const timeEl = $(`lane-time-${id}`);
  const rankEl = $(`lane-rank-${id}`);
  const btn    = $(`btn-finish-${id}`);
  if (card) { card.classList.add('finished'); if (lane.rank === 1) card.classList.add('gold'); }
  if (timeEl) { timeEl.textContent = PrecisionTimer.formatFull(lane.time); timeEl.style.color = '#00e676'; }
  if (rankEl) rankEl.textContent = ['🥇','🥈','🥉'][lane.rank-1] || `#${lane.rank}`;
  if (lapInfoEl) lapInfoEl.textContent = `完成 ${state.lapCount}/${state.lapCount}圈`;
  if (btn) { btn.disabled = true; btn.textContent = '✓ 已完成'; }

  // Show final lap split
  const finalLapMs = lane.lapTimes[lane.lapTimes.length - 1];
  if (lapsEl) {
    const sp = document.createElement('span');
    sp.className = 'lap-split';
    sp.textContent = `第${lane.currentLap}圈 ${PrecisionTimer.formatFull(finalLapMs)}`;
    lapsEl.appendChild(sp);
  }

  showToast(`${lane.name}  ${PrecisionTimer.formatFull(lane.time)}`, 'success');
  if (state.lanes.every(l => l.time !== null || l.dnf)) setTimeout(endRace, 600);
}

function markDNF(id) {
  if (!state.raceStarted || state.raceFinished) return;
  const lane = state.lanes[id];
  if (!lane || lane.time !== null || lane.dnf) return;
  if (!confirm(`确认 ${lane.name} 弃赛（DNF）？\n当前已完成 ${lane.currentLap}/${state.lapCount} 圈`)) return;

  lane.dnf = true;

  const card    = $(`lane-card-${id}`);
  const timeEl  = $(`lane-time-${id}`);
  const lapEl   = $(`lane-lap-${id}`);
  const btn     = $(`btn-finish-${id}`);
  const dnfBtn  = $(`btn-dnf-${id}`);
  if (card)   { card.classList.add('dnf'); }
  if (timeEl) { timeEl.textContent = 'DNF'; timeEl.style.color = 'var(--text-muted)'; }
  if (lapEl)  lapEl.textContent = '已弃赛';
  if (btn)    { btn.disabled = true; btn.textContent = 'DNF'; }
  if (dnfBtn) dnfBtn.classList.add('hidden');

  if (state.role === 'start') sync.send('LANE_DNF', { laneIdx: id, athleteName: lane.name });

  showToast(`${lane.name} 已标记弃赛`, 'warn');
  if (state.lanes.every(l => l.time !== null || l.dnf)) setTimeout(endRace, 600);
}

// ── Race Abort (召回重来) ──────────────────────────────
function abortRace() {
  if (!state.raceStarted || state.raceFinished) return;

  // Five rapid beeps = recall signal
  starterAudio.playRecall();
  if (navigator.vibrate) navigator.vibrate([80, 40, 80, 40, 80, 40, 80, 40, 80]);

  state.raceStarted  = false;
  state.raceFinished = false;
  timer.stop();
  if (recorder.recording) recorder.stop();

  DOM.timerDisplay.classList.remove('running', 'stopped');
  DOM.timerSub.textContent = '⚠️ 比赛已召回 — 等待重新发令';
  DOM.btnStart.classList.remove('hidden');
  DOM.btnStop.classList.add('hidden');
  DOM.btnAbort?.classList.add('hidden');
  DOM.recBadge.classList.add('hidden');

  // Reset every lane card to pre-race state
  state.lanes.forEach(l => {
    l.time = null; l.rank = null; l.dnf = false;
    l.lapTimes = []; l.currentLap = 0;
    const card   = $(`lane-card-${l.id}`);
    const timeEl = $(`lane-time-${l.id}`);
    const rankEl = $(`lane-rank-${l.id}`);
    const lapEl  = $(`lane-lap-${l.id}`);
    const lapsEl = $(`lane-laps-${l.id}`);
    const btn    = $(`btn-finish-${l.id}`);
    const dnfBtn = $(`btn-dnf-${l.id}`);
    if (card)   { card.className = 'lane-card'; card.style.animationDelay = ''; }
    if (timeEl) { timeEl.textContent = '等待发令...'; timeEl.style.color = ''; }
    if (rankEl) rankEl.textContent = '';
    if (lapEl)  lapEl.textContent  = `圈 0/${state.lapCount}`;
    if (lapsEl) lapsEl.innerHTML   = '';
    if (btn)    { btn.disabled = true; btn.textContent = state.lapCount > 1 ? '过线' : '到达终点'; }
    if (dnfBtn) dnfBtn.classList.add('hidden');
  });

  // Solo mode: stop detector, restart preview
  if (state.role === 'solo' && DOM.raceCanvas) {
    detector.stop();
    detector.init(DOM.raceVideo, DOM.raceCanvas, state.laneCount);
    detector.start(null, (level) => {
      const pct = Math.min(100, level * 100);
      DOM.timerSub.textContent = level > 0.25
        ? `🔴 终点线检测到动作 (${Math.round(pct)}%)`
        : `🟢 终点线监听中`;
    });
  }

  if (state.role === 'start') sync.send('RACE_ABORT', {});
  showToast('⚠️ 比赛已召回，重新发令即可', 'warn');
}

// ── Close-finish arbitration (接近冲线仲裁) ───────────
let _cfPending = null;  // { firstLane, secondLane }

function showCloseFinish(firstLane, secondLane, diffMs) {
  // Only relevant on start device (manual finish buttons)
  if (state.role !== 'solo' && state.role !== 'start') return;
  const lanes  = state.lanes;
  const l1     = lanes[firstLane];
  const l2     = lanes[secondLane];
  if (!l1 || !l2) return;
  if (l1.time === null || l2.time === null) return;  // both must already be recorded

  _cfPending = { firstLane, secondLane };

  const medals = ['🥇','🥈','🥉'];
  const chip = (l) => `<div class="cf-lane-chip">
    <div class="cf-rank">${medals[l.rank-1] || `#${l.rank}`}</div>
    <div class="cf-name">${l.name}</div>
    <div class="cf-time">${PrecisionTimer.formatFull(l.time)}</div>
  </div>`;

  const ol = $('close-finish-overlay');
  const info = $('cf-info');
  const lanesEl = $('cf-lanes');
  if (!ol || !info || !lanesEl) return;

  info.textContent    = `差距仅 ${diffMs}ms，请确认名次`;
  lanesEl.innerHTML   = chip(l1) + chip(l2);
  ol.classList.remove('hidden');
}

function hideCloseFinish() {
  $('close-finish-overlay')?.classList.add('hidden');
  _cfPending = null;
}

function swapCloseFinish() {
  if (!_cfPending) return;
  const { firstLane, secondLane } = _cfPending;
  const l1 = state.lanes[firstLane];
  const l2 = state.lanes[secondLane];
  if (!l1 || !l2) { hideCloseFinish(); return; }

  // Swap times and ranks
  [l1.time, l2.time] = [l2.time, l1.time];
  [l1.rank, l2.rank] = [l2.rank, l1.rank];

  // Update lane card UI for both
  [firstLane, secondLane].forEach(idx => {
    const l      = state.lanes[idx];
    const timeEl = $(`lane-time-${idx}`);
    const rankEl = $(`lane-rank-${idx}`);
    const card   = $(`lane-card-${idx}`);
    if (timeEl) timeEl.textContent = PrecisionTimer.formatFull(l.time);
    if (rankEl) rankEl.textContent = ['🥇','🥈','🥉'][l.rank-1] || `#${l.rank}`;
    if (card)   { card.classList.toggle('gold', l.rank === 1); }
  });

  hideCloseFinish();
  showToast('✅ 名次已交换', 'success');
}

let _lastCrossingForArb = null;  // { laneIdx, raceTime } for close-finish check

// When start device receives a crossing from finish device
function onStartDeviceReceiveCrossing(event) {
  // event: { laneIdx, raceTime, athleteName, rank }
  const laneIdx = event.laneIdx;
  const lane    = state.lanes[laneIdx] || state.lanes[state.lanes.length - 1];
  if (!lane || lane.time !== null) return;

  lane.time = event.raceTime;
  lane.rank = event.rank;

  // Check for close finish with the previous crossing
  if (_lastCrossingForArb !== null) {
    const diffMs = Math.abs(event.raceTime - _lastCrossingForArb.raceTime);
    if (diffMs < 300) {
      showCloseFinish(_lastCrossingForArb.laneIdx, laneIdx, Math.round(diffMs));
    }
  }
  _lastCrossingForArb = { laneIdx, raceTime: event.raceTime };

  const card   = $(`lane-card-${laneIdx}`);
  const timeEl = $(`lane-time-${laneIdx}`);
  const rankEl = $(`lane-rank-${laneIdx}`);
  const btn    = $(`btn-finish-${laneIdx}`);
  if (card) {
    card.classList.add('finished');
    if (lane.rank === 1) card.classList.add('gold');
  }
  if (timeEl) { timeEl.textContent = PrecisionTimer.formatFull(lane.time); timeEl.style.color = '#00e676'; }
  if (rankEl) rankEl.textContent = ['🥇','🥈','🥉'][lane.rank-1] || `#${lane.rank}`;
  if (btn)    { btn.disabled = true; btn.textContent = '✓ 终点确认'; }
  const lapInfoEl2 = $(`lane-lap-${laneIdx}`);
  if (lapInfoEl2) lapInfoEl2.textContent = `完成 ${state.lapCount}/${state.lapCount}圈`;

  DOM.timerSub.textContent = `${lane.name} 冲线：${PrecisionTimer.formatFull(lane.time)}`;
  showToast(`🏁 ${lane.name} 冲线！${PrecisionTimer.formatFull(lane.time)}`, 'success');

  if (state.lanes.every(l => l.time !== null || l.dnf)) setTimeout(endRace, 800);
}

function onStartDeviceReceiveSplit(event) {
  const laneIdx = event.laneIdx;
  const lane    = state.lanes[laneIdx];
  if (!lane || lane.time !== null) return;

  lane.currentLap = event.lapNum;

  const lapInfoEl = $(`lane-lap-${laneIdx}`);
  const lapsEl    = $(`lane-laps-${laneIdx}`);
  const timeEl    = $(`lane-time-${laneIdx}`);

  if (lapInfoEl) lapInfoEl.textContent = `圈 ${event.lapNum}/${state.lapCount}`;
  if (timeEl)   timeEl.textContent = PrecisionTimer.formatFull(event.raceTime);
  if (lapsEl) {
    const sp = document.createElement('span');
    sp.className = 'lap-split';
    sp.textContent = `第${event.lapNum}圈 ${PrecisionTimer.formatFull(event.raceTime)}`;
    lapsEl.appendChild(sp);
  }

  showToast(`${lane.name} 第${event.lapNum}圈 ${PrecisionTimer.formatFull(event.raceTime)}`, 'info');
}

async function enterRace() {
  buildLanes();
  renderLaneCards();
  showTab('race');
  if (state.camGranted && mainStream) {
    DOM.raceVideo.srcObject = mainStream;
    DOM.camOffMsg.style.display = 'none';
  }
  DOM.vizWrap.classList.toggle('hidden', state.startMode !== 'audio');
  resetTimerUI();

  // Init finish-line canvas now that the race tab is visible (offsetWidth/Height are correct)
  if (state.role !== 'finish' && state.camGranted && DOM.raceCanvas) {
    _initRaceCanvas();
  }
}

// 进入练习模式
async function enterPracticeMode() {
  state.practiceMode = true;
  state.currentGroup = 0; // 练习不计入正式组别

  // 更新UI
  const card = $('practice-mode-card');
  if (card) {
    card.classList.add('practice-mode-active');
    card.querySelector('.practice-title').innerHTML = '🏃 练习模式 <span class="practice-badge">进行中</span>';
  }

  // 显示提示
  showToast('已进入练习模式，成绩不计入正式记录', 'info');

  // 进入比赛界面
  await enterRace();

  // 更新计时器显示为练习模式
  if (DOM.timerSub) {
    DOM.timerSub.textContent = '🔔 练习模式 - 请测试发令';
  }
}

function _initRaceCanvas() {
  if (!DOM.raceCanvas || !DOM.raceVideo) return;
  const wrap = DOM.raceVideo.parentElement;
  const w = wrap.offsetWidth  || DOM.raceVideo.offsetWidth  || 640;
  const h = wrap.offsetHeight || DOM.raceVideo.offsetHeight || 360;
  const dpr = window.devicePixelRatio || 1;
  DOM.raceCanvas.width  = Math.round(w * dpr);
  DOM.raceCanvas.height = Math.round(h * dpr);
  DOM.raceCanvas.style.width  = '100%';
  DOM.raceCanvas.style.height = '100%';
  detector.stop();
  detector.init(DOM.raceVideo, DOM.raceCanvas, state.laneCount);
  detector.bindDrag(DOM.raceCanvas);
  detector.start(null, null); // preview mode: draws finish line, no crossing callbacks
}

// ── Minimum race time (grace period) per distance ─────────────────────────────
// Based on near-world-record times: any crossing before this time after the gun
// is a false trigger (athletes still at start, start-line = finish-line layout, etc.)
// Values are intentionally slightly below world records to stay safe for all levels.
function minRaceGraceMs(distanceM) {
  const table = {
     50:  5000,   // 5 s  (WR: 5.56 s)
     60:  6000,   // 6 s  (WR: 6.34 s)
     80:  7500,   // 7.5 s
    100:  9500,   // 9.5 s (WR: 9.58 s)
    150: 13500,   // 13.5 s
    200: 18000,   // 18 s  (WR: 19.19 s — fixed! old formula gave 20 s)
    300: 30000,   // 30 s
    400: 43000,   // 43 s  (WR: 43.03 s — fixed! old formula gave 40 s)
    800: 101000,  // 101 s (WR: 101.73 s)
   1000: 131000,
   1500: 205000,
   3000: 450000,
   5000: 780000,
  };
  // Fallback: 90 ms per metre (≈ 11.1 m/s average pace, well within human limits)
  return table[distanceM] ?? Math.max(3000, distanceM * 90);
}

function beginRace() {
  if (state.raceStarted) return;

  // ── 道次不一致警告（发令端 vs 终点端）──────────────────
  if (state.role === 'start' && state.finishDeviceLanes !== null
      && state.finishDeviceLanes !== state.laneCount) {
    const ok = confirm(
      `⚠️ 道次不一致！\n\n` +
      `发令端：${state.laneCount} 道\n` +
      `终点端：${state.finishDeviceLanes} 道\n\n` +
      `建议先统一道次再发令。\n点「取消」返回修改，点「确定」强制继续（以发令端 ${state.laneCount} 道为准）。`
    );
    if (!ok) return;  // user chose to go back and fix
  }

  // 使用专业发令音效序列
  _runProfessionalStarterSequence();
}

async function _runProfessionalStarterSequence() {
  const isLong = state.distance > 400;
  state.raceStarted = true;
  state.raceFinished = false;
  state.raceStartServerTime = sync.serverNow();
  _lastCrossingForArb = null;

  try {
    // 各就位
    DOM.timerSub.textContent = '📢 各就位...';
    await starterAudio.playGeJiuWei();

    if (!isLong) {
      // 短跑: 等2秒 → 预备
      await new Promise(r => setTimeout(r, 2000));
      DOM.timerSub.textContent = '📢 预备...';
      await starterAudio.playYuBei();
      // 等1.5~2.5秒随机 → 枪声
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
    } else {
      // 长跑: 等2~3秒 → 直接枪声
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
    }
    // 枪声 = 计时开始
    DOM.timerSub.textContent = '🔫 枪响！';
    await starterAudio.playGunshot();
  } catch {}

  if (navigator.vibrate) navigator.vibrate([50, 30, 50, 30, 200]);
  timer.start();
  DOM.timerDisplay.classList.add('running');
  DOM.timerSub.textContent = '计时中...';
  DOM.btnStart.classList.add('hidden');
  DOM.btnStop.classList.remove('hidden');
  DOM.btnAbort?.classList.remove('hidden');

  if (state.videoEnabled && state.camGranted && recorder.hasVideo) {
    recorder.start();
    DOM.recBadge.classList.remove('hidden');
  }
  state.lanes.forEach(l => {
    const btn    = $(`btn-finish-${l.id}`);
    const dnfBtn = $(`btn-dnf-${l.id}`);
    if (btn)    btn.disabled = false;
    if (dnfBtn) dnfBtn.classList.remove('hidden');
  });

  // Solo mode: stop preview loop first, then start with crossing callbacks
  if (state.role === 'solo' && state.camGranted && DOM.raceCanvas) {
    detector.stop();  // must stop preview loop before starting detection loop
    const graceMs = state.lapCount > 1 ? 8000 : Math.round(minRaceGraceMs(state.distance) * 0.70);
    const graceUntil = performance.now() + graceMs;
    detector.cooldownMs = state.lapCount > 1 ? 3000 : 1500;
    DOM.timerSub.textContent = '📷 保护期 ' + Math.ceil(graceMs / 1000) + 's...';
    detector.start(
      (laneIdx) => {
        if (performance.now() < graceUntil) return;
        if (laneIdx < state.laneCount) finishLane(laneIdx);
      },
      (level) => {
        if (performance.now() < graceUntil) {
          const secLeft = Math.ceil((graceUntil - performance.now()) / 1000);
          DOM.timerSub.textContent = `📷 保护期 ${secLeft}s — 忽略误触发`;
          return;
        }
        const pct = Math.min(100, level * 100);
        DOM.timerSub.textContent = level > 0.3 ? `🔴 冲线检测 (${Math.round(pct)}%)` : `🟢 终点监听中`;
      }
    );
  }

  // Broadcast race config + start signal to finish device
  if (state.role === 'start') {
    sync.send('RACE_CONFIG', {
      lapsNeeded:  state.lapCount,
      distance:    state.distance,
      trackLength: state.trackLength,
      roster:      state.lanes.map(l => ({ id: l.id, name: l.name })),
    });
    sync.send('RACE_START', { serverTime: state.raceStartServerTime });
  }
}

async function endRace() {
  if (state.raceFinished) return;
  state.raceFinished = true;
  timer.stop();
  DOM.timerDisplay.classList.remove('running');
  DOM.timerDisplay.classList.add('stopped');
  DOM.timerSub.textContent = '比赛结束';
  DOM.btnStop.classList.add('hidden');
  DOM.btnAbort?.classList.add('hidden');
  DOM.recBadge.classList.add('hidden');
  state.lanes.forEach(l => {
    const btn    = $(`btn-finish-${l.id}`);
    const dnfBtn = $(`btn-dnf-${l.id}`);
    if (btn    && !btn.disabled)    { btn.disabled = true; btn.textContent = '未完成'; }
    if (dnfBtn) dnfBtn.classList.add('hidden');
  });

  let blob = null;
  if (recorder.recording) blob = await recorder.stop();

  if (state.role === 'start') sync.send('RACE_END', {});

  // Solo mode: stop detector (return to preview after results are shown)
  if (state.role === 'solo') {
    detector.stop();
    detector.start(null, null);  // keep overlay drawn but no callbacks
  }

  const race = saveRace(blob);
  state.lastRace = race; // 保存用于导出
  autoSaveToBackend(race);

  // ── 保存成绩到 localStorage & session history ──────────
  saveGroupToHistory(race);
  showToast('成绩已保存', 'success');

  // Show inline race-end actions in the race tab
  showRaceEndActions(race, blob);
}

function showRaceEndActions(race, blob) {
  const existing = $('race-end-card');
  if (existing) existing.remove();

  const sorted = race.lanes.filter(l => l.time != null).sort((a,b) => a.time - b.time);
  const medals = ['🥇','🥈','🥉'];

  // Podium rows with rank highlight
  const fmtSplits = lapTimes => lapTimes?.length > 1
    ? `<div class="rend-splits">${lapTimes.map((t,i) => `<span>第${i+1}圈&nbsp;${PrecisionTimer.formatFull(t)}</span>`).join('')}</div>`
    : '';

  const rows = sorted.map((l, i) => `
    <div class="rend-row ${i === 0 ? 'rend-gold' : ''}">
      <span class="rend-medal">${medals[i] || `<span style="width:28px;text-align:center;display:inline-block">#${i+1}</span>`}</span>
      <span class="rend-name">${l.name}</span>
      <span class="rend-time">${PrecisionTimer.formatFull(l.time)}</span>
      ${fmtSplits(l.lapTimes)}
    </div>`).join('');

  const dnfRows = race.lanes.filter(l => l.time == null).map(l =>
    `<div class="rend-row rend-dnf"><span class="rend-medal">—</span><span class="rend-name">${l.name}</span><span class="rend-time" style="color:var(--text-muted)">${l.dnf ? 'DNF' : 'DNS'}</span></div>`
  ).join('');

  const card = document.createElement('div');
  card.id = 'race-end-card';
  card.className = 'card race-end-card';
  card.innerHTML = `
    <div class="rend-header">
      <div class="rend-title">比赛结束</div>
      <div class="rend-meta">第 ${race.round} 轮 &nbsp;·&nbsp; 第 ${race.group} 组</div>
    </div>
    <div class="rend-results">${rows || ''}${dnfRows}</div>
    <div class="rend-actions">
      <button class="btn btn-start rend-btn-next" id="btn-next-group">▶ 下一组</button>
      <button class="btn btn-secondary rend-btn-round" id="btn-next-round">▲ 下一轮</button>
    </div>
    <button class="btn btn-ghost rend-btn-full" id="btn-see-results" style="margin-top:8px;width:100%">查看完整成绩</button>`;

  DOM.lanesWrap.insertAdjacentElement('afterbegin', card);

  $('btn-next-group').onclick    = () => { card.remove(); nextGroup(false); };
  $('btn-next-round').onclick    = () => { card.remove(); nextGroup(true); };
  $('btn-see-results').onclick   = () => { renderResults(race, blob); showTab('results'); };

  // Play victory sound for winner
  starterAudio.playVictory();
}

// Reset race state to start next group (keepConn = true = stay connected)
function nextGroup(newRound = false) {
  if (newRound) {
    state.currentRound++;
    state.currentGroup = 1;
  } else {
    state.currentGroup++;
  }
  // Update display
  const rd = $('round-display'); if (rd) rd.textContent = state.currentRound;
  const gd = $('group-display'); if (gd) gd.textContent = state.currentGroup;

  // Reset race state
  state.raceStarted  = false;
  state.raceFinished = false;
  state.lanes.forEach(l => { l.time = null; l.rank = null; l.dnf = false; l.lapTimes = []; l.currentLap = 0; });

  // Reset timer UI
  timer.reset();
  resetTimerUI();
  DOM.recBadge.classList.add('hidden');

  // Re-render lane cards
  renderLaneCards();

  // Re-attach camera to race video (still have the stream)
  if (mainStream && state.camGranted) {
    DOM.raceVideo.srcObject = mainStream;
    DOM.camOffMsg.style.display = 'none';
  }

  // Restart recorder
  if (mainStream && state.camGranted) recorder.initFromStream(mainStream);

  showToast(`第${state.currentRound}轮 第${state.currentGroup}组 — 准备就绪`, 'success');
}

async function autoSaveToBackend(race) {
  if (!race?.lanes?.length) return;
  try {
    let eventId = state.eventId;
    // Auto-create a meet/event if none selected
    if (!eventId) {
      const meet = await ApiClient.createMeet({ name: race.name, date: new Date().toISOString().slice(0,10) });
      if (!meet) return;
      const ev = await ApiClient.createEvent({
        meetId: meet.id, name: race.name,
        laps: state.lapCount, totalRounds: 1, groupsPerRound: 1,
      });
      if (!ev) return;
      eventId = ev.id;
    }

    const sorted = race.lanes.filter(l => l.time != null).sort((a,b) => a.time - b.time);
    let rank = 1;
    for (const lane of sorted) {
      await ApiClient.saveResult({
        eventId,
        round:       state.currentRound,
        group:       state.currentGroup,
        athleteName: lane.name,
        laneIndex:   lane.id,
        timeMs:      Math.round(lane.time),
        lapTimes:    (lane.lapTimes || []).map(t => Math.round(t)),
        rank:        rank++,
        recordedAt:  Date.now(),
      });
    }
    // DNS lanes
    for (const lane of race.lanes.filter(l => l.time == null)) {
      await ApiClient.saveResult({
        eventId, round: state.currentRound, group: state.currentGroup,
        athleteName: lane.name, laneIndex: lane.id, timeMs: null, rank: null,
      });
    }
    console.log('[竞迹] 成绩已同步到后台');
  } catch (e) {
    console.warn('[竞迹] 后台保存失败（离线？）', e);
  }
}

function goHome() {
  if (state.raceStarted && !state.raceFinished) {
    if (!confirm('比赛进行中，确定返回主页？当前计时将丢失。')) return;
  }
  // 执行完整清理
  performCleanup();

  // Reset state
  state.role = 'solo'; state.raceStarted = false; state.raceFinished = false;
  state.lanes = []; state.camGranted = false; state.micGranted = false;
  state.roomLocked = false; // 重置房间锁定状态
  selectedRole = null;

  // 解锁房间号输入
  DOM.roomCodeSet.disabled = false;
  DOM.roomCodeSet.readOnly = false;
  DOM.roomCodeSet.style.opacity = '';
  DOM.roomCodeSet.style.cursor = '';
  _hideRoomLockedIndicator();

  // Hide all sections, show role overlay
  document.getElementById('tab-bar-start')?.classList.add('hidden');
  document.getElementById('tab-observer-main')?.classList.add('hidden');
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.fs-main, [id^="tab-finish"]').forEach(p => p.classList.add('hidden'));
  DOM.roleOverlay.classList.remove('hidden');
  DOM.appTitle.innerHTML = '<span class="brand-jj">竞迹</span>';
}

// 完整资源清理（防止内存泄漏）
function performCleanup() {
  // 停止计时器
  timer.stop();
  timer.reset();
  timer.removeAllListeners();

  // 停止检测器
  detector.stop();
  detector.resetLaneDone();

  // 停止媒体流
  if (mainStream) {
    mainStream.getTracks().forEach(t => t.stop());
    mainStream = null;
  }

  // 断开同步连接
  sync.disconnect();

  // 停止录像
  if (recorder.recording) {
    recorder.stop();
  }

  // 清理视频元素
  if (DOM.raceVideo) {
    DOM.raceVideo.srcObject = null;
  }
  if (DOM.finishVideoFs) {
    DOM.finishVideoFs.srcObject = null;
  }

  // 清理诊断测试的媒体流
  if (window._diagCamStream) {
    window._diagCamStream.getTracks().forEach(t => t.stop());
    window._diagCamStream = null;
  }
  if (window._diagMicStream) {
    window._diagMicStream.getTracks().forEach(t => t.stop());
    window._diagMicStream = null;
  }

  // 清理Canvas
  if (DOM.raceCanvas) {
    const ctx = DOM.raceCanvas.getContext('2d');
    ctx?.clearRect(0, 0, DOM.raceCanvas.width, DOM.raceCanvas.height);
  }

  // 清理历史记录（只保留最近10条）
  try {
    const history = JSON.parse(localStorage.getItem('race-history') || '[]');
    if (history.length > 10) {
      localStorage.setItem('race-history', JSON.stringify(history.slice(-10)));
    }
  } catch {}

  console.log('[竞迹] 资源清理完成');
}

function resetRace() {
  state.raceStarted = false; state.raceFinished = false;
  state.lanes.forEach(l => { l.time = null; l.rank = null; l.dnf = false; l.lapTimes = []; l.currentLap = 0; });
  timer.reset();
  resetTimerUI();
  DOM.recBadge.classList.add('hidden');
  renderLaneCards();

  // 练习模式下显示提示
  if (state.practiceMode && DOM.timerSub) {
    DOM.timerSub.textContent = '🔔 练习模式 - 请测试发令';
  }
}

function resetTimerUI() {
  DOM.timerDisplay.textContent = '00:00.00';
  DOM.timerDisplay.classList.remove('running','stopped');
  DOM.timerSub.textContent = '准备就绪';
  DOM.btnStart.classList.remove('hidden');
  DOM.btnStop.classList.add('hidden');
}

// ── Finish device race flow ────────────────────────────
function onFinishDeviceRaceStart(event) {
  // Always reset regardless of previous state (handles multi-group auto-flow)
  state.raceStarted  = true;
  state.raceFinished = false;
  state.raceStartServerTime = event._serverTime;
  state.recordingStart = performance.now();
  state.crossings = [];
  state.laneCrossings = {};
  state.laneLastCrossingTime = {};
  state.lanesDone = 0;
  detector.resetLaneDone();          // clear per-lane locks from previous race
  updateLaneStatusBar();             // reset status bar to all-waiting

  // Hide end overlay and auto-detect button during race
  if (DOM.fsEnd) DOM.fsEnd.classList.add('hidden');
  if (DOM.fsResults) DOM.fsResults.innerHTML = '';
  const pill = $('fs-auto-pill');
  if (pill) pill.classList.add('hidden');

  beep(660, 200);

  // Start composite recording (video + finish-line overlay)
  if (state.camGranted && recorder.hasVideo) {
    recorder.startComposite(DOM.finishVideoFs, DOM.finishCanvasFs);
    DOM.fsRecDot?.classList.remove('hidden');
  }


  // Re-start detector with full crossing callbacks (same video/canvas, already inited)
  detector.stop();
  detector.init(DOM.finishVideoFs, DOM.finishCanvasFs, state.laneCount);
  detector.bindDrag(DOM.finishCanvasFs);
  detector.onCloseFinish = null;
  // Grace period:
  //   Multi-lap → flat 8 seconds. Simple, safe for ALL ability levels
  //   (no world-record math, no window restrictions).
  //   Single-lap → WR-based (needs longer window since only one crossing total).
  const fsGraceMs = state.lapCount > 1
    ? 8000
    : Math.round(minRaceGraceMs(state.distance) * 0.70);
  const fsGraceUntil = performance.now() + fsGraceMs;
  // Multi-lap: use 3s cooldown to prevent same crossing being counted twice
  detector.cooldownMs = state.lapCount > 1 ? 3000 : 1500;
  detector.start(
    (laneIdx, perfTs) => {
      if (performance.now() < fsGraceUntil) return;
      handleFinishCrossing(laneIdx, perfTs);
    },
    (level) => {
      const pct = Math.min(100, level * 100);
      if (DOM.fsLevelFill) DOM.fsLevelFill.style.width = `${pct}%`;
      if (DOM.fsDetectStatus) {
        if (performance.now() < fsGraceUntil) {
          const secLeft = Math.ceil((fsGraceUntil - performance.now()) / 1000);
          DOM.fsDetectStatus.textContent = `📷 保护期 ${secLeft}s — 忽略误触发`;
        } else {
          DOM.fsDetectStatus.textContent = level > 0.3 ? `🔴 检测到动作 (${Math.round(pct)}%)` : '🟢 等待冲线...';
        }
      }
    }
  );

  // Clear previous result cards
  if (DOM.fsResults) DOM.fsResults.innerHTML = '';
  if (DOM.fsEnd) DOM.fsEnd.classList.add('hidden');

  if (DOM.fsStateLabel) DOM.fsStateLabel.textContent = '🏃 比赛进行中';
  if (DOM.fsConnDot) DOM.fsConnDot.classList.add('connected');
  updateLaneStatusBar();   // show lane status bar with all lanes waiting
  showToast('⚡ 收到发令信号，计时开始！', 'success');
  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
}

function handleFinishCrossing(laneIdx, perfTs) {
  if (!state.raceStarted || state.raceFinished) return;

  // Clamp laneIdx to valid range
  if (laneIdx < 0 || laneIdx >= state.laneCount) laneIdx = Math.min(laneIdx, state.laneCount - 1);

  // Init per-lane tracking
  if (state.laneCrossings[laneIdx] === undefined) state.laneCrossings[laneIdx] = 0;

  // Lane has already finished all laps
  if (state.laneCrossings[laneIdx] >= state.lapCount) return;

  const raceTime    = sync.serverNow() - state.raceStartServerTime;
  const videoOffset = state.recordingStart != null
    ? (perfTs - state.recordingStart) / 1000 : 0;

  const prevTime = state.laneLastCrossingTime[laneIdx] ?? 0;
  const lapTime  = raceTime - prevTime;

  // Per-lap minimum interval: reject physically impossible back-to-back crossings.
  // 5 seconds is far below any human's lap time (even Usain Bolt needs 9+ s for 100 m).
  // This only catches sensor noise that slipped past the 3-second cooldown.
  // NO upper limit — slow students / walkers are always accepted. ✓
  if (state.lapCount > 1 && state.laneCrossings[laneIdx] > 0) {
    if (lapTime < 5000) return;  // < 5 s between crossings → impossible, ignore
  }
  state.laneLastCrossingTime[laneIdx] = raceTime;
  state.laneCrossings[laneIdx]++;
  const crossingNum = state.laneCrossings[laneIdx];

  const laneName  = state.lanes[laneIdx]?.name || `运动员 ${laneIdx + 1}`;
  const lapDistM  = state.distance / state.lapCount;              // metres per lap
  const paceSecKm = lapDistM > 0 ? (lapTime / 1000) / (lapDistM / 1000) : 0; // s/km
  const paceMin   = Math.floor(paceSecKm / 60);
  const paceSec   = Math.round(paceSecKm % 60);
  const paceStr   = lapDistM >= 200 ? `${paceMin}'${String(paceSec).padStart(2,'0')}"/km` : null;

  if (crossingNum < state.lapCount) {
    // Intermediate lap — show split + pace
    beep(440, 80);
    if (navigator.vibrate) navigator.vibrate(60);
    renderSplitCard(laneIdx, crossingNum, raceTime, lapTime, laneName, paceStr);
    sync.send('CROSSING_SPLIT', { laneIdx, raceTime, lapTime, lapNum: crossingNum, athleteName: laneName, paceStr });
    showToast(`${laneName} 第${crossingNum}圈 ${PrecisionTimer.formatFull(raceTime)}${paceStr ? '  ' + paceStr : ''}`, 'info');
    return;
  }

  // Final crossing — capture frame + record finish
  const photoDataUrl = detector.captureFrame(640, 360,
    `${laneName}  ${PrecisionTimer.formatFull(raceTime)}`);
  state.lanesDone++;
  const rank = state.lanesDone;
  // Permanently lock this lane — no more triggers until next race
  detector.setLaneDone(laneIdx, PrecisionTimer.formatFull(raceTime));
  updateLaneStatusBar();

  const crossing = { laneIdx, raceTime, videoOffset, rank, name: laneName, perfTs, photo: photoDataUrl, paceStr };
  state.crossings.push(crossing);

  renderCrossingCard(crossing);
  beep(rank === 1 ? 880 : 660, 120);
  if (navigator.vibrate) navigator.vibrate(rank === 1 ? [80, 40, 80] : 120);

  sync.send('CROSSING', { laneIdx, raceTime, rank, athleteName: laneName, lapTime, paceStr });
  showToast(`🏁 #${rank} ${laneName}  ${PrecisionTimer.formatFull(raceTime)}`, 'success');

  if (state.lanesDone >= state.laneCount) {
    setTimeout(onFinishDeviceRaceEnd, 1000);
  }
}

function renderCrossingCard(crossing) {
  const medals = ['🥇','🥈','🥉'];
  const card   = document.createElement('div');
  card.className = 'fs-result-card';
  const photoHtml = crossing.photo
    ? `<img class="fsr-photo" src="${crossing.photo}" alt="冲线截图">`
    : '';
  const paceHtml = crossing.paceStr
    ? `<div class="fsr-pace">${crossing.paceStr}</div>`
    : '';
  card.innerHTML = `
    ${photoHtml}
    <div class="fsr-rank">${medals[crossing.rank-1] || `#${crossing.rank}`}</div>
    <div class="fsr-info">
      <div class="fsr-name">${crossing.name}</div>
      <div class="fsr-time">${PrecisionTimer.formatFull(crossing.raceTime)}</div>
      ${paceHtml}
    </div>`;
  if (DOM.fsResults) DOM.fsResults.appendChild(card);
  requestAnimationFrame(() => card.classList.add('visible'));
}

function renderSplitCard(laneIdx, lapNum, raceTime, lapTime, laneName, paceStr) {
  if (!DOM.fsResults) return;
  const card = document.createElement('div');
  card.className = 'fs-result-card fs-split-card';
  card.innerHTML = `
    <div class="fsr-rank" style="font-size:13px;color:#ffd600">第${lapNum}圈</div>
    <div class="fsr-info">
      <div class="fsr-name">${laneName}</div>
      <div class="fsr-time" style="font-size:14px">${PrecisionTimer.formatFull(raceTime)}
        <span style="color:#888;font-size:11px;margin-left:4px">+${PrecisionTimer.formatFull(lapTime)}</span>
      </div>
      ${paceStr ? `<div class="fsr-pace">${paceStr}</div>` : ''}
    </div>`;
  DOM.fsResults.appendChild(card);
  requestAnimationFrame(() => card.classList.add('visible'));
}

async function onFinishDeviceRaceEnd() {
  if (state.raceFinished) return;
  state.raceFinished = true;
  detector.stop();

  // Restore auto-detect button after race ends
  const pill = $('fs-auto-pill');
  if (pill) pill.classList.remove('hidden');

  DOM.fsRecDot?.classList.add('hidden');
  if (DOM.fsStateLabel) DOM.fsStateLabel.textContent = '✅ 比赛结束';

  let blob = null;
  if (recorder.recording) blob = await recorder.stop();
  if (blob) state.finishRecorderBlob = blob;

  // Build end-of-race result list with crossing photos
  if (DOM.fsEndList) {
    const medals = ['🥇','🥈','🥉'];
    const sorted = [...state.crossings].sort((a, b) => a.rank - b.rank);
    DOM.fsEndList.innerHTML = sorted.map(c => `
      <div class="fs-end-row">
        ${c.photo ? `<img class="fs-end-photo" src="${c.photo}" alt="${c.name}冲线">` : ''}
        <div class="fs-end-info">
          <span class="fs-end-rank">${medals[c.rank-1] || `#${c.rank}`}</span>
          <span class="fs-end-name">${c.name}</span>
          <span class="fs-end-time">${PrecisionTimer.formatFull(c.raceTime)}</span>
        </div>
      </div>`).join('');
  }

  if (DOM.fsEnd) DOM.fsEnd.classList.remove('hidden');
  $('fs-lane-bar')?.classList.add('hidden');   // hide status bar — end overlay takes over
  beep(880, 400);
  showToast('✅ 比赛结束', 'success');
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

  // Auto-dismiss after 30s (longer so reviewers can examine photos)
  setTimeout(() => {
    if (DOM.fsEnd) DOM.fsEnd.classList.add('hidden');
    if (DOM.fsStateLabel) DOM.fsStateLabel.textContent = '⏳ 等待下一组发令...';
  }, 30000);
}

function resetFinishDevice() {
  state.raceStarted   = false;
  state.raceFinished  = false;
  state.crossings     = [];
  state.laneCrossings = {};
  state.laneLastCrossingTime = {};
  state.lanesDone     = 0;
  state.recordingStart = null;
  // Keep autoDetectedLanes across groups — same track, same lane count
  // (user can manually re-detect if track changes)
  recorder.clearBlob();
  if (mainStream && state.camGranted) recorder.initFromStream(mainStream);

  if (DOM.fsResults) DOM.fsResults.innerHTML = '';
  if (DOM.fsEnd) DOM.fsEnd.classList.add('hidden');
  if (DOM.fsStateLabel) DOM.fsStateLabel.textContent = '等待发令信号...';

  // Resume preview detection
  detector.stop();
  detector.init(DOM.finishVideoFs, DOM.finishCanvasFs, state.laneCount);
  detector.bindDrag(DOM.finishCanvasFs);
  detector.start(null, (level) => {
    const pct = Math.min(100, level * 100);
    if (DOM.fsLevelFill) DOM.fsLevelFill.style.width = `${pct}%`;
  });

  showToast('终点端已重置，等待下一组', 'success');
}

// ── Observer UI ────────────────────────────────────────
function obsSetConnected(ok) {
  if (DOM.obsConnDot) DOM.obsConnDot.className = `obs-conn-dot ${ok ? 'online' : 'offline'}`;
}
function obsSetState(msg) {
  if (DOM.obsStateLabel) DOM.obsStateLabel.textContent = msg;
}
function obsUpdateInfoBar() {
  const r = state.obsRaceInfo;
  if (!DOM.obsInfoBar || !r.lapsNeeded) return;
  const org = r.orgName ? `${r.orgName} · ` : '';
  const lapStr = r.lapsNeeded > 1 ? ` · ${r.lapsNeeded}圈` : '';
  DOM.obsInfoBar.textContent =
    `${org}${r.distance || '—'}m${lapStr} · ${r.laneCount || '—'}人 · 第${r.round||'?'}轮 第${r.group||'?'}组`;
}
function obsRenderTable() {
  if (!DOM.obsTableWrap) return;
  const medals = ['🥇','🥈','🥉'];
  const rows = state.obsResults.map((e, i) => {
    if (e.isDNF) return `<tr class="obs-dnf"><td>DNF</td><td>${(e.laneIdx??'')+ 1}</td><td>${e.athleteName||''}</td><td>—</td></tr>`;
    return `<tr class="${i===0?'obs-gold':''}">
      <td>${medals[i]||`#${i+1}`}</td>
      <td>${(e.laneIdx??i)+1}</td>
      <td>${e.athleteName||''}</td>
      <td class="obs-time">${PrecisionTimer.formatFull(e.raceTime)}</td>
    </tr>`;
  }).join('');
  DOM.obsTableWrap.innerHTML = rows
    ? `<table class="obs-table"><thead><tr><th>名次</th><th>道次</th><th>姓名</th><th>成绩</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="obs-empty-hint">等待运动员过线...</div>';
}
function obsAddSplit(e) {
  if (!DOM.obsTableWrap) return;
  // Find existing row for this lane and add a split badge
  const existing = DOM.obsTableWrap.querySelector(`[data-lane="${e.laneIdx}"]`);
  if (existing) {
    const sp = document.createElement('span');
    sp.className = 'obs-split';
    sp.textContent = `第${e.lapNum}圈 ${PrecisionTimer.formatFull(e.raceTime)}`;
    existing.appendChild(sp);
  }
}
function obsRenderHistory() {
  if (!DOM.obsHistoryList) return;
  DOM.obsHistoryList.innerHTML = state.obsHistory.map(g => {
    const top = g.results.filter(r => !r.isDNF)
      .sort((a,b) => a.raceTime - b.raceTime)
      .slice(0,3)
      .map((r,i) => `<span class="obs-hist-item">${['🥇','🥈','🥉'][i]} ${r.athleteName} ${PrecisionTimer.formatFull(r.raceTime)}</span>`)
      .join('');
    return `<div class="obs-hist-group">
      <span class="obs-hist-label">第${g.round}轮 第${g.group}组${g.dist?` · ${g.dist}m`:''}</span>
      <div class="obs-hist-results">${top||'—'}</div>
    </div>`;
  }).join('');
}
function obsExportGroup() {
  const ri = state.obsRaceInfo;
  const results = state.obsResults.filter(r => !r.isDNF).sort((a,b) => a.raceTime - b.raceTime);
  const dnfs    = state.obsResults.filter(r => r.isDNF);
  const medals  = ['🥇','🥈','🥉'];
  const org     = DOM.orgName?.value?.trim() || '';

  const rows = [
    ...results.map((r,i) => `<tr class="${i===0?'gold-row':''}">
      <td>${medals[i]||i+1}</td><td>${(r.laneIdx??i)+1}</td>
      <td>${r.athleteName||''}</td>
      <td class="time-cell">${PrecisionTimer.formatFull(r.raceTime)}</td>
    </tr>`),
    ...dnfs.map(r => `<tr class="dnf-row"><td>DNF</td><td>${(r.laneIdx??'')+1}</td><td>${r.athleteName||''}</td><td>DNF</td></tr>`),
  ].join('');

  const lapStr = ri.lapsNeeded > 1 ? ` · ${ri.lapsNeeded}圈` : '';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:"Microsoft YaHei",Arial,sans-serif;margin:24px;color:#222}
  .brand{font-size:22px;font-weight:900;color:#ff6200;letter-spacing:2px}
  .meta{font-size:13px;color:#555;line-height:2;margin-bottom:14px}
  table{border-collapse:collapse;width:100%;font-size:14px}
  th{background:#ff6200;color:#fff;padding:9px 12px;text-align:center}
  td{padding:8px 12px;text-align:center;border-bottom:1px solid #eee}
  .gold-row td{background:#fffde7;font-weight:700}
  .dnf-row td{color:#aaa}
  .time-cell{font-family:monospace;font-size:16px;font-weight:700;color:#ff6200}
  .footer{font-size:11px;color:#bbb;margin-top:16px}
</style></head><body>
<div class="brand">竞迹</div>
<div class="meta">
  ${org?`<b>学校/组织：</b>${org}&emsp;`:''}
  ${ri.distance?`<b>距离：</b>${ri.distance}m${lapStr}&emsp;`:''}
  <b>第${ri.round||'?'}轮 · 第${ri.group||'?'}组</b>
</div>
<table><thead><tr><th>名次</th><th>道次</th><th>姓名</th><th>成绩</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="footer">由 竞迹 JingJi 成绩端生成 · ${new Date().toLocaleString('zh-CN')}</div>
</body></html>`;

  const blob  = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  const fname = [org, ri.distance?`${ri.distance}m`:'', `第${ri.round||1}轮第${ri.group||1}组`].filter(Boolean).join('_');
  a.href = url; a.download = `${fname}.xls`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('✅ 成绩单已导出', 'success');
}

// ── Network latency display ────────────────────────────
function updateLatencyBadge() {
  const badge = $('latency-badge');
  if (!badge) return;
  const rtt = sync.rtt;
  if (rtt === null || rtt === undefined) { badge.textContent = ''; return; }
  badge.textContent = `${rtt}ms`;
  badge.className = 'latency-badge ' + (rtt < 30 ? 'lat-good' : rtt < 80 ? 'lat-ok' : 'lat-bad');
}

// ── Roster CSV import ──────────────────────────────────
function handleRosterImport(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text  = e.target.result;
    const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
    const names = [];

    lines.forEach(line => {
      // Formats: "name", "lane,name", or comma-separated names on one line
      const parts = line.split(',').map(p => p.trim()).filter(Boolean);
      if (parts.length === 0) return;
      if (parts.length === 1) {
        names.push(parts[0]);
      } else if (parts.length >= 2 && !isNaN(parts[0])) {
        // First column is a lane number
        const laneNum = parseInt(parts[0]) - 1;
        if (laneNum >= 0 && laneNum < state.laneCount) {
          const inp = $(`lane-input-${laneNum}`);
          if (inp) { inp.value = parts[1]; inp.dispatchEvent(new Event('input')); }
        }
      } else {
        names.push(...parts);
      }
    });

    // Fill in order if no lane numbers
    if (names.length) {
      names.slice(0, state.laneCount).forEach((name, i) => {
        const inp = $(`lane-input-${i}`);
        if (inp) { inp.value = name; inp.dispatchEvent(new Event('input')); }
      });
    }

    showToast(`✅ 已导入 ${Math.min(names.length || state.laneCount, state.laneCount)} 名运动员`, 'success');
    debouncedBroadcastConfig();
  };
  reader.readAsText(file, 'UTF-8');
}

// ── Finish device conn status ──────────────────────────
function updateConnStatus(connected) {
  if (DOM.fsConnDot) DOM.fsConnDot.className = `fs-conn-dot ${connected ? 'connected' : 'error'}`;
  if (DOM.fsStateLabel && !state.raceStarted)
    DOM.fsStateLabel.textContent = connected ? '✅ 已连接，等待发令' : '❌ 等待连接...';
}

// Show finish-device count badge on the start/solo device sync badge
function updateFinishBadge() {
  if (state.role !== 'start') return;
  const fc = sync.finishPeerCount;
  const badge = $('finish-count-badge');
  if (!badge) return;
  badge.textContent = fc > 0 ? `🏁 终点端 ×${fc}` : '';
  badge.classList.toggle('hidden', fc === 0);
}

// ── Persistence ────────────────────────────────────────
function saveRace(blob) {
  const race = {
    id: Date.now(), name: DOM.raceName.value || '田径比赛',
    date: new Date().toLocaleString('zh-CN'),
    lanes: state.lanes.map(l => ({ ...l })),
    lapCount: state.lapCount,
    round: state.currentRound,
    group: state.currentGroup,
    hasVideo: !!blob,
  };
  const history = getHistory();
  history.unshift(race);
  if (history.length > 30) history.length = 30;
  localStorage.setItem('race-history', JSON.stringify(history));
  return race;
}
function getHistory()  { try { return JSON.parse(localStorage.getItem('race-history') || '[]'); } catch { return []; } }
function loadHistory() { renderHistory(getHistory()); }

// ── 保存成绩到管理后台 localStorage & session history ───
// ═══════════════════════════════════════════════════════════════════════════
// 增强数据导出功能
// ═══════════════════════════════════════════════════════════════════════════

// ── 运动员最佳成绩记录 ─────────────────────────────────────
const ATHLETE_BEST_KEY = 'jingjitimer-athlete-bests';

function getAthleteBests() {
  try { return JSON.parse(localStorage.getItem(ATHLETE_BEST_KEY) || '{}'); } catch { return {}; }
}

function saveAthleteBest(athleteName, timeMs, distance, date) {
  const bests = getAthleteBests();
  const key = `${athleteName}_${distance}m`;
  if (!bests[key] || timeMs < bests[key].time) {
    bests[key] = { name: athleteName, time: timeMs, distance, date };
    try { localStorage.setItem(ATHLETE_BEST_KEY, JSON.stringify(bests)); } catch {}
  }
  return bests[key];
}

function getAthleteBest(athleteName, distance) {
  const bests = getAthleteBests();
  return bests[`${athleteName}_${distance}m`] || null;
}

// 保存比赛时更新最佳成绩
function updateBestsFromRace(race) {
  if (!race?.lanes) return;
  race.lanes.forEach(lane => {
    if (lane.time != null) {
      saveAthleteBest(lane.name, lane.time, race.distance || state.distance, race.date);
    }
  });
}

// ── 天气信息获取 ───────────────────────────────────────────
async function getWeatherInfo() {
  // 尝试获取用户位置并获取天气
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ temp: null, condition: '未知', city: '' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        try {
          // 使用免费的 Open-Meteo API (无需 API key)
          const resp = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`);
          const data = await resp.json();
          if (data.current) {
            const temp = data.current.temperature_2m;
            const code = data.current.weather_code;
            const condition = weatherCodeToText(code);
            resolve({ temp, condition, city: '当前位置' });
          } else {
            resolve({ temp: null, condition: '未知', city: '' });
          }
        } catch {
          resolve({ temp: null, condition: '未知', city: '' });
        }
      },
      () => resolve({ temp: null, condition: '未知', city: '' }),
      { timeout: 3000 }
    );
  });
}

function weatherCodeToText(code) {
  const codes = {
    0: '晴', 1: '晴间多云', 2: '多云', 3: '阴',
    45: '雾', 48: '霜雾',
    51: '小毛毛雨', 53: '中毛毛雨', 55: '大毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨',
    71: '小雪', 73: '中雪', 75: '大雪',
    80: '小阵雨', 81: '中阵雨', 82: '大阵雨',
    95: '雷暴', 96: '雷暴伴冰雹',
  };
  return codes[code] || '未知';
}

// ── 规范化文件名生成 ───────────────────────────────────────
function generateExportFilename(parts) {
  const date = new Date();
  const dateStr = `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`;
  const timeStr = `${String(date.getHours()).padStart(2,'0')}${String(date.getMinutes()).padStart(2,'0')}`;
  const suffix = parts.filter(Boolean).join('_');
  return suffix ? `${dateStr}_${timeStr}_${suffix}` : `${dateStr}_${timeStr}`;
}

// ── 真正的 CSV 导出 ───────────────────────────────────────
function exportToCSV(race, options = {}) {
  const {
    includeBest = true,
    includeLapTimes = true,
    includeMetadata = true,
    filename = null
  } = options;

  const orgName = DOM.orgName?.value?.trim() || race.orgName || '';
  const distance = race.distance || state.distance || 0;
  const dateStr = race.date || new Date().toLocaleString('zh-CN');
  const round = race.round || 1;
  const group = race.group || 1;
  const trackLength = race.trackLength || state.trackLength || 400;
  const lapCount = race.lapCount || state.lapCount || 1;

  const lines = [];

  // BOM for Excel UTF-8 compatibility
  const BOM = '﻿';

  // 元数据部分
  if (includeMetadata) {
    lines.push(BOM + '===== 比赛信息 =====');
    lines.push(`学校/组织,${escapeCSV(orgName)}`);
    lines.push(`比赛名称,${escapeCSV(race.name || '田径比赛')}`);
    lines.push(`日期,${escapeCSV(dateStr)}`);
    lines.push(`距离,${distance}m`);
    lines.push(`跑道长度,${trackLength}m`);
    lines.push(`圈数,${lapCount}`);
    lines.push(`组别,第${round}轮 第${group}组`);
    lines.push(`导出时间,${new Date().toLocaleString('zh-CN')}`);
    lines.push('');
    lines.push('===== 比赛成绩 =====');
  }

  // CSV 表头
  const headers = ['名次', '道次', '姓名'];
  if (includeLapTimes && lapCount > 1) {
    for (let i = 1; i <= lapCount; i++) {
      headers.push(`第${i}圈`);
    }
  }
  headers.push('总成绩', '备注');
  if (includeBest) headers.push('个人最佳', '是否刷新最佳');

  lines.push(headers.join(','));

  // 成绩数据
  const sorted = race.lanes.filter(l => l.time != null).sort((a, b) => a.time - b.time);
  const dnf = race.lanes.filter(l => l.time == null);

  sorted.forEach((lane, idx) => {
    const rank = idx + 1;
    const laneIdx = race.lanes.indexOf(lane);
    const lapTimes = lane.lapTimes || [];
    const best = includeBest ? getAthleteBest(lane.name, distance) : null;
    const isNewBest = best && lane.time <= best.time;

    const row = [
      rank,
      laneIdx + 1,
      escapeCSV(lane.name),
    ];

    if (includeLapTimes && lapCount > 1) {
      for (let i = 0; i < lapCount; i++) {
        row.push(lapTimes[i] != null ? PrecisionTimer.formatFull(lapTimes[i]) : '');
      }
    }

    row.push(PrecisionTimer.formatFull(lane.time));
    row.push('');

    if (includeBest) {
      row.push(best ? PrecisionTimer.formatFull(best.time) : '');
      row.push(isNewBest ? 'NEW!' : '');
    }

    lines.push(row.join(','));
  });

  // DNF
  dnf.forEach(lane => {
    const laneIdx = race.lanes.indexOf(lane);
    const row = [
      'DNF',
      laneIdx + 1,
      escapeCSV(lane.name),
    ];

    if (includeLapTimes && lapCount > 1) {
      for (let i = 0; i < lapCount; i++) {
        row.push('');
      }
    }

    row.push('');
    row.push(lane.dnf ? 'DNF-弃赛' : 'DNS-未参赛');

    if (includeBest) {
      row.push('');
      row.push('');
    }

    lines.push(row.join(','));
  });

  // 个人最佳记录
  if (includeBest) {
    lines.push('');
    lines.push('===== 个人最佳记录 =====');
    lines.push('姓名,距离,最佳成绩,创造日期');
    sorted.forEach(lane => {
      const best = getAthleteBest(lane.name, distance);
      if (best) {
        lines.push([escapeCSV(lane.name), `${distance}m`, PrecisionTimer.formatFull(best.time), best.date].join(','));
      }
    });
  }

  const csvContent = lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  const fname = filename || generateExportFilename([
    orgName,
    `${distance}m`,
    `第${round}轮第${group}组`
  ]);

  a.href = url;
  a.download = `${fname}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`CSV 已导出: ${fname}.csv`, 'success');
}

function escapeCSV(str) {
  if (str == null) return '';
  const s = String(str);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ── PDF 导出 ───────────────────────────────────────────────
async function exportToPDF(race, options = {}) {
  const {
    includeWeather = true,
    includeBest = true,
    includeLapTimes = true,
    filename = null
  } = options;

  const orgName = DOM.orgName?.value?.trim() || race.orgName || '';
  const distance = race.distance || state.distance || 0;
  const dateStr = race.date || new Date().toLocaleString('zh-CN');
  const round = race.round || 1;
  const group = race.group || 1;
  const trackLength = race.trackLength || state.trackLength || 400;
  const lapCount = race.lapCount || state.lapCount || 1;

  let weather = null;
  if (includeWeather) {
    weather = await getWeatherInfo();
  }

  // 使用简单的内联 PDF 生成（不依赖外部库）
  const pdfContent = generatePDFContent(race, {
    orgName, distance, dateStr, round, group, trackLength, lapCount, weather, includeBest, includeLapTimes
  });

  const blob = new Blob([pdfContent], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  const fname = filename || generateExportFilename([
    orgName,
    `${distance}m`,
    `第${round}轮第${group}组`
  ]);

  a.href = url;
  a.download = `${fname}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`PDF 已导出: ${fname}.pdf`, 'success');
}

function generatePDFContent(race, options) {
  const { orgName, distance, dateStr, round, group, trackLength, lapCount, weather, includeBest, includeLapTimes } = options;

  const sorted = race.lanes.filter(l => l.time != null).sort((a, b) => a.time - b.time);
  const dnf = race.lanes.filter(l => l.time == null);
  const medals = ['🥇', '🥈', '🥉'];

  // 构建 PDF 内容（简化版文本 PDF）
  let content = '';
  content += '%PDF-1.4\n';
  content += '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n';
  content += '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n';

  // 标题和元数据
  let textContent = '';
  textContent += 'BT\n';
  textContent += '/F1 24 Tf\n';
  textContent += '100 750 Td\n';
  textContent += '( ' + (orgName || '田径比赛成绩单') + ' ) Tj\n';

  textContent += '/F2 12 Tf\n';
  textContent += '100 720 Td\n';
  textContent += '( Date: ' + dateStr + ' ) Tj\n';

  let yPos = 690;
  textContent += '100 ' + yPos + ' Td\n';
  textContent += '( Distance: ' + distance + 'm | Track: ' + trackLength + 'm | Round ' + round + ' Group ' + group + ' ) Tj\n';

  if (weather) {
    yPos -= 20;
    textContent += '100 ' + yPos + ' Td\n';
    const weatherStr = weather.temp != null ? `Weather: ${weather.condition} ${weather.temp}C` : `Weather: ${weather.condition}`;
    textContent += '( ' + weatherStr + ' ) Tj\n';
  }

  yPos -= 40;
  textContent += '100 ' + yPos + ' Td\n';
  textContent += '( Ranking   Lane   Name              Time ) Tj\n';

  yPos -= 20;
  sorted.forEach((lane, idx) => {
    const laneIdx = race.lanes.indexOf(lane);
    const medal = medals[idx] || `#${idx + 1}`;
    const line = ` ${medal}       ${String(laneIdx + 1).padStart(4)}   ${lane.name.padEnd(15).substring(0, 15)}   ${PrecisionTimer.formatFull(lane.time)}`;

    if (yPos < 100) {
      content += 'ET\n';
      content += '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj\n';
      content += '4 0 obj << /Length ' + textContent.length + ' >> stream\n';
      content += textContent + '\nendstream\nendobj\n';
      content += 'xref\n0 5\n';
      content += 'trailer << /Size 5 /Root 1 0 R >>\n';
      content += 'startxref\n';
      content += (content.length + textContent.length + 100).toString() + '\n';
      content += '%%EOF';
      return;
    }

    textContent += '100 ' + yPos + ' Td\n';
    textContent += '( ' + line + ' ) Tj\n';

    // 圈速
    if (includeLapTimes && lapCount > 1 && lane.lapTimes) {
      yPos -= 15;
      const lapStr = lane.lapTimes.map((t, i) => `L${i+1}:${PrecisionTimer.formatFull(t)}`).join(' | ');
      textContent += '120 ' + yPos + ' Td\n';
      textContent += '( ' + lapStr + ' ) Tj\n';
    }

    yPos -= 20;
  });

  // DNF
  if (dnf.length > 0) {
    yPos -= 20;
    textContent += '100 ' + yPos + ' Td\n';
    textContent += '( DNF: ) Tj\n';
    yPos -= 15;
    dnf.forEach(lane => {
      const laneIdx = race.lanes.indexOf(lane);
      textContent += '120 ' + yPos + ' Td\n';
      textContent += `( Lane ${laneIdx + 1} - ${lane.name} ) Tj\n`;
      yPos -= 15;
    });
  }

  // Footer
  yPos -= 30;
  textContent += '100 ' + yPos + ' Td\n';
  textContent += '( Generated by JingJi Timer | ' + new Date().toLocaleString('zh-CN') + ' ) Tj\n';

  textContent += 'ET\n';

  content += '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj\n';
  content += '4 0 obj << /Length ' + textContent.length + ' >> stream\n';
  content += textContent + '\nendstream\nendobj\n';
  content += 'xref\n0 5\n';
  content += 'trailer << /Size 5 /Root 1 0 R >>\n';
  content += 'startxref\n';
  content += (content.length + textContent.length + 100).toString() + '\n';
  content += '%%EOF';

  return content;
}

// ── 批量导出历史成绩 ───────────────────────────────────────
function exportBatchHistory(options = {}) {
  const {
    format = 'csv',
    dateFrom = null,
    dateTo = null,
    distance = null,
    orgName = DOM.orgName?.value?.trim() || ''
  } = options;

  const history = getHistory();

  if (history.length === 0) {
    showToast('暂无历史成绩可导出', 'warn');
    return;
  }

  // 过滤数据
  let filtered = history;
  if (dateFrom) {
    filtered = filtered.filter(r => new Date(r.date) >= new Date(dateFrom));
  }
  if (dateTo) {
    filtered = filtered.filter(r => new Date(r.date) <= new Date(dateTo));
  }
  if (distance) {
    filtered = filtered.filter(r => r.distance === distance || r.distance === state.distance);
  }

  if (filtered.length === 0) {
    showToast('没有符合筛选条件的成绩', 'warn');
    return;
  }

  if (format === 'csv') {
    exportBatchToCSV(filtered, { orgName, distance });
  } else if (format === 'pdf') {
    exportBatchToPDF(filtered, { orgName, distance });
  } else if (format === 'html') {
    exportBatchToHTML(filtered, { orgName, distance });
  }

  showToast(`已导出 ${filtered.length} 组成绩 (${format.toUpperCase()})`, 'success');
}

function exportBatchToCSV(races, options = {
  orgName: '',
  distance: null
}) {
  const lines = [];
  lines.push('﻿' + '===== 批量成绩导出 =====');
  lines.push(`学校/组织,${escapeCSV(options.orgName)}`);
  lines.push(`导出时间,${new Date().toLocaleString('zh-CN')}`);
  lines.push(`成绩组数,${races.length}`);
  lines.push('');

  // 表头
  lines.push('日期,比赛名称,轮次,组别,距离,道次,姓名,名次,成绩,备注');

  races.forEach(race => {
    const sorted = race.lanes.filter(l => l.time != null).sort((a, b) => a.time - b.time);
    const dnf = race.lanes.filter(l => l.time == null);

    sorted.forEach((lane, idx) => {
      const laneIdx = race.lanes.indexOf(lane);
      lines.push([
        escapeCSV(race.date || ''),
        escapeCSV(race.name || ''),
        race.round || 1,
        race.group || 1,
        race.distance || state.distance || '',
        laneIdx + 1,
        escapeCSV(lane.name),
        idx + 1,
        PrecisionTimer.formatFull(lane.time),
        ''
      ].join(','));
    });

    dnf.forEach(lane => {
      const laneIdx = race.lanes.indexOf(lane);
      lines.push([
        escapeCSV(race.date || ''),
        escapeCSV(race.name || ''),
        race.round || 1,
        race.group || 1,
        race.distance || state.distance || '',
        laneIdx + 1,
        escapeCSV(lane.name),
        'DNF',
        '',
        lane.dnf ? '弃赛' : 'DNS'
      ].join(','));
    });
  });

  const csvContent = lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = `${generateExportFilename([options.orgName, '批量导出', `${races.length}组`])}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportBatchToPDF(races, options = {}) {
  // 简化的批量 PDF 导出
  showToast('批量 PDF 导出功能开发中，请使用 CSV 格式', 'info');
}

function exportBatchToHTML(races, options = {}) {
  const { orgName = '' } = options;
  const medals = ['🥇', '🥈', '🥉'];

  const rows = races.map(race => {
    const sorted = race.lanes.filter(l => l.time != null).sort((a, b) => a.time - b.time);
    const raceRows = sorted.map((lane, idx) => {
      const laneIdx = race.lanes.indexOf(lane);
      return `<tr>
        <td>${rounds || '-'}</td>
        <td>${medals[idx] || idx + 1}</td>
        <td>${laneIdx + 1}</td>
        <td>${lane.name}</td>
        <td>${PrecisionTimer.formatFull(lane.time)}</td>
      </tr>`;
    }).join('');

    return `<div class="batch-race">
      <div class="batch-race-header">${race.date} - ${race.name || '田径比赛'} (${race.distance || state.distance}m)</div>
      <table><thead><tr><th>R</th><th>Rank</th><th>Lane</th><th>Name</th><th>Time</th></tr></thead><tbody>${raceRows}</tbody></table>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:"Microsoft YaHei",Arial,sans-serif;margin:20px;color:#222}
  h1{color:#ff6200}
  .batch-race{margin-bottom:30px;border:1px solid #ddd;padding:15px;border-radius:8px}
  .batch-race-header{font-weight:bold;font-size:16px;margin-bottom:10px;color:#333}
  table{width:100%;border-collapse:collapse}
  th{background:#ff6200;color:#fff;padding:8px}
  td{padding:6px 8px;border-bottom:1px solid #eee;text-align:center}
  .footer{font-size:11px;color:#999;margin-top:20px}
</style></head><body>
<h1>${orgName || '田径比赛'} - 批量成绩单</h1>
<div class="meta">导出时间: ${new Date().toLocaleString('zh-CN')}</div>
${rows}
<div class="footer">由 竞迹 JingJi 生成</div>
</body></html>`;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${generateExportFilename([orgName, '批量导出', `${races.length}组`])}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── 带完整元数据的单组导出菜单 ──────────────────────────────
function showExportMenu(race, blob) {
  // 创建导出菜单
  const menu = document.createElement('div');
  menu.id = 'export-menu';
  menu.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: #1a1a2e; border-radius: 16px; padding: 24px;
    min-width: 300px; z-index: 10000; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  `;

  menu.innerHTML = `
    <div style="font-size: 18px; font-weight: bold; margin-bottom: 16px; color: #fff">
      导出成绩单
    </div>
    <div style="display: flex; flex-direction: column; gap: 10px;">
      <button onclick="exportToCSV(state.lastRace || getHistory()[0], {includeBest: true, includeLapTimes: true})" style="btn-export">
        CSV 格式 (推荐)
      </button>
      <button onclick="exportToPDF(state.lastRace || getHistory()[0], {includeWeather: true, includeBest: true})" style="btn-export">
        PDF 格式
      </button>
      <button onclick="exportResultsEnhanced(state.lastRace || getHistory()[0])" style="btn-export">
        Excel 格式
      </button>
      <button onclick="exportBatchHistory({format: 'csv'})" style="btn-export">
        批量导出 CSV
      </button>
      <button onclick="exportBatchHistory({format: 'html'})" style="btn-export">
        批量导出 Excel
      </button>
    </div>
    <button onclick="this.closest('#export-menu').remove()" style="margin-top: 16px; width: 100%; padding: 10px; background: #333; color: #fff; border: none; border-radius: 8px; cursor: pointer;">
      关闭
    </button>
  `;

  document.body.appendChild(menu);

  // 添加样式
  const style = document.createElement('style');
  style.textContent = `
    .btn-export {
      padding: 12px 16px;
      background: #ff6200;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      text-align: left;
    }
    .btn-export:hover { background: #e55a00; }
  `;
  document.head.appendChild(style);
}

// ── 批量导出菜单 ──────────────────────────────────────────
function showBatchExportMenu() {
  const history = getHistory();
  if (history.length === 0) {
    showToast('暂无历史成绩可导出', 'warn');
    return;
  }

  // 获取可用的筛选条件
  const distances = [...new Set(history.map(r => r.distance || state.distance))].filter(Boolean);
  const orgName = DOM.orgName?.value?.trim() || '';

  // 创建筛选菜单
  const menu = document.createElement('div');
  menu.id = 'batch-export-menu';
  menu.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: #1a1a2e; border-radius: 16px; padding: 24px;
    min-width: 320px; z-index: 10000; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  `;

  const distanceOptions = distances.length > 0
    ? distances.map(d => `<option value="${d}">${d}m</option>`).join('')
    : `<option value="">全部距离</option>`;

  const dateOptions = history.length > 0
    ? `<option value="">全部日期</option>
       <option value="7">最近7天</option>
       <option value="30">最近30天</option>
       <option value="all">所有历史</option>`
    : '';

  menu.innerHTML = `
    <div style="font-size: 18px; font-weight: bold; margin-bottom: 16px; color: #fff">
      批量导出成绩
    </div>
    <div style="color: #888; font-size: 13px; margin-bottom: 16px;">
      共 ${history.length} 组成绩
    </div>
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div>
        <label style="color: #aaa; font-size: 12px;">距离筛选</label>
        <select id="batch-dist" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #333; background: #2a2a3e; color: #fff;">
          <option value="">全部距离</option>
          ${distanceOptions}
        </select>
      </div>
      <div>
        <label style="color: #aaa; font-size: 12px;">日期范围</label>
        <select id="batch-date" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #333; background: #2a2a3e; color: #fff;">
          ${dateOptions}
        </select>
      </div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 16px;">
      <button onclick="exportBatchHistory({format: 'csv', distance: document.getElementById('batch-dist').value || null})" class="btn-export">
        导出 CSV
      </button>
      <button onclick="exportBatchHistory({format: 'html', distance: document.getElementById('batch-dist').value || null})" class="btn-export">
        导出 Excel
      </button>
    </div>
    <button onclick="this.closest('#batch-export-menu').remove()" style="margin-top: 16px; width: 100%; padding: 10px; background: #333; color: #fff; border: none; border-radius: 8px; cursor: pointer;">
      关闭
    </button>
  `;

  document.body.appendChild(menu);
}

// ── 增强的 Excel 导出 ─────────────────────────────────────
function exportResultsEnhanced(race) {
  const {
    includeBest = true,
    includeLapTimes = true,
    includeMetadata = true,
    includeBestsTable = true
  } = {};

  const orgName = DOM.orgName?.value?.trim() || race.orgName || '';
  const distance = race.distance || state.distance || 0;
  const dateStr = race.date || new Date().toLocaleString('zh-CN');
  const round = race.round || 1;
  const group = race.group || 1;
  const trackLength = race.trackLength || state.trackLength || 400;
  const lapCount = race.lapCount || state.lapCount || 1;

  const sorted = race.lanes.filter(l => l.time != null).sort((a, b) => a.time - b.time);
  const dnf = race.lanes.filter(l => l.time == null);
  const medals = ['🥇', '🥈', '🥉'];
  const maxLaps = Math.max(0, ...race.lanes.map(l => l.lapTimes?.length || 0));

  // 表头
  const thSplits = maxLaps > 1 ? Array.from({ length: maxLaps }, (_, i) => `<th>第${i + 1}圈</th>`).join('') : '';
  const bestCol = includeBest ? '<th>个人最佳</th><th>刷新</th>' : '';

  const makeRow = (l, rank) => {
    const finished = l.time != null;
    const status = l.dnf ? 'DNF' : (finished ? '' : 'DNS');
    const lapTimes = l.lapTimes || [];
    const splits = maxLaps > 1
      ? Array.from({ length: maxLaps }, (_, i) =>
          `<td>${lapTimes[i] != null ? PrecisionTimer.formatFull(lapTimes[i]) : ''}</td>`
        ).join('')
      : '';
    const best = includeBest ? getAthleteBest(l.name, distance) : null;
    const isNewBest = best && finished && l.time <= best.time;
    const bestCell = includeBest
      ? `<td>${best ? PrecisionTimer.formatFull(best.time) : '-'}</td><td>${isNewBest ? 'NEW!' : ''}</td>`
      : '';
    const cls = rank === 1 ? ' class="gold-row"' : (finished ? '' : ' class="dnf-row"');
    return `<tr${cls}>
      <td>${finished ? (medals[rank - 1] || rank) : status}</td>
      <td>${l.id + 1}</td>
      <td>${l.name}</td>
      <td class="time-cell">${finished ? PrecisionTimer.formatFull(l.time) : status}</td>
      ${splits}
      ${bestCell}
    </tr>`;
  };

  const rows = [
    ...sorted.map((l, i) => makeRow(l, i + 1)),
    ...dnf.map(l => makeRow(l, null)),
  ].join('');

  const lapStr = lapCount > 1 ? ` · ${lapCount}圈` : '';
  const distStr = distance ? `${distance}m` : '';
  const metaRows = includeMetadata ? `
    <div class="meta-row"><b>学校/组织：</b>${orgName || '-'}</div>
    <div class="meta-row"><b>比赛日期：</b>${dateStr}</div>
    <div class="meta-row"><b>比赛项目：</b>${distStr}${lapStr}</div>
    <div class="meta-row"><b>跑道长度：</b>${trackLength}m</div>
    <div class="meta-row"><b>组别：</b>第${round}轮 第${group}组</div>
  ` : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:"Microsoft YaHei",Arial,sans-serif;margin:24px;color:#222}
  .header{display:flex;align-items:center;gap:12px;margin-bottom:8px}
  .brand{font-size:24px;font-weight:900;color:#ff6200;letter-spacing:2px}
  .subtitle{font-size:13px;color:#888}
  .meta{font-size:13px;color:#555;line-height:1.8;margin-bottom:12px;padding:10px;background:#f8f8f8;border-radius:6px}
  .meta-row{margin:2px 0}
  table{border-collapse:collapse;width:100%;font-size:14px;margin-top:12px}
  th{background:#ff6200;color:#fff;padding:10px 12px;text-align:center;font-weight:700}
  td{padding:8px 12px;text-align:center;border-bottom:1px solid #eee}
  tr:nth-child(even) td{background:#fafafa}
  .gold-row td{background:#fffde7;font-weight:700}
  .dnf-row td{color:#999;background:#f5f5f5}
  .time-cell{font-family:monospace;font-size:15px;font-weight:700;color:#ff6200}
  .gold-row .time-cell{color:#e65100}
  .footer{font-size:11px;color:#bbb;margin-top:20px;text-align:center}
  .weather{font-size:12px;color:#666;margin-top:4px}
</style></head><body>
<div class="header">
  <span class="brand">竞迹</span>
  <span class="subtitle">精准计时成绩单</span>
</div>
<div class="meta">${metaRows}</div>
<table>
  <thead><tr><th>名次</th><th>道次</th><th>姓名</th><th>成绩</th>${thSplits}${bestCol}</tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">由 竞迹 JingJi 生成 · ${new Date().toLocaleString('zh-CN')}</div>
</body></html>`;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fname = generateExportFilename([orgName, distStr, `第${round}轮第${group}组`]);
  a.href = url;
  a.download = `${fname}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`Excel 已导出: ${fname}.xls`, 'success');
}

// ═══════════════════════════════════════════════════════════════════════════
// 原有的导出函数（保持兼容）
// ═══════════════════════════════════════════════════════════════════════════

function exportResults() {
  const history = getHistory();
  const race = history[0];
  if (!race) { showToast('暂无成绩可导出', 'warn'); return; }

  const orgName = DOM.orgName?.value?.trim() || '';
  const raceName = DOM.raceName?.value?.trim() || race.name || '田径比赛';
  const date = race.date || new Date().toLocaleDateString('zh-CN');
  const dist = state.distance ? `${state.distance}m` : '';

  const sorted = race.lanes.filter(l => l.time != null).sort((a,b) => a.time - b.time);
  const dnf = race.lanes.filter(l => l.time == null);
  const maxLaps = Math.max(0, ...race.lanes.map(l => l.lapTimes?.length || 0));
  const lapCols = maxLaps > 1 ? Array.from({length: maxLaps}, (_, i) => i) : [];

  const thSplits = lapCols.map(i => `<th>第${i+1}圈</th>`).join('');
  const makeRow = (l, rank) => {
    const finished = l.time != null;
    const status = l.dnf ? 'DNF' : 'DNS';
    const splits = lapCols.map(i =>
      `<td>${l.lapTimes?.[i] != null ? PrecisionTimer.formatFull(l.lapTimes[i]) : ''}</td>`
    ).join('');
    const cls = rank === 1 ? ' class="gold-row"' : (finished ? '' : ' class="dnf-row"');
    return `<tr${cls}>
      <td>${finished ? rank : status}</td>
      <td>${l.id + 1}</td>
      <td>${l.name}</td>
      <td class="time-cell">${finished ? PrecisionTimer.formatFull(l.time) : status}</td>
      ${splits}
    </tr>`;
  };

  const rows = [
    ...sorted.map((l, i) => makeRow(l, i + 1)),
    ...dnf.map(l => makeRow(l, null)),
  ].join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:"Microsoft YaHei",Arial,sans-serif;margin:24px;color:#222}
  .header{display:flex;align-items:center;gap:12px;margin-bottom:16px}
  .brand{font-size:22px;font-weight:900;color:#ff6200;letter-spacing:2px}
  .meta{font-size:13px;color:#555;line-height:2;margin-bottom:14px}
  .meta b{color:#222}
  table{border-collapse:collapse;width:100%;font-size:14px}
  th{background:#ff6200;color:#fff;padding:9px 12px;text-align:center;font-weight:700}
  td{padding:8px 12px;text-align:center;border-bottom:1px solid #eee}
  tr:nth-child(even) td{background:#fafafa}
  .gold-row td{background:#fffde7;font-weight:700}
  .dnf-row td{color:#aaa}
  .time-cell{font-family:monospace;font-size:15px;font-weight:700;color:#ff6200}
  .gold-row .time-cell{color:#e65100}
  .footer{font-size:11px;color:#bbb;margin-top:16px}
</style></head><body>
<div class="header">
  <span class="brand">竞迹</span>
  <span style="font-size:15px;color:#555">精准计时成绩单</span>
</div>
<div class="meta">
  ${orgName ? `<b>学校/组织：</b>${orgName}&emsp;` : ''}
  <b>比赛：</b>${raceName}&emsp;
  <b>日期：</b>${date}&emsp;
  ${dist ? `<b>距离：</b>${dist}&emsp;` : ''}
  <b>第 ${race.round} 轮 · 第 ${race.group} 组</b>
</div>
<table>
  <thead><tr><th>名次</th><th>道次</th><th>姓名</th><th>成绩</th>${thSplits}</tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">由 竞迹 JingJi 生成 · ${new Date().toLocaleString('zh-CN')}</div>
</body></html>`;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fname = [orgName, raceName, `第${race.round}轮第${race.group}组`].filter(Boolean).join('_');
  a.href = url; a.download = `${fname}.xls`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('成绩单已导出', 'success');
}

function obsExportGroup() {
  const ri = state.obsRaceInfo;
  const results = state.obsResults.filter(r => !r.isDNF).sort((a,b) => a.raceTime - b.raceTime);
  const dnfs = state.obsResults.filter(r => r.isDNF);
  const medals = ['🥇','🥈','🥉'];
  const org = DOM.orgName?.value?.trim() || '';

  const rows = [
    ...results.map((r,i) => `<tr class="${i===0?'gold-row':''}">
      <td>${medals[i]||i+1}</td><td>${(r.laneIdx??i)+1}</td>
      <td>${r.athleteName||''}</td>
      <td class="time-cell">${PrecisionTimer.formatFull(r.raceTime)}</td>
    </tr>`),
    ...dnfs.map(r => `<tr class="dnf-row"><td>DNF</td><td>${(r.laneIdx??'')+1}</td><td>${r.athleteName||''}</td><td>DNF</td></tr>`),
  ].join('');

  const lapStr = ri.lapsNeeded > 1 ? ` · ${ri.lapsNeeded}圈` : '';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:"Microsoft YaHei",Arial,sans-serif;margin:24px;color:#222}
  .brand{font-size:22px;font-weight:900;color:#ff6200;letter-spacing:2px}
  .meta{font-size:13px;color:#555;line-height:2;margin-bottom:14px}
  table{border-collapse:collapse;width:100%;font-size:14px}
  th{background:#ff6200;color:#fff;padding:9px 12px;text-align:center}
  td{padding:8px 12px;text-align:center;border-bottom:1px solid #eee}
  .gold-row td{background:#fffde7;font-weight:700}
  .dnf-row td{color:#aaa}
  .time-cell{font-family:monospace;font-size:16px;font-weight:700;color:#ff6200}
  .footer{font-size:11px;color:#bbb;margin-top:16px}
</style></head><body>
<div class="brand">竞迹</div>
<div class="meta">
  ${org?`<b>学校/组织：</b>${org}&emsp;`:''}
  ${ri.distance?`<b>距离：</b>${ri.distance}m${lapStr}&emsp;`:''}
  <b>第${ri.round||'?'}轮 · 第${ri.group||'?'}组</b>
</div>
<table><thead><tr><th>名次</th><th>道次</th><th>姓名</th><th>成绩</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="footer">由 竞迹 JingJi 成绩端生成 · ${new Date().toLocaleString('zh-CN')}</div>
</body></html>`;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fname = [org, ri.distance?`${ri.distance}m`:'', `第${ri.round||1}轮第${ri.group||1}组`].filter(Boolean).join('_');
  a.href = url; a.download = `${fname}.xls`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('成绩单已导出', 'success');
}

// ── 保存成绩到管理后台 localStorage & session history ───
function saveGroupToHistory(race) {
  const ADMIN_KEY = 'jingjitimer-history';
  const BACKUP_KEY = 'jingjitimer-backup';
  const group = {
    id:       String(race.id || Date.now()),
    date:     new Date().toISOString(),
    roomCode: state.roomCode || '',
    raceName: race.name || '田径比赛',
    distance: state.distance,
    laps:     state.lapCount,
    round:    race.round || state.currentRound,
    group:    race.group || state.currentGroup,
    results:  state.lanes
      .filter(l => l.time != null || l.dnf)
      .map(l => ({
        laneIdx:  state.lanes.indexOf(l),
        name:     l.name || `${state.lanes.indexOf(l)+1}道`,
        number:   l.number || '',
        team:     l.team || '',
        time:     l.time,
        dnf:      l.dnf || false,
        rank:     l.rank || null,
      }))
  };

  // 保存到管理后台localStorage
  try {
    const existing = JSON.parse(localStorage.getItem(ADMIN_KEY) || '[]');
    existing.unshift(group);
    if (existing.length > 200) existing.length = 200;
    localStorage.setItem(ADMIN_KEY, JSON.stringify(existing));

    // 自动备份到独立key（防止主存储损坏）
    const backup = JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]');
    backup.unshift(group);
    if (backup.length > 500) backup.length = 500;
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
  } catch (e) {
    console.warn('Failed to save group history', e);
  }

  // 添加到会话历史
  state.sessionHistory.unshift(group);
  if (state.sessionHistory.length > 50) state.sessionHistory.length = 50;

  // 更新运动员最佳成绩
  updateBestsFromRace(race);

  // 广播成绩到已连接的观察端
  if (state.role === 'start' && sync.connected) {
    sync.send('RACE_GROUP_RESULT', group);
  }
}

// 从备份恢复数据
function restoreFromBackup() {
  const BACKUP_KEY = 'jingjitimer-backup';
  const ADMIN_KEY = 'jingjitimer-history';

  try {
    const backup = JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]');
    if (backup.length > 0) {
      // 恢复到主存储
      localStorage.setItem(ADMIN_KEY, JSON.stringify(backup.slice(0, 200)));
      return backup.length;
    }
  } catch (e) {
    console.warn('Failed to restore from backup', e);
  }
  return 0;
}

// 清除历史成绩
function clearResults() {
  if (!confirm('确定清除所有历史成绩？此操作不可撤销。')) return;
  localStorage.removeItem('race-history');
  localStorage.removeItem('jingjitimer-history');
  localStorage.removeItem(ATHLETE_BEST_KEY);
  loadHistory();
  renderTrendChart();
  showToast('历史成绩已清除', 'success');
}

function renderHistory(history) {
  if (!history.length) { DOM.historyList.innerHTML = '<p class="hint-text">暂无历史成绩</p>'; return; }
  DOM.historyList.innerHTML = history.slice(0, 10).map(r => {
    const best = r.lanes.filter(l=>l.time!=null).sort((a,b)=>a.time-b.time)[0];
    return `<div class="history-item">
      <div class="history-title">${r.name}</div>
      <div class="history-meta">${r.date} · ${r.lanes.length} 人</div>
      ${best ? `<div class="history-best">🥇 ${best.name} · ${PrecisionTimer.formatFull(best.time)}</div>` : ''}
    </div>`;
  }).join('');
}

// 绘制成绩趋势图表
function renderTrendChart() {
  if (!DOM.trendCanvas) return;

  const history = getHistory();
  const allResults = [];

  // 收集所有有效成绩
  history.forEach(race => {
    race.lanes?.forEach(lane => {
      if (lane.time != null) {
        allResults.push({
          date: race.date,
          time: lane.time,
          name: lane.name
        });
      }
    });
  });

  // 更新统计
  if (DOM.trendBest) DOM.trendBest.textContent = '--';
  if (DOM.trendAvg) DOM.trendAvg.textContent = '--';
  if (DOM.trendCount) DOM.trendCount.textContent = allResults.length;

  if (allResults.length < 2) {
    DOM.trendEmpty?.classList.remove('hidden');
    DOM.trendStats?.classList.add('hidden');
    // 清空画布
    const ctx = DOM.trendCanvas.getContext('2d');
    ctx.clearRect(0, 0, DOM.trendCanvas.width, DOM.trendCanvas.height);
    return;
  }

  DOM.trendEmpty?.classList.add('hidden');
  DOM.trendStats?.classList.remove('hidden');

  // 计算统计数据
  const times = allResults.map(r => r.time);
  const best = Math.min(...times);
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);

  if (DOM.trendBest) DOM.trendBest.textContent = PrecisionTimer.formatFull(best);
  if (DOM.trendAvg) DOM.trendAvg.textContent = PrecisionTimer.formatFull(avg);

  // 绘制图表
  const canvas = DOM.trendCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  // 清空画布
  ctx.clearRect(0, 0, w, h);

  // 取最近10条数据
  const recent = allResults.slice(-10);
  const minTime = Math.min(...recent.map(r => r.time)) * 0.95;
  const maxTime = Math.max(...recent.map(r => r.time)) * 1.05;
  const timeRange = maxTime - minTime;

  // 绘制背景网格
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();
  }

  // 绘制数据线
  ctx.strokeStyle = '#ff6200';
  ctx.lineWidth = 2;
  ctx.beginPath();

  recent.forEach((r, i) => {
    const x = padding.left + (chartW / (recent.length - 1 || 1)) * i;
    const y = padding.top + chartH - ((r.time - minTime) / timeRange) * chartH;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  // 绘制数据点和标签
  recent.forEach((r, i) => {
    const x = padding.left + (chartW / (recent.length - 1 || 1)) * i;
    const y = padding.top + chartH - ((r.time - minTime) / timeRange) * chartH;

    // 数据点
    ctx.fillStyle = i === recent.length - 1 ? '#ff6200' : 'rgba(255,98,0,0.6)';
    ctx.beginPath();
    ctx.arc(x, y, i === recent.length - 1 ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();

    // 数值标签（最后一个点）
    if (i === recent.length - 1) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(PrecisionTimer.formatFull(r.time), x + 8, y + 4);
    }
  });

  // 绘制Y轴标签
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(PrecisionTimer.formatFull(maxTime), padding.left - 5, padding.top + 12);
  ctx.fillText(PrecisionTimer.formatFull(minTime), padding.left - 5, padding.top + chartH);
}

function renderResults(race, blob) {
  DOM.resultsCurrent.classList.remove('hidden');
  DOM.resultsTitle.textContent = race.name;
  DOM.resultsMeta.textContent  = `${race.date} · ${race.lanes.length} 名运动员`;
  const sorted = race.lanes.filter(l=>l.time!=null).sort((a,b)=>a.time-b.time);
  const dnf    = race.lanes.filter(l=>l.time==null);
  const splitsCells = l => l.lapTimes?.length > 1
    ? l.lapTimes.map((t,i) => `<span class="res-split">第${i+1}圈&nbsp;${PrecisionTimer.formatFull(t)}</span>`).join('')
    : '';
  DOM.resultsTableW.innerHTML = `<table class="result-table">
    <thead><tr><th class="rank-col">名次</th><th>姓名</th><th>成绩</th></tr></thead>
    <tbody>${[...sorted,...dnf].map((l,i)=>`<tr class="${i===0?'gold-row':''}">
      <td class="rank-col">${['🥇','🥈','🥉'][i]||i+1}</td>
      <td>${l.name}${splitsCells(l)?`<div class="res-splits">${splitsCells(l)}</div>`:''}</td>
      <td class="time-col">${l.time!=null?PrecisionTimer.formatFull(l.time):(l.dnf?'DNF':'DNS')}</td>
    </tr>`).join('')}</tbody></table>`;
  if (blob) {
    const url = recorder.getObjectURL();
    if (url) { DOM.replayVideo.src = url; DOM.videoReplayCard.classList.remove('hidden'); }
  } else {
    DOM.videoReplayCard.classList.add('hidden');
  }
  renderHistory(getHistory());
}

function exportResults() {

  const history = getHistory();
  const race    = history[0];
  if (!race) { showToast('暂无成绩可导出', 'warn'); return; }

  const orgName  = DOM.orgName?.value?.trim() || '';
  const raceName = DOM.raceName?.value?.trim() || race.name || '田径比赛';
  const date     = race.date || new Date().toLocaleDateString('zh-CN');
  const dist     = state.distance ? `${state.distance}m` : '';

  const sorted = race.lanes.filter(l => l.time != null).sort((a,b) => a.time - b.time);
  const dnf    = race.lanes.filter(l => l.time == null);
  const maxLaps = Math.max(0, ...race.lanes.map(l => l.lapTimes?.length || 0));
  const lapCols = maxLaps > 1 ? Array.from({length: maxLaps}, (_, i) => i) : [];

  const thSplits = lapCols.map(i => `<th>第${i+1}圈</th>`).join('');
  const makeRow  = (l, rank) => {
    const finished = l.time != null;
    const status   = l.dnf ? 'DNF' : 'DNS';
    const splits   = lapCols.map(i =>
      `<td>${l.lapTimes?.[i] != null ? PrecisionTimer.formatFull(l.lapTimes[i]) : ''}</td>`
    ).join('');
    const cls = rank === 1 ? ' class="gold-row"' : (finished ? '' : ' class="dnf-row"');
    return `<tr${cls}>
      <td>${finished ? rank : status}</td>
      <td>${l.id + 1}</td>
      <td>${l.name}</td>
      <td class="time-cell">${finished ? PrecisionTimer.formatFull(l.time) : status}</td>
      ${splits}
    </tr>`;
  };

  const rows = [
    ...sorted.map((l, i) => makeRow(l, i + 1)),
    ...dnf.map(l => makeRow(l, null)),
  ].join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:"Microsoft YaHei",Arial,sans-serif;margin:24px;color:#222}
  .header{display:flex;align-items:center;gap:12px;margin-bottom:16px}
  .brand{font-size:22px;font-weight:900;color:#ff6200;letter-spacing:2px}
  .meta{font-size:13px;color:#555;line-height:2;margin-bottom:14px}
  .meta b{color:#222}
  table{border-collapse:collapse;width:100%;font-size:14px}
  th{background:#ff6200;color:#fff;padding:9px 12px;text-align:center;font-weight:700}
  td{padding:8px 12px;text-align:center;border-bottom:1px solid #eee}
  tr:nth-child(even) td{background:#fafafa}
  .gold-row td{background:#fffde7;font-weight:700}
  .dnf-row td{color:#aaa}
  .time-cell{font-family:monospace;font-size:15px;font-weight:700;color:#ff6200}
  .gold-row .time-cell{color:#e65100}
  .footer{font-size:11px;color:#bbb;margin-top:16px}
</style></head><body>
<div class="header">
  <span class="brand">竞迹</span>
  <span style="font-size:15px;color:#555">精准计时成绩单</span>
</div>
<div class="meta">
  ${orgName ? `<b>学校/组织：</b>${orgName}&emsp;` : ''}
  <b>比赛：</b>${raceName}&emsp;
  <b>日期：</b>${date}&emsp;
  ${dist ? `<b>距离：</b>${dist}&emsp;` : ''}
  <b>第 ${race.round} 轮 · 第 ${race.group} 组</b>
</div>
<table>
  <thead><tr><th>名次</th><th>道次</th><th>姓名</th><th>成绩</th>${thSplits}</tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">由 竞迹 JingJi 生成 · ${new Date().toLocaleString('zh-CN')}</div>
</body></html>`;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const fname = [orgName, raceName, `第${race.round}轮第${race.group}组`].filter(Boolean).join('_');
  a.href = url; a.download = `${fname}.xls`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('✅ 成绩单已导出', 'success');
}

// ── Tab switching ──────────────────────────────────────
function showTab(name) {
  ['setup','race','results'].forEach(t => {
    $(`tab-${t}`).classList.toggle('hidden', t !== name);
  });
  document.querySelectorAll('#tab-bar-start .tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
}

function showTabFinish(_name) {
  // No-op: finish device is now a single fullscreen view
}

// ── UI helpers ─────────────────────────────────────────
function setStatusPill(type, ok) {
  const el = type === 'mic' ? DOM.pillMic : DOM.pillCam;
  el.classList.toggle('ok', ok); el.classList.toggle('fail', !ok);
}

function showToast(msg, type = '') {
  clearTimeout(toastTimer);
  DOM.toast.textContent = msg;
  DOM.toast.className   = `toast ${type}`;
  toastTimer = setTimeout(() => DOM.toast.classList.add('hidden'), 3500);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function flipCamera() {
  state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
  if (!mainStream) return;
  mainStream.getVideoTracks().forEach(t => t.stop());
  try {
    const vs = await navigator.mediaDevices.getUserMedia({ video: { facingMode: state.facingMode } });
    const newT = vs.getVideoTracks()[0];
    mainStream.getVideoTracks().forEach(t => mainStream.removeTrack(t));
    mainStream.addTrack(newT);
    const vids = [DOM.setupVideo, DOM.raceVideo, DOM.finishVideoFs];
    vids.forEach(v => { if (v) { v.srcObject = null; v.srcObject = mainStream; } });
  } catch { showToast('切换摄像头失败', 'error'); }
}

// ── Event listeners ────────────────────────────────────
function attachEventListeners() {
  // Role selection
  DOM.btnRoleSolo.addEventListener('click',   () => selectRole('solo'));
  DOM.btnRoleStart.addEventListener('click',  () => selectRole('start'));
  DOM.btnRoleFinish.addEventListener('click', () => selectRole('finish'));
  $('btn-role-observer')?.addEventListener('click', () => selectRole('observer'));
  DOM.btnConnect.addEventListener('click',    () => connectToRoom());
  DOM.btnRoleConfirm.addEventListener('click',() => confirmRole());

  // Random room code suggestion
  DOM.btnRoomSuggest?.addEventListener('click', () => {
    DOM.roomCodeSet.value = generateRoomCode();
  });

  // Server preset buttons
  document.querySelectorAll('.server-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const server = btn.dataset.server;
      document.querySelectorAll('.server-preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (DOM.serverUrlInput) DOM.serverUrlInput.value = server;
      if (server === '' && DOM.serverCurrent) {
        DOM.serverCurrent.textContent = location.host;
      }
      saveSettings();
    });
  });

  // Server URL input auto-save
  DOM.serverUrlInput?.addEventListener('change', () => {
    saveSettings();
  });

  // Load saved server URL on init
  loadServerSettings();

  // Permission overlay (fallback if auto-request needs retry)
  $('btn-grant-all')?.addEventListener('click', () => requestPermissions());
  $('btn-grant-mic')?.addEventListener('click', () => { DOM.permOverlay.classList.add('hidden'); });
  $('btn-skip-perm')?.addEventListener('click', () => {
    DOM.permOverlay.classList.add('hidden');
    showToast('跳过授权，功能受限', 'warn');
  });

  // Start/solo tabs
  document.querySelectorAll('#tab-bar-start .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Only build lanes if none exist yet (enterRace handles the normal case)
      if (btn.dataset.tab === 'race' && state.lanes.length === 0) {
        buildLanes(); renderLaneCards();
      }
      showTab(btn.dataset.tab);
    });
  });

  // Finish device – settings panel toggle
  DOM.btnFsSettings?.addEventListener('click', () => {
    DOM.fsSettingsPanel?.classList.toggle('hidden');
  });
  DOM.btnFsSettingsClose?.addEventListener('click', () => {
    DOM.fsSettingsPanel?.classList.add('hidden');
  });

  // Finish sensitivity slider
  DOM.fsSensSlider?.addEventListener('input', () => {
    const v = +DOM.fsSensSlider.value;
    detector.threshold = 100 - v;
    if (DOM.fsSensVal) DOM.fsSensVal.textContent = v;
  });

  // Performance mode toggle (with perf monitoring toggle)
  document.querySelectorAll('.perf-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      document.querySelectorAll('.perf-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      detector.setPerformanceMode(mode);
      if (DOM.fsModeVal) DOM.fsModeVal.textContent = mode === 'high' ? '高' : mode === 'balanced' ? '中' : '低';
      saveSettings();
    });
  });

  // 性能监控开关按钮
  $('btn-perf-monitor-toggle')?.addEventListener('click', () => {
    state.perfMonitoringEnabled = !state.perfMonitoringEnabled;
    const btn = $('btn-perf-monitor-toggle');
    if (btn) {
      btn.textContent = state.perfMonitoringEnabled ? '关闭监控' : '开启监控';
      btn.classList.toggle('active', state.perfMonitoringEnabled);
    }
    if (DOM.fsPerfStats) {
      if (state.perfMonitoringEnabled) {
        DOM.fsPerfStats.classList.remove('hidden');
      } else {
        DOM.fsPerfStats.classList.add('hidden');
      }
    }
    showToast(state.perfMonitoringEnabled ? '性能监控已开启' : '性能监控已关闭', 'info');
  });

  // Update perf stats display periodically (only if monitoring is enabled)
  const perfStatsInterval = setInterval(() => {
    if (!state.perfMonitoringEnabled || !DOM.fsPerfStats || !detector) return;
    const stats = detector.getPerformanceStats?.();
    if (stats) {
      DOM.fsPerfStats.classList.remove('hidden');
      if (DOM.fsFpsVal) DOM.fsFpsVal.textContent = stats.fps?.toFixed(1) || '--';
      if (DOM.fsModeVal) DOM.fsModeVal.textContent = stats.mode === 'high' ? '高' : stats.mode === 'balanced' ? '中' : '低';
    }
  }, 1000);

  // Finish flip camera
  DOM.btnFsFlip?.addEventListener('click', () => flipCamera());

  // Next group from end overlay
  DOM.btnFsNextGroup?.addEventListener('click', () => resetFinishDevice());

  // Download video from end overlay
  DOM.btnFsDownload?.addEventListener('click', () => recorder.download('终点录像'));

  // Lane count
  $('btn-lane-minus').addEventListener('click', () => {
    if (state.laneCount > 1) {
      state.laneCount--;
      DOM.laneCountDisp.textContent = state.laneCount;
      buildLaneInputs(); saveSettings(); broadcastConfig();
      updateLaneSyncStatus();
      if (state.role === 'solo' && DOM.raceCanvas && !state.raceStarted) {
        detector.stop();
        detector.init(DOM.raceVideo, DOM.raceCanvas, state.laneCount);
        detector.start(null, null);
      }
    }
  });
  $('btn-lane-plus').addEventListener('click', () => {
    if (state.laneCount >= MAX_LANES) return;
    if (state.laneCount < MAX_LANES) {
      state.laneCount++;
      DOM.laneCountDisp.textContent = state.laneCount;
      buildLaneInputs(); saveSettings(); broadcastConfig();
      updateLaneSyncStatus();
      if (state.role === 'solo' && DOM.raceCanvas && !state.raceStarted) {
        detector.stop();
        detector.init(DOM.raceVideo, DOM.raceCanvas, state.laneCount);
        detector.start(null, null);
      }
    }
  });

  // ── 发令端"自动识别道次"按钮 ──────────────────────────
  $('btn-auto-detect-lanes')?.addEventListener('click', () => {
    if (state.role === 'solo' && detector) {
      // Solo: camera already open on race canvas — run detection directly
      const result = detector.autoDetectLanes(8);
      if (result) {
        state.laneCount = result.lanes;
        DOM.laneCountDisp.textContent = state.laneCount;
        buildLaneInputs(); saveSettings();
        showToast(`📐 识别到 ${result.lanes} 条跑道`, 'success');
      } else {
        showToast('识别失败，请确保终点摄像头已开启且跑道白线清晰可见', 'warn');
      }
    } else if (state.role === 'start' && sync.connected) {
      // Start device: ask finish device to auto-detect and report back
      sync.send('AUTO_DETECT_REQUEST', {});
      showToast('📡 已发送识别请求，等待终点端响应...', 'info');
    } else {
      showToast('请先连接终点设备', 'warn');
    }
  });

  // ── 发令端"采用终点端道次"按钮 ─────────────────────────
  $('btn-lane-sync-adopt')?.addEventListener('click', () => {
    if (!state.finishDeviceLanes) return;
    state.laneCount = state.finishDeviceLanes;
    DOM.laneCountDisp.textContent = state.laneCount;
    buildLaneInputs(); saveSettings(); broadcastConfig();
    updateLaneSyncStatus();
    showToast(`✅ 已采用终点端道次：${state.laneCount} 道`, 'success');
  });

  // Lap count
  const lapMinus = $('btn-lap-minus');
  const lapPlus  = $('btn-lap-plus');
  if (lapMinus) lapMinus.addEventListener('click', () => {
    if (state.lapCount > 1) { state.lapCount--; updateLapDisplay(); saveSettings(); broadcastConfig(); }
  });
  if (lapPlus) lapPlus.addEventListener('click', () => {
    if (state.lapCount < 50) { state.lapCount++; updateLapDisplay(); saveSettings(); broadcastConfig(); }
  });

  // Round / group
  const roundMinus = $('btn-round-minus');
  const roundPlus  = $('btn-round-plus');
  const groupMinus = $('btn-group-minus');
  const groupPlus  = $('btn-group-plus');
  if (roundMinus) roundMinus.addEventListener('click', () => {
    if (state.currentRound > 1) { state.currentRound--; $('round-display').textContent = state.currentRound; }
  });
  if (roundPlus) roundPlus.addEventListener('click', () => {
    state.currentRound++; $('round-display').textContent = state.currentRound;
  });
  if (groupMinus) groupMinus.addEventListener('click', () => {
    if (state.currentGroup > 1) { state.currentGroup--; $('group-display').textContent = state.currentGroup; }
  });
  if (groupPlus) groupPlus.addEventListener('click', () => {
    state.currentGroup++; $('group-display').textContent = state.currentGroup;
  });

  // Roster CSV import
  const rosterFileInput = $('roster-file-input');
  $('btn-roster-import')?.addEventListener('click', () => rosterFileInput?.click());
  rosterFileInput?.addEventListener('change', e => {
    handleRosterImport(e.target.files[0]);
    e.target.value = '';  // allow re-import of same file
  });

  // Quick template buttons
  document.querySelectorAll('.qt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const distance = parseInt(btn.dataset.distance);
      const lanes = parseInt(btn.dataset.lanes);
      applyQuickTemplate(distance, lanes);
    });
  });

  // ── 教师快速开始按钮 ──────────────────────────────────
  const quickStartPresets = [
    { id: 'btn-quick-50m', distance: 50, lanes: 4 },
    { id: 'btn-quick-100m', distance: 100, lanes: 4 },
    { id: 'btn-quick-200m', distance: 200, lanes: 4 },
    { id: 'btn-quick-400m', distance: 400, lanes: 4 },
  ];
  quickStartPresets.forEach(preset => {
    const btn = $(preset.id);
    if (btn) {
      btn.addEventListener('click', () => {
        // 应用预设
        state.distance = preset.distance;
        state.laneCount = preset.lanes;
        state.lapCount = preset.distance > 200 ? Math.ceil(preset.distance / 100) : 1;
        // 更新UI
        DOM.laneCountDisp.textContent = state.laneCount;
        DOM.distSelect.value = preset.distance;
        updateLapDisplay?.();
        saveSettings();
        broadcastConfig?.();
        showTab('race');
        showToast(`✅ 已设置 ${preset.distance}m 比赛，${preset.lanes}条跑道`, 'success');
      });
    }
  });

  // Start mode
  document.querySelectorAll('input[name="start-mode"]').forEach(r => {
    r.addEventListener('change', () => {
      state.startMode = r.value;
      DOM.sensPannel.classList.toggle('hidden', r.value !== 'audio');
    });
  });

  // Sensitivity
  DOM.sensSlider.addEventListener('input', () => {
    const v = DOM.sensSlider.value;
    DOM.sensVal.textContent = v;
    audio.threshold = v / 100;
    DOM.levelLine.style.left = `${v}%`;
  });
  DOM.levelLine.style.left = '75%';

  // Video toggle
  DOM.chkVideo.addEventListener('change', () => { state.videoEnabled = DOM.chkVideo.checked; });

  // Camera flip (start/solo device)
  DOM.btnFlipCam.addEventListener('click', flipCamera);

  // Enter race
  $('btn-enter-race').addEventListener('click', () => enterRace());

  // Practice mode
  $('btn-practice-mode')?.addEventListener('click', () => enterPracticeMode());

  // 独立发令按钮 - 支持手动发令流程
  let gejiuweiClicked = false;
  let yubeiClicked = false;

  $('btn-gejiuwei')?.addEventListener('click', async () => {
    audio.resume();
    gejiuweiClicked = true;
    yubeiClicked = false;
    DOM.timerSub.textContent = '📢 各就位...';
    await starterAudio.playGeJiuWei();
    DOM.timerSub.textContent = '⚡ 预备（等待发令）';
    showToast('📢 各就位完成，等待"枪声"启动计时', 'info');
  });
  $('btn-yubei')?.addEventListener('click', async () => {
    audio.resume();
    yubeiClicked = true;
    DOM.timerSub.textContent = '⚡ 预备...';
    await starterAudio.playYuBei();
    DOM.timerSub.textContent = '🔫 等待枪声...';
    showToast('⚡ 预备完毕，等待"枪声"启动计时', 'info');
  });
  $('btn-gunshot')?.addEventListener('click', async () => {
    audio.resume();
    DOM.timerSub.textContent = '🔫 枪响！计时开始';
    await starterAudio.playGunshot();

    // 重置发令状态
    gejiuweiClicked = false;
    yubeiClicked = false;

    // 如果比赛已开始，只更新时间显示
    if (state.raceStarted) {
      showToast('🔫 枪声已响', 'success');
      return;
    }

    // 启动计时器
    timer.start();
    DOM.timerDisplay.classList.add('running');
    DOM.btnStart.classList.add('hidden');
    DOM.btnStop.classList.remove('hidden');
    DOM.btnAbort?.classList.remove('hidden');

    // 启用录像
    if (state.videoEnabled && state.camGranted && recorder.hasVideo) {
      recorder.start();
      DOM.recBadge.classList.remove('hidden');
    }

    // 启用终点检测（单机模式）
    if (state.role === 'solo' && state.camGranted && DOM.raceCanvas) {
      detector.stop();
      const graceMs = state.lapCount > 1 ? 8000 : Math.round(minRaceGraceMs(state.distance) * 0.70);
      const graceUntil = performance.now() + graceMs;
      detector.cooldownMs = state.lapCount > 1 ? 3000 : 1500;
      DOM.timerSub.textContent = '📷 保护期 ' + Math.ceil(graceMs / 1000) + 's...';
      detector.start(
        (laneIdx) => {
          if (performance.now() < graceUntil) return;
          if (laneIdx < state.laneCount) finishLane(laneIdx);
        },
        (level) => {
          if (performance.now() < graceUntil) {
            const secLeft = Math.ceil((graceUntil - performance.now()) / 1000);
            DOM.timerSub.textContent = `📷 保护期 ${secLeft}s — 忽略误触发`;
            return;
          }
          const pct = Math.min(100, level * 100);
          DOM.timerSub.textContent = level > 0.3 ? `🔴 冲线检测 (${Math.round(pct)}%)` : `🟢 终点监听中`;
        }
      );
    }

    showToast('🚀 计时已启动！', 'success');
  });

  // Race controls
  DOM.btnStart.addEventListener('click',  () => { audio.resume(); beginRace(); });
  DOM.btnStop.addEventListener('click',   () => endRace());
  DOM.btnAbort?.addEventListener('click', () => {
    if (confirm('召回比赛？运动员返回起跑线重新来过。')) abortRace();
  });
  DOM.btnReset.addEventListener('click',  () => {
    if (state.raceStarted && !state.raceFinished && !confirm('确定重置？当前成绩将丢失。')) return;
    resetRace();
  });

  // Close-finish arbitration buttons
  $('cf-confirm')?.addEventListener('click', () => hideCloseFinish());
  $('cf-swap')?.addEventListener('click',    () => swapCloseFinish());

  // Distance selector
  $('race-distance')?.addEventListener('change', function() {
    const customRow = $('custom-dist-row');
    if (this.value === 'custom') {
      customRow?.classList.remove('hidden');
    } else {
      customRow?.classList.add('hidden');
      state.distance = Number(this.value);
      recomputeLaps();   // saves + broadcasts inside
      broadcastConfig();
    }
  });
  $('custom-dist-input')?.addEventListener('input', function() {
    const v = parseFloat(this.value);
    if (v > 0) { state.distance = v; recomputeLaps(); broadcastConfig(); }
  });

  // Track length toggle
  $('btn-track-200')?.addEventListener('click', () => {
    state.trackLength = 200;
    $('btn-track-200').classList.add('active');
    $('btn-track-400').classList.remove('active');
    recomputeLaps(); broadcastConfig();
  });
  $('btn-track-400')?.addEventListener('click', () => {
    state.trackLength = 400;
    $('btn-track-400').classList.add('active');
    $('btn-track-200').classList.remove('active');
    recomputeLaps(); broadcastConfig();
  });

  // Results actions
  DOM.btnDlVideo?.addEventListener('click',    () => recorder.download(DOM.raceName.value));
  DOM.btnExportCsv?.addEventListener('click',  () => exportResults());
  DOM.btnExportXlsx?.addEventListener('click', async () => {
    const race = state.lastRace || getHistory()[0];
    if (race) {
      try {
        await exportXLSX(race, {
          orgName: state.orgName,
          raceName: state.raceName,
          distance: state.distance,
          includeBest: true,
          includeLapTimes: true
        });
      } catch (e) {
        console.error('XLSX export failed:', e);
        showToast('导出失败，请重试', 'error');
      }
    } else {
      showToast('暂无成绩可导出', 'warn');
    }
  });
  DOM.btnExportPdf?.addEventListener('click', async () => {
    const race = state.lastRace || getHistory()[0];
    if (race) await exportToPDF(race, { includeWeather: true, includeBest: true });
    else showToast('暂无成绩可导出', 'warn');
  });
  DOM.btnBatchExport?.addEventListener('click', () => showBatchExportMenu());
  DOM.btnClearRes?.addEventListener('click',  () => clearResults());
  DOM.btnToggleTrend?.addEventListener('click', () => renderTrendChart());

  // Initial trend chart render
  renderTrendChart();
  DOM.btnObsExport?.addEventListener('click',  () => obsExportGroup());
  DOM.btnClearRes?.addEventListener('click',   () => {
    if (!confirm('清除所有历史成绩？')) return;
    localStorage.removeItem('race-history');
    DOM.resultsCurrent.classList.add('hidden');
    DOM.videoReplayCard.classList.add('hidden');
    loadHistory(); showToast('已清除', 'success');
  });

  // Re-size solo race canvas on orientation change / window resize
  window.addEventListener('resize', () => {
    if (state.role !== 'finish' && state.camGranted && DOM.raceCanvas) {
      _initRaceCanvas();
    }
  });

  // Home / back buttons
  $('btn-go-home')?.addEventListener('click', goHome);
  $('btn-fs-home')?.addEventListener('click', goHome);
  $('btn-obs-home')?.addEventListener('click', goHome);

  // ── Device Diagnostic ───────────────────────────────
  const openDiagnostic = () => {
    const diag = $('diagnostic-overlay');
    if (!diag) return;
    diag.classList.remove('hidden');
    runDeviceDiagnostics();
  };

  function runDeviceDiagnostics() {
    // 浏览器信息
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    if (ua.includes('Chrome')) browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari')) browser = 'Safari';
    else if (ua.includes('Edge')) browser = 'Edge';

    let os = 'Unknown';
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iOS')) os = 'iOS';

    $('diag-browser')?.setAttribute('data-value', browser);
    if ($('diag-browser')) $('diag-browser').textContent = browser;
    if ($('diag-os')) $('diag-os').textContent = os;
    if ($('diag-screen')) $('diag-screen').textContent = `${screen.width}×${screen.height}`;
    if ($('diag-dpr')) $('diag-dpr').textContent = window.devicePixelRatio;

    // 网络信息
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      if ($('diag-network')) $('diag-network').textContent = conn.type || '--';
      if ($('diag-efftype')) $('diag-efftype').textContent = conn.effectiveType || '--';
    }
  }

  let testCamStream = null;
  async function testCamera() {
    const statusEl = $('diag-cam-status');
    const previewEl = $('diag-cam-preview');
    const videoEl = $('diag-cam-video');

    try {
      if (statusEl) statusEl.textContent = '正在请求摄像头权限...';
      testCamStream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoEl) {
        videoEl.srcObject = testCamStream;
        previewEl?.classList.remove('hidden');
      }
      if (statusEl) {
        statusEl.textContent = '✅ 摄像头正常';
        statusEl.style.color = '#00e676';
      }
    } catch (e) {
      if (statusEl) {
        statusEl.textContent = '❌ 摄像头无法访问: ' + (e.message || '请检查权限设置');
        statusEl.style.color = '#ff1744';
      }
    }
  }

  let testMicStream = null;
  let micAnalyser = null;
  async function testMicrophone() {
    const statusEl = $('diag-mic-status');
    const visualEl = $('diag-mic-visual');
    const levelEl = $('diag-mic-level');

    try {
      if (statusEl) statusEl.textContent = '正在请求麦克风权限...';
      testMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (visualEl) visualEl.classList.remove('hidden');

      // 设置音量可视化
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(testMicStream);
      micAnalyser = ctx.createAnalyser();
      micAnalyser.fftSize = 256;
      source.connect(micAnalyser);

      const dataArray = new Uint8Array(micAnalyser.frequencyBinCount);
      const updateLevel = () => {
        if (!micAnalyser || !levelEl) return;
        micAnalyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        levelEl.style.width = Math.min(100, avg * 1.5) + '%';
        requestAnimationFrame(updateLevel);
      };
      updateLevel();

      if (statusEl) {
        statusEl.textContent = '✅ 麦克风正常';
        statusEl.style.color = '#00e676';
      }
    } catch (e) {
      if (statusEl) {
        statusEl.textContent = '❌ 麦克风无法访问: ' + (e.message || '请检查权限设置');
        statusEl.style.color = '#ff1744';
      }
    }
  }

  async function runBenchmark() {
    // 简化基准测试：只做一次快速测试，不显示详细进度
    const resultEl = $('diag-result');
    const progressEl = $('diag-progress-bar');
    const benchmarkEl = $('diag-benchmark');

    if (benchmarkEl) benchmarkEl.classList.remove('hidden');
    if (progressEl) progressEl.style.width = '50%';

    const iterations = 50000;
    const start = performance.now();
    for (let j = 0; j < iterations; j++) {
      Math.sqrt(j) * Math.sin(j) + Math.cos(j);
    }
    const elapsed = performance.now() - start;

    if (progressEl) progressEl.style.width = '100%';

    // 简化的性能评级
    let rating = 'unknown';
    if (elapsed < 5) rating = 'excellent';
    else if (elapsed < 10) rating = 'good';
    else if (elapsed < 20) rating = 'average';
    else rating = 'slow';

    const ratingText = { excellent: '优秀', good: '良好', average: '一般', slow: '较慢' };

    if (resultEl) {
      resultEl.innerHTML = `<span>${ratingText[rating] || rating}</span>`;
    }
  }

  // Initialize language support
  initLanguage();
  createLangSwitcher('header-status');

  // Help / guide buttons
  const openGuide = () => $('guide-overlay')?.classList.remove('hidden');
  const closeGuide = () => $('guide-overlay')?.classList.add('hidden');
  $('btn-help')?.addEventListener('click', openGuide);
  $('btn-diagnostic')?.addEventListener('click', openDiagnostic);
  $('btn-diagnostic-close')?.addEventListener('click', () => $('diagnostic-overlay')?.classList.add('hidden'));
  $('btn-diagnostic-ok')?.addEventListener('click', () => $('diagnostic-overlay')?.classList.add('hidden'));
  $('btn-test-cam')?.addEventListener('click', testCamera);
  $('btn-test-mic')?.addEventListener('click', testMicrophone);
  $('btn-benchmark')?.addEventListener('click', runBenchmark);
  $('btn-fs-guide')?.addEventListener('click', () => {
    DOM.fsSettingsPanel?.classList.add('hidden');
    openGuide();
  });
  $('btn-guide-close')?.addEventListener('click', closeGuide);
  $('btn-guide-ok')?.addEventListener('click', closeGuide);
  $('guide-overlay')?.addEventListener('click', e => {
    if (e.target.id === 'guide-overlay') closeGuide();
  });

  // Auto-detect lanes — shared handler for both settings-panel btn and main floating btn
  const doAutoDetect = () => {
    const result = detector.autoDetectLanes(8);
    if (result) {
      state.laneCount        = result.lanes;
      state.autoDetectedLanes = result.lanes;  // mark as authoritative
      showToast(`📐 识别到 ${result.lanes} 条跑道`, 'success');
      updateLaneStatusBar();
      // Sync to start device — start device will auto-adopt this count
      if (sync.connected) sync.send('AUTO_DETECT_RESULT', { lanes: result.lanes });
    } else {
      showToast('识别失败，请确保跑道白线清晰可见，或手动调整', 'warn');
    }
  };
  $('btn-fs-auto-lanes')?.addEventListener('click', doAutoDetect);
  $('btn-fs-auto-lanes-main')?.addEventListener('click', doAutoDetect);

  // Reset lane dividers to equal spacing
  const resetLaneDividers = () => {
    detector._resetDividers(state.laneCount);
    showToast('道次分界线已重置', 'success');
    updateLaneStatusBar();
  };
  $('btn-fs-reset-lanes')?.addEventListener('click', resetLaneDividers);
}

// ── Lane sync status (start device setup page) ─────────
function updateLaneSyncStatus() {
  const row    = $('lane-sync-row');
  const icon   = $('lane-sync-icon');
  const text   = $('lane-sync-text');
  const adopt  = $('btn-lane-sync-adopt');
  if (!row) return;

  // Only relevant on start device when finish device has reported
  if (state.role !== 'start' || !state.finishDeviceLanes) {
    row.classList.add('hidden');
    return;
  }

  row.classList.remove('hidden');
  const fd = state.finishDeviceLanes;  // finish device auto-detected
  const sd = state.laneCount;          // start device current setting

  if (fd === sd) {
    // In sync — current setting matches finish device detection
    icon.textContent  = '✅';
    text.textContent  = `已同步：${sd} 道（摄像头识别）`;
    row.dataset.state = 'ok';
    if (adopt) adopt.classList.add('hidden');
  } else {
    // Manual override — user has changed from the auto-detected value
    // This is intentional! Start device's setting will be used at race time.
    icon.textContent  = '⚙️';
    text.textContent  = `手动 ${sd} 道（摄像头识别 ${fd} 道）`;
    row.dataset.state = 'manual';
    // Offer to revert to auto-detect result
    if (adopt) { adopt.textContent = `恢复识别 ${fd} 道`; adopt.classList.remove('hidden'); }
  }
}

// ── Lane status bar (finish device) ────────────────────
function updateLaneStatusBar() {
  const bar = $('fs-lane-bar');
  if (!bar) return;

  const n = state.laneCount || 4;
  bar.innerHTML = '';

  for (let i = 0; i < n; i++) {
    const done     = detector._laneDone?.has(i);
    const timeLabel= detector._laneFinishLabel?.[i];
    const lapsDone = state.laneCrossings?.[i] ?? 0;
    const rank     = done
      ? (state.crossings?.find(c => c.laneIdx === i)?.rank ?? '')
      : '';

    const cell = document.createElement('div');
    cell.className = `fs-lane-cell${done ? ' done' : ''}`;
    cell.id = `fs-lane-cell-${i}`;

    const rankMedal = rank ? (['🥇','🥈','🥉'][rank - 1] || `#${rank}`) : '';
    cell.innerHTML = `
      <div class="fs-lane-cell-num">${i + 1}道</div>
      <div class="fs-lane-cell-status">
        ${done
          ? `${rankMedal} <span class="fs-lane-cell-time">${timeLabel || ''}</span>`
          : (state.raceStarted ? '⏳' : '—')}
      </div>`;
    bar.appendChild(cell);
  }

  bar.classList.toggle('hidden', !state.raceStarted && !state.raceFinished);
}

// ── Service Worker ─────────────────────────────────────
// 延迟注册 SW，等待页面完全加载后（避免干扰初始化）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    setTimeout(() => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('[SW] Registered:', reg.active?.state))
        .catch(err => console.warn('[SW] Registration failed:', err));
    }, 3000); // 3秒延迟注册
  });
}

// ── Boot ───────────────────────────────────────────────
init().catch(err => {
  console.error('初始化失败:', err);
  // 确保 loading 隐藏，显示错误信息
  const loading = document.getElementById('loading');
  if (loading) loading.classList.add('hidden');
  const roleOverlay = document.getElementById('role-overlay');
  if (roleOverlay) roleOverlay.classList.remove('hidden');
});
