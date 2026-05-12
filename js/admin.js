// Admin dashboard controller
const BASE = '';

// ── API helpers ──────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opts);
  return r.json();
}
const GET    = p => api('GET', p);
const POST   = (p, b) => api('POST', p, b);
const PUT    = (p, b) => api('PUT', p, b);
const DELETE = p => api('DELETE', p);

// ── Utilities ────────────────────────────────────────────────────────────────
function msToDisplay(ms) {
  if (ms == null) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const c = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2,'0')}.${String(c).padStart(2,'0')}`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let _toastTimer;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
}

// ── Navigation ───────────────────────────────────────────────────────────────
const pages = {};
document.querySelectorAll('.page').forEach(p => pages[p.id.replace('page-','')] = p);

let currentPage = 'overview';

document.querySelectorAll('.nav-link').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const page = a.dataset.page;
    showPage(page);
  });
});

function showPage(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
  const el = document.getElementById(`page-${page}`);
  if (el) el.classList.add('active');
  const link = document.querySelector(`.nav-link[data-page="${page}"]`);
  if (link) link.classList.add('active');
  loaders[page]?.();
}

// ── Page loaders ─────────────────────────────────────────────────────────────
const loaders = {
  overview:  loadOverview,
  meets:     loadMeets,
  events:    loadEvents,
  athletes:  loadAthletes,
  results:   loadResults,
  export:    loadExport,
};

// ── STATE ────────────────────────────────────────────────────────────────────
let allMeets    = [];
let allEvents   = [];
let allAthletes = [];
let allResults  = [];

// ── OVERVIEW ─────────────────────────────────────────────────────────────────
async function loadOverview() {
  const stats = await GET('/api/stats');
  document.getElementById('st-meets').textContent    = stats.totalMeets;
  document.getElementById('st-events').textContent   = stats.totalEvents;
  document.getElementById('st-athletes').textContent = stats.totalAthletes;
  document.getElementById('st-results').textContent  = stats.totalResults;

  const tbody = document.querySelector('#best-table tbody');
  tbody.innerHTML = '';
  if (!stats.eventBests?.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">暂无数据</td></tr>';
    return;
  }
  stats.eventBests.forEach(ev => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(ev.eventName)}</td>
      <td class="time-cell">${msToDisplay(ev.best?.timeMs)}</td>
      <td>${esc(ev.best?.athleteName || '—')}</td>
      <td>${ev.count}</td>`;
    tbody.appendChild(tr);
  });
}

// ── MEETS ─────────────────────────────────────────────────────────────────────
async function loadMeets() {
  allMeets = await GET('/api/meets');
  renderMeets();
}

function renderMeets() {
  const tbody = document.querySelector('#meets-table tbody');
  tbody.innerHTML = '';
  if (!allMeets.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">暂无赛事，点击右上角新建</td></tr>';
    return;
  }
  allMeets.forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(m.name)}</strong>${m.notes ? `<br><small style="color:var(--muted)">${esc(m.notes)}</small>` : ''}</td>
      <td>${esc(m.date)}</td>
      <td>${esc(m.location)}</td>
      <td><div class="action-btns">
        <button class="btn-ghost btn-sm" onclick="editMeet(${m.id})">编辑</button>
        <button class="btn-danger btn-sm" onclick="deleteMeet(${m.id})">删除</button>
      </div></td>`;
    tbody.appendChild(tr);
  });
}

let editingMeetId = null;
document.getElementById('btn-add-meet').onclick = () => openMeetModal(null);
document.getElementById('meet-cancel').onclick  = () => closeMeetModal();
document.getElementById('meet-save').onclick    = saveMeet;

function openMeetModal(meet) {
  editingMeetId = meet?.id || null;
  document.getElementById('meet-modal-title').textContent = meet ? '编辑赛事' : '新建赛事';
  document.getElementById('meet-name').value     = meet?.name || '';
  document.getElementById('meet-date').value     = meet?.date || new Date().toISOString().slice(0,10);
  document.getElementById('meet-location').value = meet?.location || '';
  document.getElementById('meet-notes').value    = meet?.notes || '';
  document.getElementById('meet-modal').classList.remove('hidden');
}
function closeMeetModal() { document.getElementById('meet-modal').classList.add('hidden'); }

async function saveMeet() {
  const body = {
    name:     document.getElementById('meet-name').value.trim(),
    date:     document.getElementById('meet-date').value,
    location: document.getElementById('meet-location').value.trim(),
    notes:    document.getElementById('meet-notes').value.trim(),
  };
  if (!body.name) { toast('请填写赛事名称', 'error'); return; }
  if (editingMeetId) {
    await PUT(`/api/meets/${editingMeetId}`, body);
    toast('赛事已更新');
  } else {
    await POST('/api/meets', body);
    toast('赛事已创建');
  }
  closeMeetModal();
  loadMeets();
}

window.editMeet = async (id) => {
  const meet = allMeets.find(m => m.id === id);
  if (meet) openMeetModal(meet);
};
window.deleteMeet = async (id) => {
  if (!confirm('确认删除此赛事？')) return;
  await DELETE(`/api/meets/${id}`);
  toast('已删除');
  loadMeets();
};

// ── EVENTS ───────────────────────────────────────────────────────────────────
async function loadEvents() {
  [allMeets, allEvents] = await Promise.all([GET('/api/meets'), GET('/api/events')]);
  populateMeetSelect('event-meet-filter', allMeets, '— 选择赛事（全部）—');
  renderEvents();
}

function populateMeetSelect(selectId, meets, placeholder = '— 选择赛事 —') {
  const sel = document.getElementById(selectId);
  const cur = sel.value;
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    meets.map(m => `<option value="${m.id}" ${String(m.id) === cur ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
}

