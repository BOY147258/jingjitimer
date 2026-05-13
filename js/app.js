import { PrecisionTimer   } from './timer.js';
import { AudioDetector    } from './audio.js';
import { VideoRecorder    } from './recorder.js';
import { Sync, generateRoomCode } from './sync2.js';
import { FinishLineDetector }     from './finishline.js';
import { ApiClient }              from './api-client.js';

// ── Global state ───────────────────────────────────────
const state = {
  role:         'solo',   // 'solo' | 'start' | 'finish'
  laneCount:    4,
  lapCount:     1,        // laps per race (1 = sprint, 4 = 1600m, etc.)
  distance:     100,      // race distance in metres
  trackLength:  400,      // track length in metres
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
  // finish device — per-lane multi-lap tracking
  recordingStart: null,
  crossings:    [],
  finishRecorderBlob: null,
  laneCrossings:       {},   // laneIdx → number of crossings so far
  laneLastCrossingTime:{},   // laneIdx → raceTime (ms) at last crossing
  lanesDone:           0,    // lanes that have completed all laps
};

const timer    = new PrecisionTimer();
const audio    = new AudioDetector();
const recorder = new VideoRecorder();
const sync     = new Sync();
const detector = new FinishLineDetector();

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
  recBadge:       $('rec-badge'),
  camOffMsg:      $('cam-off-msg'),
  timerDisplay:   $('timer-display'),
  timerSub:       $('timer-sub'),
  vizWrap:        $('visualizer-wrap'),
  visualizer:     $('visualizer'),
  visLabel:       $('vis-label'),
  btnStart:       $('btn-race-start'),
  btnStop:        $('btn-race-stop'),
  btnReset:       $('btn-race-reset'),
  lanesWrap:      $('lanes-wrap'),
  // Results
  resultsCurrent: $('results-current'),
  resultsTitle:   $('results-race-title'),
  resultsMeta:    $('results-meta'),
  resultsTableW:  $('results-table-wrap'),
  videoReplayCard:$('video-replay-card'),
  replayVideo:    $('replay-video'),
  btnDlVideo:     $('btn-dl-video'),
  btnExportCsv:   $('btn-export-csv'),
  btnClearRes:    $('btn-clear-results'),
  historyList:    $('history-list'),
  // Finish device – fullscreen
  finishVideoFs:    $('finish-video-fs'),
  finishCanvasFs:   $('finish-canvas-fs'),
  fsConnDot:        $('fs-conn-dot'),
  fsStateLabel:     $('fs-state-label'),
  fsRecDot:         $('fs-rec-dot'),
  fsResults:        $('fs-results'),
  btnFsManual:      $('btn-fs-manual'),
  fsEnd:            $('fs-end'),
  fsEndList:        $('fs-end-list'),
  btnFsNextGroup:   $('btn-fs-next-group'),
  btnFsDownload:    $('btn-fs-download'),
  fsSettingsPanel:  $('fs-settings-panel'),
  fsSensSlider:     $('fs-sensitivity'),
  fsSensVal:        $('fs-sens-val'),
  fsLevelFill:      $('fs-level-fill'),
  fsDetectStatus:   $('fs-detect-status'),
  btnFsFlip:        $('btn-fs-flip'),
  btnFsSettings:    $('btn-fs-settings'),
  btnFsSettingsClose:$('btn-fs-settings-close'),
};