document.getElementById('event-meet-filter').onchange = renderEvents;
document.getElementById('btn-add-event').onclick = () => openEventModal(null);
document.getElementById('event-cancel').onclick  = () => closeEventModal();
document.getElementById('event-save').onclick    = saveEvent;

function renderEvents() {
  const meetId = document.getElementById('event-meet-filter').value;
  const filtered = meetId ? allEvents.filter(e => String(e.meetId) === meetId) : allEvents;
  const tbody = document.querySelector('#events-table tbody');
  tbody.innerHTML = '';
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">暂无项目</td></tr>';
    return;
  }
  filtered.forEach(ev => {
    const meet = allMeets.find(m => m.id === ev.meetId);
    tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(ev.name)}</strong><br><small style="color:var(--muted)">${esc(meet?.name || '')}</small></td>
      <td>${esc(ev.distance)}</td>
      <td>${ev.laps}</td>
      <td>${ev.totalRounds}</td>
      <td>${ev.groupsPerRound}</td>
      <td>${ev.advanceCount || '—'}</td>
      <td><div class="action-btns">
        <button class="btn-ghost btn-sm" onclick="editEvent(${ev.id})">编辑</button>
        <button class="btn-danger btn-sm" onclick="deleteEvent(${ev.id})">删除</button>
      </div></td>`;
    tbody.appendChild(tr);
  });
}

let editingEventId = null;
function openEventModal(ev) {
  editingEventId = ev?.id || null;
  document.getElementById('event-modal-title').textContent = ev ? '编辑项目' : '新建项目';
  // populate meet select inside modal
  const sel = document.getElementById('event-meetId');
  sel.innerHTML = allMeets.map(m => `<option value="${m.id}" ${ev?.meetId===m.id?'selected':''}>${esc(m.name)}</option>`).join('');
  document.getElementById('event-name').value     = ev?.name || '';
  document.getElementById('event-distance').value = ev?.distance || '';
  document.getElementById('event-laps').value     = ev?.laps || 1;
  document.getElementById('event-rounds').value   = ev?.totalRounds || 1;
  document.getElementById('event-groups').value   = ev?.groupsPerRound || 1;
  document.getElementById('event-advance').value  = ev?.advanceCount || 0;
  document.getElementById('event-gender').value   = ev?.gender || 'mixed';
  document.getElementById('event-modal').classList.remove('hidden');
}
function closeEventModal() { document.getElementById('event-modal').classList.add('hidden'); }

async function saveEvent() {
  const body = {
    meetId:         Number(document.getElementById('event-meetId').value),
    name:           document.getElementById('event-name').value.trim(),
    distance:       document.getElementById('event-distance').value.trim(),
    laps:           Number(document.getElementById('event-laps').value),
    totalRounds:    Number(document.getElementById('event-rounds').value),
    groupsPerRound: Number(document.getElementById('event-groups').value),
    advanceCount:   Number(document.getElementById('event-advance').value),
    gender:         document.getElementById('event-gender').value,
  };
  if (!body.name || !body.meetId) { toast('请填写项目名称并选择赛事', 'error'); return; }
  if (editingEventId) {
    await PUT(`/api/events/${editingEventId}`, body);
    toast('项目已更新');
  } else {
    await POST('/api/events', body);
    toast('项目已创建');
  }
  closeEventModal();
  loadEvents();
}

window.editEvent = (id) => { const ev = allEvents.find(e => e.id === id); if (ev) openEventModal(ev); };
window.deleteEvent = async (id) => {
  if (!confirm('确认删除此项目？')) return;
  await DELETE(`/api/events/${id}`);
  toast('已删除');
  loadEvents();
};

// ── ATHLETES ─────────────────────────────────────────────────────────────────
async function loadAthletes() {
  allAthletes = await GET('/api/athletes');
  renderAthletes(allAthletes);
}

function renderAthletes(list) {
  const tbody = document.querySelector('#athletes-table tbody');
  tbody.innerHTML = '';
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">暂无运动员</td></tr>';
    return;
  }
  list.forEach(a => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(a.name)}</strong></td>
      <td>${esc(a.number)}</td>
      <td>${esc(a.team)}</td>
      <td>${a.gender === 'male' ? '男' : a.gender === 'female' ? '女' : '—'}</td>
      <td><div class="action-btns">
        <button class="btn-ghost btn-sm" onclick="editAthlete(${a.id})">编辑</button>
        <button class="btn-danger btn-sm" onclick="deleteAthlete(${a.id})">删除</button>
      </div></td>`;
    tbody.appendChild(tr);
  });
}

let _searchTimer;
document.getElementById('athlete-search').oninput = function() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(async () => {
    const q = this.value.trim();
    if (!q) { renderAthletes(allAthletes); return; }
    const res = await GET(`/api/athletes?q=${encodeURIComponent(q)}`);
    renderAthletes(res);
  }, 300);
};

let editingAthleteId = null;
document.getElementById('btn-add-athlete').onclick = () => openAthleteModal(null);
document.getElementById('ath-cancel').onclick = () => closeAthleteModal();
document.getElementById('ath-save').onclick = saveAthlete;

function openAthleteModal(a) {
  editingAthleteId = a?.id || null;
  document.getElementById('athlete-modal-title').textContent = a ? '编辑运动员' : '新增运动员';
  document.getElementById('ath-name').value   = a?.name || '';
  document.getElementById('ath-number').value = a?.number || '';
  document.getElementById('ath-team').value   = a?.team || '';
  document.getElementById('ath-gender').value = a?.gender || '';
  document.getElementById('ath-dob').value    = a?.dob || '';
  document.getElementById('athlete-modal').classList.remove('hidden');
}
function closeAthleteModal() { document.getElementById('athlete-modal').classList.add('hidden'); }

async function saveAthlete() {
  const body = {
    name:   document.getElementById('ath-name').value.trim(),
    number: document.getElementById('ath-number').value.trim(),
    team:   document.getElementById('ath-team').value.trim(),
    gender: document.getElementById('ath-gender').value,
    dob:    document.getElementById('ath-dob').value,
  };
  if (!body.name) { toast('请填写姓名', 'error'); return; }
  if (editingAthleteId) {
    await PUT(`/api/athletes/${editingAthleteId}`, body);
    toast('已更新');
  } else {
    await POST('/api/athletes', body);
    toast('已添加');
  }
  closeAthleteModal();
  loadAthletes();
}

window.editAthlete = (id) => { const a = allAthletes.find(x => x.id === id); if (a) openAthleteModal(a); };
window.deleteAthlete = async (id) => {
  if (!confirm('确认删除？')) return;
  await DELETE(`/api/athletes/${id}`);
  toast('已删除');
  loadAthletes();
};

// ── RESULTS ───────────────────────────────────────────────────────────────────
async function loadResults() {
  [allMeets, allEvents] = await Promise.all([GET('/api/meets'), GET('/api/events')]);
  populateMeetSelect('res-meet-filter', allMeets, '— 赛事 —');
  populateMeetSelect('exp-meet', allMeets, '— 选择赛事 —');
  populateMeetSelect('exp-event-meet', allMeets, '— 先选赛事 —');
  renderResults();
}

document.getElementById('res-meet-filter').onchange = async function() {
  const meetId = this.value;
  const sel = document.getElementById('res-event-filter');
  if (meetId) {
    const evs = allEvents.filter(e => String(e.meetId) === meetId);
    sel.innerHTML = '<option value="">— 项目 —</option>' +
      evs.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  } else {
    sel.innerHTML = '<option value="">— 项目 —</option>';
  }
  renderResults();
};

document.getElementById('res-event-filter').onchange = function() {
  const eventId = this.value;
  const ev = allEvents.find(e => String(e.id) === eventId);
  const roundSel = document.getElementById('res-round-filter');
  const groupSel = document.getElementById('res-group-filter');
  if (ev) {
    roundSel.innerHTML = '<option value="">— 轮次 —</option>' +
      Array.from({length: ev.totalRounds}, (_,i) =>
        `<option value="${i+1}">第${i+1}轮</option>`).join('');
    groupSel.innerHTML = '<option value="">— 组别 —</option>' +
      Array.from({length: ev.groupsPerRound}, (_,i) =>
        `<option value="${i+1}">第${i+1}组</option>`).join('');
  } else {
    roundSel.innerHTML = '<option value="">— 轮次 —</option>';
    groupSel.innerHTML = '<option value="">— 组别 —</option>';
  }
  renderResults();
};