// ── WeChat / browser detection ─────────────────────────
function isWeChat() { return /MicroMessenger/i.test(navigator.userAgent); }
function isHTTPS()  { return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'; }

// ── Init ───────────────────────────────────────────────
async function init() {
  buildLaneInputs();
  attachEventListeners();
  loadHistory();
  populateMeetSelects();
  timer.onChange(ms => { DOM.timerDisplay.textContent = PrecisionTimer.format(ms); });
  await sleep(400);
  DOM.loading.classList.add('hidden');

  // WeChat browser can't use camera/mic at all – tell user to open in real browser
  if (isWeChat()) {
    showWeChatWarning();
    return;
  }

  DOM.roleOverlay.classList.remove('hidden');
}

// ── Backend: populate meet/event selectors ─────────────
async function populateMeetSelects() {
  try {
    const meets = await ApiClient.getMeets();
    if (!meets?.length) return;
    const meetSel  = $('setup-meet-select');
    const eventSel = $('setup-event-select');
    if (!meetSel || !eventSel) return;
    meetSel.innerHTML = '<option value="">— 关联赛事（可选）—</option>' +
      meets.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    meetSel.onchange = async () => {
      const mid = meetSel.value;
      state.meetId  = mid ? Number(mid) : null;
      state.eventId = null;
      if (mid) {
        const evs = await ApiClient.getEvents(mid);
        eventSel.innerHTML = '<option value="">— 关联项目（可选）—</option>' +
          (evs || []).map(e => `<option value="${e.id}" data-laps="${e.laps}" data-rounds="${e.totalRounds}" data-groups="${e.groupsPerRound}">${e.name}</option>`).join('');
        eventSel.parentElement?.classList.remove('hidden');
      } else {
        eventSel.innerHTML = '<option value="">— 关联项目（可选）—</option>';
        eventSel.parentElement?.classList.add('hidden');
      }
    };
    eventSel.onchange = () => {
      const opt = eventSel.selectedOptions[0];
      if (opt?.value) {
        state.eventId = Number(opt.value);
        // Auto-fill laps/rounds/groups from event
        const laps   = Number(opt.dataset.laps)   || 1;
        const rounds = Number(opt.dataset.rounds)  || 1;
        const groups = Number(opt.dataset.groups)  || 1;
        state.lapCount = laps;
        updateLapDisplay();
        const roundDisp = $('round-display');
        const groupDisp = $('group-display');
        if (roundDisp) roundDisp.textContent = state.currentRound;
        if (groupDisp) groupDisp.textContent = state.currentGroup;
      } else {
        state.eventId = null;
      }
    };
  } catch {}
}

function updateLapDisplay() {
  const el = $('lap-count-display');
  if (el) el.textContent = state.lapCount;
}

function recomputeLaps() {
  state.lapCount = Math.max(1, Math.ceil(state.distance / state.trackLength));
  updateLapDisplay();
}

// ── Role selection ─────────────────────────────────────
function selectRole(role) {
  selectedRole = role;
  [DOM.btnRoleSolo, DOM.btnRoleStart, DOM.btnRoleFinish].forEach(b => b.classList.remove('selected'));

  if (role === 'solo') {
    DOM.roomPanel.classList.add('hidden');
    DOM.btnRoleConfirm.classList.remove('hidden');
    DOM.btnRoleSolo.classList.add('selected');
  } else if (role === 'start') {
    DOM.roomPanel.classList.remove('hidden');
    DOM.roomCodeSetWrap.classList.remove('hidden');
    DOM.roomCodeInputW.classList.add('hidden');
    DOM.btnRoleConfirm.classList.add('hidden');
    // Pre-fill with a suggestion; user can clear and type anything
    if (!DOM.roomCodeSet.value) DOM.roomCodeSet.value = generateRoomCode();
    DOM.btnRoleStart.classList.add('selected');
  } else if (role === 'finish') {
    DOM.roomPanel.classList.remove('hidden');
    DOM.roomCodeSetWrap.classList.add('hidden');
    DOM.roomCodeInputW.classList.remove('hidden');
    DOM.btnRoleConfirm.classList.add('hidden');
    DOM.btnRoleFinish.classList.add('selected');
  }
}

async function connectToRoom() {
  DOM.roomStatus.textContent = '连接中...';
  DOM.roomStatus.className   = 'room-status';
  DOM.btnConnect.disabled    = true;

  if (selectedRole === 'start') {
    const code = DOM.roomCodeSet.value.trim();
    if (!code) {
      DOM.roomStatus.textContent = '请设置房间码';
      DOM.roomStatus.className   = 'room-status error';
      DOM.btnConnect.disabled    = false;
      return;
    }
    state.roomCode = code;
  } else if (selectedRole === 'finish') {
    const code = DOM.roomCodeInput.value.trim();
    if (!code) {
      DOM.roomStatus.textContent = '请输入发令端的房间码';
      DOM.roomStatus.className   = 'room-status error';
      DOM.btnConnect.disabled    = false;
      return;
    }
    state.roomCode = code;
  }

  try {
    await sync.join(state.roomCode, selectedRole);
    state.clientId    = sync.clientId;
    state.peerConnected = sync.peerOnline;

    const fc = sync.finishPeerCount;
    DOM.roomStatus.textContent = fc > 0
      ? `✅ 已连接，终点端 ${fc} 个在线`
      : `✅ 已加入房间 ${state.roomCode}（等待终点端）`;
    DOM.roomStatus.className = 'room-status connected';

    // Register sync events
    registerSyncEvents();

    // Show confirm button
    DOM.btnRoleConfirm.classList.remove('hidden');
    showToast(`已加入房间 ${state.roomCode}`, 'success');
  } catch (e) {
    DOM.roomStatus.textContent = '连接失败：' + e.message;
    DOM.roomStatus.className   = 'room-status error';
    DOM.btnConnect.disabled    = false;
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
    } else {
      showToast('发令端已上线', 'success');
      updateConnStatus(true);
    }
    updateFinishBadge();
  });
  sync.on('PEER_LEFT', e => {
    const fc = sync.finishPeerCount;
    state.peerConnected = sync.peerOnline;
    if (e.role === 'finish') {
      showToast(fc > 0 ? `一个终点端离线（剩余 ${fc} 个）` : '终点端已离线', 'warn');
    } else {
      showToast('对端已离线', 'warn');
    }
    updateConnStatus(sync.peerOnline);
    updateFinishBadge();
  });
  sync.on('RACE_CONFIG', e => {
    if (state.role !== 'finish') return;
    if (e.lapsNeeded)   state.lapCount    = e.lapsNeeded;
    if (e.distance)     state.distance    = e.distance;
    if (e.trackLength)  state.trackLength = e.trackLength;
    if (Array.isArray(e.roster) && e.roster.length) {
      state.laneCount = e.roster.length;
      state.lanes = e.roster.map(r => ({
        id: r.id, name: r.name, time: null, rank: null, lapTimes: [], currentLap: 0,
      }));
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
  sync.on('CROSSING', e => {
    if (state.role === 'start') onStartDeviceReceiveCrossing(e);
  });
  sync.on('RACE_END', () => {
    if (state.role === 'finish') onFinishDeviceRaceEnd();
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
  } else {
    DOM.tabBarStart.classList.add('hidden');
    DOM.appTitle.textContent = '🏁 终点端';
    DOM.syncBadge.classList.remove('hidden');
    DOM.syncRoom.textContent = state.roomCode;
    $('tab-finish-main').classList.remove('hidden');
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
    c.width  = window.innerWidth  * devicePixelRatio;
    c.height = window.innerHeight * devicePixelRatio;
    c.style.width  = '100%';
    c.style.height = '100%';
  };
  setTimeout(resizeCanvas, 200);
  window.addEventListener('resize', resizeCanvas);

  detector.init(DOM.finishVideoFs, DOM.finishCanvasFs, state.laneCount);
  detector.bindDrag(DOM.finishCanvasFs);

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
}

function buildLanes() {
  state.lanes = Array.from({ length: state.laneCount }, (_, i) => {
    const input = $(`lane-input-${i}`);
    return {
      id: i,
      name: input ? input.value.trim() || `运动员 ${i+1}` : `运动员 ${i+1}`,
      time: null, rank: null,
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
      <button class="btn-finish" id="btn-finish-${lane.id}" disabled>${multiLap ? '计圈' : '到达终点'}</button>`;
    DOM.lanesWrap.appendChild(card);
    card.querySelector(`#btn-finish-${lane.id}`)
        .addEventListener('click', () => finishLane(lane.id));
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
  if (state.lanes.every(l => l.time !== null)) setTimeout(endRace, 600);
}

// When start device receives a crossing from finish device
function onStartDeviceReceiveCrossing(event) {
  // event: { laneIdx, raceTime, athleteName, rank }
  const laneIdx = event.laneIdx;
  const lane    = state.lanes[laneIdx] || state.lanes[state.lanes.length - 1];
  if (!lane || lane.time !== null) return;

  lane.time = event.raceTime;
  lane.rank = event.rank;

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

  if (state.lanes.every(l => l.time !== null)) setTimeout(endRace, 800);
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
}

function beginRace() {
  if (state.raceStarted) return;
  state.raceStarted = true;
  state.raceFinished = false;
  state.raceStartServerTime = sync.serverNow();

  startBeep();
  if (navigator.vibrate) navigator.vibrate([50, 30, 50, 30, 200]);
  timer.start();
  DOM.timerDisplay.classList.add('running');
  DOM.timerSub.textContent = '计时中...';
  DOM.btnStart.classList.add('hidden');
  DOM.btnStop.classList.remove('hidden');

  if (state.videoEnabled && state.camGranted && recorder.hasVideo) {
    recorder.start();
    DOM.recBadge.classList.remove('hidden');
  }
  state.lanes.forEach(l => {
    const btn = $(`btn-finish-${l.id}`);
    if (btn) btn.disabled = false;
  });

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
  DOM.recBadge.classList.add('hidden');
  state.lanes.forEach(l => {
    const btn = $(`btn-finish-${l.id}`);
    if (btn && !btn.disabled) { btn.disabled = true; btn.textContent = '未完成'; }
  });

  let blob = null;
  if (recorder.recording) blob = await recorder.stop();

  if (state.role === 'start') sync.send('RACE_END', {});

  const race = saveRace(blob);
  autoSaveToBackend(race);
  showToast('✅ 成绩已保存', 'success');

  // Show inline race-end actions in the race tab
  showRaceEndActions(race, blob);
}

function showRaceEndActions(race, blob) {
  const existing = $('race-end-card');
  if (existing) existing.remove();

  const sorted = race.lanes.filter(l => l.time != null).sort((a,b) => a.time - b.time);
  const medals = ['🥇','🥈','🥉'];

  // Podium rows with rank highlight
  const rows = sorted.map((l, i) => `
    <div class="rend-row ${i === 0 ? 'rend-gold' : ''}">
      <span class="rend-medal">${medals[i] || `<span style="width:28px;text-align:center;display:inline-block">#${i+1}</span>`}</span>
      <span class="rend-name">${l.name}</span>
      <span class="rend-time">${PrecisionTimer.formatFull(l.time)}</span>
    </div>`).join('');

  const dnfRows = race.lanes.filter(l => l.time == null).map(l =>
    `<div class="rend-row rend-dnf"><span class="rend-medal">—</span><span class="rend-name">${l.name}</span><span class="rend-time" style="color:var(--text-muted)">DNS</span></div>`
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

  DOM.lanesWrap.insertAdjacentElement('beforebegin', card);

  $('btn-next-group').onclick  = () => { card.remove(); nextGroup(false); };
  $('btn-next-round').onclick  = () => { card.remove(); nextGroup(true); };
  $('btn-see-results').onclick = () => { renderResults(race, blob); showTab('results'); };

  // Play victory sound for winner
  setTimeout(() => { beep(1047, 150); setTimeout(() => beep(1319, 150), 180); setTimeout(() => beep(1568, 300), 360); }, 200);
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
  state.lanes.forEach(l => { l.time = null; l.rank = null; l.lapTimes = []; l.currentLap = 0; });

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

function resetRace() {
  state.raceStarted = false; state.raceFinished = false;
  state.lanes.forEach(l => { l.time = null; l.rank = null; });
  timer.reset();
  resetTimerUI();
  DOM.recBadge.classList.add('hidden');
  renderLaneCards();
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
  state.raceStarted = true;
  state.raceFinished = false;
  state.raceStartServerTime = event._serverTime;
  state.recordingStart = performance.now();
  state.crossings = [];
  state.laneCrossings = {};
  state.laneLastCrossingTime = {};
  state.lanesDone = 0;
  beep(660, 200);

  // Start recording
  if (state.camGranted && recorder.hasVideo) {
    recorder.start();
    DOM.fsRecDot?.classList.remove('hidden');
  }

  // Enable manual backup button
  if (DOM.btnFsManual) DOM.btnFsManual.disabled = false;

  // Re-start detector with full crossing callbacks (same video/canvas, already inited)
  detector.stop();
  detector.init(DOM.finishVideoFs, DOM.finishCanvasFs, state.laneCount);
  detector.bindDrag(DOM.finishCanvasFs);
  detector.start(
    (laneIdx, perfTs) => handleFinishCrossing(laneIdx, perfTs),
    (level) => {
      const pct = Math.min(100, level * 100);
      if (DOM.fsLevelFill) DOM.fsLevelFill.style.width = `${pct}%`;
    }
  );

  // Clear previous result cards
  if (DOM.fsResults) DOM.fsResults.innerHTML = '';
  if (DOM.fsEnd) DOM.fsEnd.classList.add('hidden');

  if (DOM.fsStateLabel) DOM.fsStateLabel.textContent = '🏃 比赛进行中';
  if (DOM.fsConnDot) DOM.fsConnDot.classList.add('connected');
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
  state.laneLastCrossingTime[laneIdx] = raceTime;
  state.laneCrossings[laneIdx]++;
  const crossingNum = state.laneCrossings[laneIdx];

  const laneName = state.lanes[laneIdx]?.name || `运动员 ${laneIdx + 1}`;

  if (crossingNum < state.lapCount) {
    // Intermediate lap — show split
    beep(440, 80);
    if (navigator.vibrate) navigator.vibrate(60);
    renderSplitCard(laneIdx, crossingNum, raceTime, lapTime, laneName);
    sync.send('CROSSING_SPLIT', { laneIdx, raceTime, lapTime, lapNum: crossingNum, athleteName: laneName });
    showToast(`${laneName} 第${crossingNum}圈 ${PrecisionTimer.formatFull(raceTime)}`, 'info');
    return;
  }

  // Final crossing — record finish
  state.lanesDone++;
  const rank = state.lanesDone;

  const crossing = { laneIdx, raceTime, videoOffset, rank, name: laneName, perfTs };
  state.crossings.push(crossing);

  renderCrossingCard(crossing);
  beep(rank === 1 ? 880 : 660, 120);
  if (navigator.vibrate) navigator.vibrate(rank === 1 ? [80, 40, 80] : 120);

  sync.send('CROSSING', { laneIdx, raceTime, rank, athleteName: laneName, lapTime });
  showToast(`🏁 #${rank} ${laneName}  ${PrecisionTimer.formatFull(raceTime)}`, 'success');

  if (state.lanesDone >= state.laneCount) {
    setTimeout(onFinishDeviceRaceEnd, 1000);
  }
}

function renderCrossingCard(crossing) {
  const medals = ['🥇','🥈','🥉'];
  const card   = document.createElement('div');
  card.className = 'fs-result-card';
  card.innerHTML = `
    <div class="fsr-rank">${medals[crossing.rank-1] || `#${crossing.rank}`}</div>
    <div class="fsr-info">
      <div class="fsr-name">${crossing.name}</div>
      <div class="fsr-time">${PrecisionTimer.formatFull(crossing.raceTime)}</div>
    </div>`;
  if (DOM.fsResults) DOM.fsResults.appendChild(card);
  requestAnimationFrame(() => card.classList.add('visible'));
}

function renderSplitCard(laneIdx, lapNum, raceTime, lapTime, laneName) {
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
    </div>`;
  DOM.fsResults.appendChild(card);
  requestAnimationFrame(() => card.classList.add('visible'));
}

async function onFinishDeviceRaceEnd() {
  if (state.raceFinished) return;
  state.raceFinished = true;
  detector.stop();

  DOM.fsRecDot?.classList.add('hidden');
  if (DOM.btnFsManual) DOM.btnFsManual.disabled = true;
  if (DOM.fsStateLabel) DOM.fsStateLabel.textContent = '✅ 比赛结束';

  let blob = null;
  if (recorder.recording) blob = await recorder.stop();
  if (blob) state.finishRecorderBlob = blob;

  // Build end-of-race result list
  if (DOM.fsEndList) {
    const medals = ['🥇','🥈','🥉'];
    DOM.fsEndList.innerHTML = state.crossings
      .map(c => `
        <div class="fs-end-row">
          <span class="fs-end-rank">${medals[c.rank-1] || `#${c.rank}`}</span>
          <span class="fs-end-name">${c.name}</span>
          <span class="fs-end-time">${PrecisionTimer.formatFull(c.raceTime)}</span>
        </div>`)
      .join('');
  }

  if (DOM.fsEnd) DOM.fsEnd.classList.remove('hidden');
  beep(880, 400);
  showToast('✅ 比赛结束', 'success');
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

function showFinishNextGroupBtn() {
  // The next-group button lives in the fs-end overlay — just wire it up
  if (DOM.btnFsNextGroup) {
    DOM.btnFsNextGroup.onclick = resetFinishDevice;
  }
}

function resetFinishDevice() {
  state.raceStarted  = false;
  state.raceFinished = false;
  state.crossings    = [];
  state.laneCrossings = {};
  state.laneLastCrossingTime = {};
  state.lanesDone = 0;
  state.recordingStart = null;
  if (mainStream && state.camGranted) recorder.initFromStream(mainStream);

  if (DOM.fsResults) DOM.fsResults.innerHTML = '';
  if (DOM.fsEnd) DOM.fsEnd.classList.add('hidden');
  if (DOM.fsStateLabel) DOM.fsStateLabel.textContent = '等待发令信号...';
  if (DOM.btnFsManual) DOM.btnFsManual.disabled = true;

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

function renderResults(race, blob) {
  DOM.resultsCurrent.classList.remove('hidden');
  DOM.resultsTitle.textContent = race.name;
  DOM.resultsMeta.textContent  = `${race.date} · ${race.lanes.length} 名运动员`;
  const sorted = race.lanes.filter(l=>l.time!=null).sort((a,b)=>a.time-b.time);
  const dnf    = race.lanes.filter(l=>l.time==null);
  DOM.resultsTableW.innerHTML = `<table class="result-table">
    <thead><tr><th class="rank-col">名次</th><th>姓名</th><th>成绩</th></tr></thead>
    <tbody>${[...sorted,...dnf].map((l,i)=>`<tr class="${i===0?'gold-row':''}">
      <td class="rank-col">${['🥇','🥈','🥉'][i]||i+1}</td>
      <td>${l.name}</td>
      <td class="time-col">${l.time!=null?PrecisionTimer.formatFull(l.time):'DNS'}</td>
    </tr>`).join('')}</tbody></table>`;
  if (blob) {
    const url = recorder.getObjectURL();
    if (url) { DOM.replayVideo.src = url; DOM.videoReplayCard.classList.remove('hidden'); }
  } else {
    DOM.videoReplayCard.classList.add('hidden');
  }
  renderHistory(getHistory());
}

function exportCSV(crossings, raceName) {
  const history = getHistory();
  const data    = crossings || [];
  const name    = raceName  || (history[0]?.name) || '田径比赛';
  const date    = new Date().toLocaleString('zh-CN');
  const lines   = [`比赛名称,${name}`, `日期,${date}`, '', '名次,姓名,成绩(ms),成绩'];

  if (crossings) {
    crossings.forEach((c, i) => {
      lines.push(`${i+1},${c.name},${Math.round(c.raceTime)},${PrecisionTimer.formatFull(c.raceTime)}`);
    });
  } else if (history[0]) {
    history[0].lanes.filter(l=>l.time!=null).sort((a,b)=>a.time-b.time)
      .forEach((l,i) => lines.push(`${i+1},${l.name},${Math.round(l.time)},${PrecisionTimer.formatFull(l.time)}`));
    history[0].lanes.filter(l=>l.time==null)
      .forEach(l => lines.push(`DNS,${l.name},DNS,DNS`));
  }

  const url = URL.createObjectURL(new Blob(['﻿'+lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${name}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('✅ 已导出成绩', 'success');
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
  DOM.btnConnect.addEventListener('click',    () => connectToRoom());
  DOM.btnRoleConfirm.addEventListener('click',() => confirmRole());

  // Random room code suggestion
  DOM.btnRoomSuggest?.addEventListener('click', () => {
    DOM.roomCodeSet.value = generateRoomCode();
  });

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
      if (btn.dataset.tab === 'race' && !state.raceStarted && !state.raceFinished) {
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

  // Finish flip camera
  DOM.btnFsFlip?.addEventListener('click', () => flipCamera());

  // Next group from end overlay
  DOM.btnFsNextGroup?.addEventListener('click', () => resetFinishDevice());

  // Download video from end overlay
  DOM.btnFsDownload?.addEventListener('click', () => recorder.download('终点录像'));

  // Lane count
  $('btn-lane-minus').addEventListener('click', () => {
    if (state.laneCount > 1) { state.laneCount--; DOM.laneCountDisp.textContent = state.laneCount; buildLaneInputs(); }
  });
  $('btn-lane-plus').addEventListener('click', () => {
    if (state.laneCount < 12) { state.laneCount++; DOM.laneCountDisp.textContent = state.laneCount; buildLaneInputs(); }
  });

  // Lap count
  const lapMinus = $('btn-lap-minus');
  const lapPlus  = $('btn-lap-plus');
  if (lapMinus) lapMinus.addEventListener('click', () => {
    if (state.lapCount > 1) { state.lapCount--; updateLapDisplay(); }
  });
  if (lapPlus) lapPlus.addEventListener('click', () => {
    if (state.lapCount < 50) { state.lapCount++; updateLapDisplay(); }
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

  // Race controls
  DOM.btnStart.addEventListener('click',  () => { audio.resume(); beginRace(); });
  DOM.btnStop.addEventListener('click',   () => endRace());
  DOM.btnReset.addEventListener('click',  () => {
    if (state.raceStarted && !state.raceFinished && !confirm('确定重置？当前成绩将丢失。')) return;
    resetRace();
  });

  // Manual crossing (backup) — pick the unfinished lane with fewest crossings
  DOM.btnFsManual?.addEventListener('click', () => {
    let targetLane = 0;
    let minCross   = Infinity;
    for (let i = 0; i < state.laneCount; i++) {
      const c = state.laneCrossings[i] ?? 0;
      if (c < state.lapCount && c < minCross) { minCross = c; targetLane = i; }
    }
    handleFinishCrossing(targetLane, performance.now());
  });

  // Distance selector
  $('race-distance')?.addEventListener('change', function() {
    const customRow = $('custom-dist-row');
    if (this.value === 'custom') {
      customRow?.classList.remove('hidden');
    } else {
      customRow?.classList.add('hidden');
      state.distance = Number(this.value);
      recomputeLaps();
    }
  });
  $('custom-dist-input')?.addEventListener('input', function() {
    const v = parseFloat(this.value);
    if (v > 0) { state.distance = v; recomputeLaps(); }
  });

  // Track length toggle
  $('btn-track-200')?.addEventListener('click', () => {
    state.trackLength = 200;
    $('btn-track-200').classList.add('active');
    $('btn-track-400').classList.remove('active');
    recomputeLaps();
  });
  $('btn-track-400')?.addEventListener('click', () => {
    state.trackLength = 400;
    $('btn-track-400').classList.add('active');
    $('btn-track-200').classList.remove('active');
    recomputeLaps();
  });

  // Results actions
  DOM.btnDlVideo?.addEventListener('click',    () => recorder.download(DOM.raceName.value));
  DOM.btnExportCsv?.addEventListener('click',  () => exportCSV());
  DOM.btnClearRes?.addEventListener('click',   () => {
    if (!confirm('清除所有历史成绩？')) return;
    localStorage.removeItem('race-history');
    DOM.resultsCurrent.classList.add('hidden');
    DOM.videoReplayCard.classList.add('hidden');
    loadHistory(); showToast('已清除', 'success');
  });
}

// ── Service Worker ─────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ── Boot ───────────────────────────────────────────────
init();