document.getElementById('res-round-filter').onchange = renderResults;
document.getElementById('res-group-filter').onchange = renderResults;

document.getElementById('btn-rank').onclick = async () => {
  const eventId = document.getElementById('res-event-filter').value;
  if (!eventId) { toast('请先选择项目', 'error'); return; }
  const round = document.getElementById('res-round-filter').value || null;
  const group = document.getElementById('res-group-filter').value || null;
  const r = await POST('/api/rank', { eventId: Number(eventId), round: round ? Number(round) : null, group: group ? Number(group) : null });
  toast(`已对 ${r.ranked} 条成绩排名`);
  renderResults();
};

async function renderResults() {
  const meetId  = document.getElementById('res-meet-filter').value;
  const eventId = document.getElementById('res-event-filter').value;
  const round   = document.getElementById('res-round-filter').value;
  const group   = document.getElementById('res-group-filter').value;

  let qs = '';
  if (eventId) qs = `?eventId=${eventId}`;
  else if (meetId) qs = `?meetId=${meetId}`;

  allResults = await GET(`/api/results${qs}`);

  let filtered = allResults;
  if (round) filtered = filtered.filter(r => String(r.round) === round);
  if (group) filtered = filtered.filter(r => String(r.group) === group);
  filtered.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || (a.timeMs ?? Infinity) - (b.timeMs ?? Infinity));

  const evMap = Object.fromEntries(allEvents.map(e => [e.id, e]));
  const tbody = document.querySelector('#results-table tbody');
  tbody.innerHTML = '';
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">暂无成绩记录</td></tr>';
    return;
  }
  filtered.forEach(r => {
    const ev = evMap[r.eventId] || {};
    const laps = (r.lapTimes || []).map(msToDisplay).join(' | ');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="rank-cell">${r.rank ?? '—'}</td>
      <td>${esc(r.athleteName)}</td>
      <td>${esc(r.number)}</td>
      <td>${esc(r.team)}</td>
      <td>${r.laneIndex != null ? r.laneIndex + 1 : '—'}</td>
      <td class="time-cell">${msToDisplay(r.timeMs)}</td>
      <td class="lap-cell">${laps || '—'}</td>
      <td class="${r.qualified ? 'qualified-yes' : 'qualified-no'}">${r.qualified ? '✓ 晋级' : '—'}</td>
      <td>第${r.round}轮 第${r.group}组</td>
      <td><button class="btn-danger btn-sm" onclick="deleteResult(${r.id})">删除</button></td>`;
    tbody.appendChild(tr);
  });
}

window.deleteResult = async (id) => {
  if (!confirm('确认删除此成绩记录？')) return;
  await DELETE(`/api/results/${id}`);
  toast('已删除');
  renderResults();
};

// ── EXPORT ────────────────────────────────────────────────────────────────────
async function loadExport() {
  allMeets  = await GET('/api/meets');
  allEvents = await GET('/api/events');
  populateMeetSelect('exp-meet', allMeets, '— 选择赛事 —');
  populateMeetSelect('exp-event-meet', allMeets, '— 先选赛事 —');
}

document.getElementById('exp-event-meet').onchange = function() {
  const meetId = this.value;
  const sel = document.getElementById('exp-event');
  if (meetId) {
    const evs = allEvents.filter(e => String(e.meetId) === meetId);
    sel.innerHTML = '<option value="">— 选择项目 —</option>' +
      evs.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  } else {
    sel.innerHTML = '<option value="">— 选择项目 —</option>';
  }
};

document.getElementById('btn-exp-meet').onclick = () => {
  const id = document.getElementById('exp-meet').value;
  if (!id) { toast('请选择赛事', 'error'); return; }
  window.location.href = `/api/export/csv?meetId=${id}`;
};
document.getElementById('btn-exp-event').onclick = () => {
  const id = document.getElementById('exp-event').value;
  if (!id) { toast('请选择项目', 'error'); return; }
  window.location.href = `/api/export/csv?eventId=${id}`;
};
document.getElementById('btn-exp-all').onclick = () => {
  window.location.href = `/api/export/csv`;
};

// ── INIT ──────────────────────────────────────────────────────────────────────
loadOverview();
