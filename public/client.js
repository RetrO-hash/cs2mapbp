const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
let ws;
let state;
let toastTimer;
let countdownTimer;
let changedMapIds = new Set();
let vetoFxTimer;
let appConfig = { maps: [], defaultMapIds: [] };
let selectedMapIds = [];

const AGENTS = {
  CT: '/agents/ct.png',
  T: '/agents/t.png',
};

const landing = $('#landing');
const roomEl = $('#room');
const conn = $('#conn');
const roleEl = $('#role');
const mapsEl = $('#maps');
const seriesEl = $('#series');
const timelineEl = $('#timeline');
const sidePicker = $('#sidePicker');
const readyPanel = $('#readyPanel');
const readyA = $('#readyA');
const readyB = $('#readyB');
const readyActions = $('#readyActions');
const readyBtn = $('#readyBtn');
const timerPanel = $('#timerPanel');
const timerText = $('#timerText');
const timerLabel = $('#timerLabel');
const vetoFx = $('#vetoFx');
const floatingResult = $('#floatingResult');
const floatingSeries = $('#floatingSeries');
const hideFloatBtn = $('#hideFloatBtn');
const showFloatBtn = $('#showFloatBtn');
const createMapPool = $('#createMapPool');
const mapSelectHint = $('#mapSelectHint');
const activePoolBtn = $('#activePoolBtn');
let floatHidden = localStorage.getItem('bpFloatHidden') === '1';

function showToast(text) {
  const toast = $('#toast');
  toast.textContent = text;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3800);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function cssUrl(value) {
  // This value is also embedded into an HTML style="" attribute for map cards.
  // Keep it unquoted so inner quotes don't terminate the attribute after rerenders.
  return `url(${String(value || '').replace(/[)"'\\\n\r]/g, '')})`;
}

function detectMapChanges(prev, next) {
  if (!prev || !next) return new Set();
  const before = new Map(prev.maps.map((m) => [m.id, m]));
  const changed = new Set();
  for (const m of next.maps) {
    const old = before.get(m.id);
    if (!old) continue;
    const oldSide = old.sideChoice ? `${old.sideChoice.by}:${old.sideChoice.side}` : '';
    const newSide = m.sideChoice ? `${m.sideChoice.by}:${m.sideChoice.side}` : '';
    if (old.status !== m.status || old.by !== m.by || old.mapNo !== m.mapNo || oldSide !== newSide) {
      changed.add(m.id);
    }
  }
  return changed;
}

function playVetoAnimation(prev, next) {
  if (!prev || !next || next.timeline.length <= prev.timeline.length) return;
  const newItems = next.timeline.slice(prev.timeline.length);
  const item = [...newItems].reverse().find((entry) => entry.type === 'ban' || entry.type === 'pick' || entry.type === 'side');
  if (!item) return;

  const map = next.maps.find((m) => m.id === item.mapId);
  if (!map) return;

  const isSide = item.type === 'side';
  const action = isSide ? `${item.side} SIDE` : item.type.toUpperCase();
  const zhAction = item.type === 'ban' ? '禁用地图' : item.type === 'pick' ? '选择地图' : `选择 ${item.side} 开局`;
  const auto = item.auto ? '<span class="fx-auto">超时随机</span>' : '';
  const agent = isSide ? AGENTS[item.side] : '';

  clearTimeout(vetoFxTimer);
  vetoFx.className = 'veto-fx hidden';
  vetoFx.style.setProperty('--fx-image', cssUrl(map.image));
  vetoFx.style.setProperty('--fx-color', map.color || '#ffb545');
  vetoFx.style.setProperty('--fx-agent', agent ? cssUrl(agent) : 'none');
  vetoFx.innerHTML = `
    <div class="fx-image"></div>
    <div class="fx-scan"></div>
    ${agent ? '<div class="fx-agent"></div>' : ''}
    <div class="fx-content">
      <div class="fx-action">${action}</div>
      <div class="fx-map">${escapeHtml(map.name)}</div>
      <div class="fx-meta">${escapeHtml(item.teamName || teamName(item.team))} · ${zhAction} · ${escapeHtml(map.zh)} ${auto}</div>
    </div>
    <div class="fx-mark">${item.type === 'ban' ? '✕' : item.type === 'side' ? item.side : '✓'}</div>
  `;

  // Force restart CSS animation when actions happen quickly.
  vetoFx.offsetHeight;
  vetoFx.className = `veto-fx ${item.type === 'ban' ? 'ban' : item.type === 'side' ? `side ${item.side.toLowerCase()}` : 'pick'}`;
  vetoFxTimer = setTimeout(() => vetoFx.classList.add('hidden'), 2300);
}

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const q = new URLSearchParams({
    room: params.get('room'),
    role: params.get('role') || 'spectator',
  });
  if (params.get('token')) q.set('token', params.get('token'));
  return `${proto}//${location.host}/ws?${q}`;
}

function myRole() {
  return state?.role || params.get('role') || 'spectator';
}

function teamName(team) {
  if (team === 'A' || team === 'B') return state.teams[team];
  if (team === 'decider') return '系统决胜图';
  return '系统';
}

function focusMapForBackground() {
  if (!state?.maps?.length) return null;
  const turn = state.turn;
  if (turn?.type === 'side') {
    const target = state.maps.find((m) => m.mapNo === turn.targetMapNo);
    if (target) return target;
  }
  const lastMapItem = [...state.timeline].reverse().find((item) => item.mapId);
  if (lastMapItem) {
    const last = state.maps.find((m) => m.id === lastMapItem.mapId);
    if (last) return last;
  }
  return state.maps.find((m) => m.status === 'available') || state.maps[0];
}

function renderArenaBackground() {
  const focus = focusMapForBackground();
  if (!focus) return;
  roomEl.style.setProperty('--arena-image', cssUrl(focus.image));
  roomEl.style.setProperty('--arena-color', focus.color || '#ffb545');
}

function roleLabel(role) {
  return role === 'A' ? `${state?.teams?.A || 'Team A'} 操作端`
    : role === 'B' ? `${state?.teams?.B || 'Team B'} 操作端`
    : role === 'admin' ? '管理员'
    : '观战';
}

async function createRoom(event) {
  event.preventDefault();
  if (selectedMapIds.length !== 7) return showToast('必须选择 7 张地图');
  const form = new FormData(event.currentTarget);
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      teamA: form.get('teamA'),
      teamB: form.get('teamB'),
      mode: form.get('mode'),
      mapIds: selectedMapIds,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return showToast(data.error || '创建房间失败');
  }
  const data = await res.json();
  location.href = data.links.admin;
}

async function loadConfig() {
  const res = await fetch('/api/config');
  appConfig = await res.json();
  selectedMapIds = [...appConfig.defaultMapIds];
  renderCreateMapPool();
}

function renderCreateMapPool() {
  if (!createMapPool) return;
  createMapPool.innerHTML = appConfig.maps.map((m) => {
    const checked = selectedMapIds.includes(m.id);
    return `
      <label class="create-map-card ${checked ? 'selected' : ''}" style="--map-color:${m.color};--map-image:${cssUrl(m.image)}">
        <input type="checkbox" value="${m.id}" ${checked ? 'checked' : ''} />
        <span>${escapeHtml(m.name)}</span>
        <em>${escapeHtml(m.zh)}${m.active ? '' : ' · 非服役'}</em>
      </label>
    `;
  }).join('');
  createMapPool.querySelectorAll('input').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.value;
      if (input.checked) {
        if (selectedMapIds.length >= 7) {
          input.checked = false;
          return showToast('最多只能选择 7 张地图');
        }
        selectedMapIds.push(id);
      } else {
        selectedMapIds = selectedMapIds.filter((x) => x !== id);
      }
      renderCreateMapPool();
    });
  });
  mapSelectHint.textContent = `已选择 ${selectedMapIds.length} / 7`;
  mapSelectHint.classList.toggle('bad', selectedMapIds.length !== 7);
}

function connect() {
  landing.classList.add('hidden');
  roomEl.classList.remove('hidden');
  conn.textContent = '连接中';
  conn.className = 'pill warn';
  ws = new WebSocket(wsUrl());

  ws.addEventListener('open', () => {
    conn.textContent = '已连接';
    conn.className = 'pill ok';
  });
  ws.addEventListener('close', () => {
    conn.textContent = '已断开';
    conn.className = 'pill warn';
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'state') {
      const prevState = state;
      changedMapIds = detectMapChanges(prevState, msg.state);
      state = msg.state;
      render();
      playVetoAnimation(prevState, state);
    } else if (msg.type === 'error') {
      showToast(msg.error);
    }
  });
}

function sendAction(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return showToast('WebSocket 未连接');
  ws.send(JSON.stringify({ type: 'action', payload }));
}

function sendReady(ready = true) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return showToast('WebSocket 未连接');
  ws.send(JSON.stringify({ type: 'ready', ready }));
}

function setCountdown(active) {
  if (active && !countdownTimer) countdownTimer = setInterval(updateCountdown, 250);
  if (!active && countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function updateCountdown() {
  if (!state?.turnEndsAt || !state.started || state.finished) {
    timerPanel.classList.add('hidden');
    setCountdown(false);
    return;
  }
  const total = (state.turnSeconds || 30) * 1000;
  const remaining = Math.max(0, new Date(state.turnEndsAt).getTime() - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  timerText.textContent = String(seconds).padStart(2, '0');
  timerPanel.style.setProperty('--timer-progress', Math.max(0, Math.min(1, remaining / total)));
  timerPanel.classList.toggle('urgent', seconds <= 5);
}

function resetRoom() {
  if (!confirm('确认重置当前房间 BP？')) return;
  ws.send(JSON.stringify({ type: 'reset' }));
}

function copy(text) {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    showToast(ok ? '已复制链接' : '复制失败，请手动复制链接');
  };

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => showToast('已复制链接')).catch(fallback);
  } else {
    fallback();
  }
}

function renderLinks() {
  const panel = $('#sharePanel');
  const linksEl = $('#links');
  if (!state.links) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  const entries = [
    ['Team A', state.links.teamA],
    ['Team B', state.links.teamB],
    ['Observer', state.links.spectator],
    ['Admin', state.links.admin],
  ];
  linksEl.innerHTML = entries.map(([name, url]) => `
    <div class="link-card">
      <strong>${name}</strong>
      <code>${escapeHtml(url)}</code>
      <button class="copy-btn" data-url="${escapeHtml(url)}" type="button">复制</button>
    </div>
  `).join('');
  linksEl.querySelectorAll('.copy-btn').forEach((btn) => btn.addEventListener('click', () => copy(btn.dataset.url)));
}

function renderTurn() {
  const turn = state.turn;
  sidePicker.classList.add('hidden');
  renderReady();
  if (state.finished) {
    $('#turnTitle').textContent = 'BP 已完成';
    $('#turnDesc').textContent = '双方地图与阵营选择已确定。';
    timerPanel.classList.add('hidden');
    setCountdown(false);
    return;
  }
  if (state.waitingForPlayers) {
    $('#turnTitle').textContent = '等待双方进入并 Ready';
    $('#turnDesc').textContent = 'Team A 和 Team B 都进入房间，并点击 Ready 后，才会正式开始 Ban/Pick。';
    timerPanel.classList.add('hidden');
    setCountdown(false);
    return;
  }
  if (!turn) {
    $('#turnTitle').textContent = '等待状态同步';
    $('#turnDesc').textContent = '';
    timerPanel.classList.add('hidden');
    setCountdown(false);
    return;
  }
  $('#turnTitle').textContent = turn.title.replace('Team A', state.teams.A).replace('Team B', state.teams.B);
  const owner = state.teams[turn.team];
  const you = myRole() === turn.team;
  const actionText = turn.type === 'ban' ? '禁用地图' : turn.type === 'pick' ? '选择地图' : '选择开局阵营';
  $('#turnDesc').textContent = you ? `轮到你${actionText}，请在 30 秒内完成。` : `等待 ${owner} ${actionText}，超时将随机选择。`;
  timerPanel.classList.remove('hidden');
  timerLabel.textContent = `${owner} 的 30 秒回合`;
  setCountdown(true);
  updateCountdown();

  if (turn.type === 'side') {
    const map = state.maps.find((m) => m.mapNo === turn.targetMapNo);
    $('#turnDesc').textContent += map ? ` 目标地图：${map.name} / ${map.zh}。` : ' 等待系统确定决胜图。';
    if (you) sidePicker.classList.remove('hidden');
  }
}

function renderReady() {
  const online = state.presence || {};
  const ready = state.ready || {};
  const aOnline = Boolean(online.A);
  const bOnline = Boolean(online.B);
  const aReady = Boolean(ready.A);
  const bReady = Boolean(ready.B);
  readyPanel.classList.toggle('waiting', state.waitingForPlayers);
  readyA.className = `ready-pill ${aOnline ? aReady ? 'ready' : 'online' : 'offline'}`;
  readyB.className = `ready-pill ${bOnline ? bReady ? 'ready' : 'online' : 'offline'}`;
  readyA.textContent = `${state.teams.A} ${aOnline ? aReady ? '已 Ready' : '已进入' : '未进入'}`;
  readyB.textContent = `${state.teams.B} ${bOnline ? bReady ? '已 Ready' : '已进入' : '未进入'}`;

  const role = myRole();
  const canReady = state.waitingForPlayers && (role === 'A' || role === 'B') && Boolean(online[role]);
  readyActions.classList.toggle('hidden', !canReady);
  if (canReady) {
    const mineReady = Boolean(ready[role]);
    readyBtn.textContent = mineReady ? '取消 Ready' : '我已准备，开始 BP';
    readyBtn.classList.toggle('ghost', mineReady);
  }
}

function renderMaps() {
  const turn = state.turn;
  const canChooseMap = turn && ['ban', 'pick'].includes(turn.type) && myRole() === turn.team;
  mapsEl.innerHTML = state.maps.map((m) => {
    const available = m.status === 'available';
    const canAct = canChooseMap && available;
    const mapNo = m.mapNo ? `MAP ${m.mapNo}` : m.status === 'available' ? 'POOL' : 'VETO';
    const statusText = m.status === 'available' ? '可选'
      : m.status === 'banned' ? `已被 ${teamName(m.by)} 禁用`
      : m.by === 'decider' ? `Map ${m.mapNo} · 决胜图` : `Map ${m.mapNo} · ${teamName(m.by)} 选择`;
    const sideText = m.sideChoice ? `<p class="map-side">${escapeHtml(m.sideChoice.teamName)} 选择 ${m.sideChoice.side} 开局</p>` : '';
    const buttons = canAct ? `<div class="map-actions"><button class="${turn.type}-btn" data-map="${m.id}" type="button">${turn.type === 'ban' ? 'BAN' : 'PICK'}</button></div>` : '';
    const changed = changedMapIds.has(m.id);
    return `
      <article class="map-card ${m.status} ${canAct ? 'can-act' : ''} ${changed ? 'just-changed' : ''}" style="--map-color:${m.color};--map-image:${cssUrl(m.image)}">
        <div class="map-photo"></div>
        <div class="map-glow"></div>
        <div class="map-top">
          <span class="map-code">${escapeHtml(mapNo)}</span>
          <span class="badge">${escapeHtml(statusText)}</span>
        </div>
        <div class="map-title">
          <h3>${escapeHtml(m.name)}</h3>
          <div class="zh">${escapeHtml(m.zh)}</div>
        </div>
        ${sideText}
        ${buttons}
      </article>
    `;
  }).join('');
  mapsEl.querySelectorAll('[data-map]').forEach((btn) => {
    btn.addEventListener('click', () => sendAction({ type: state.turn.type, mapId: btn.dataset.map }));
  });
  if (changedMapIds.size) {
    setTimeout(() => {
      changedMapIds.clear();
      mapsEl.querySelectorAll('.just-changed').forEach((el) => el.classList.remove('just-changed'));
    }, 1100);
  }
}

function renderSeries() {
  const count = state.bestOf || 3;
  const picked = Array.from({ length: count }, (_, idx) => state.maps.find((m) => m.mapNo === idx + 1));
  const html = `<div class="series-list">${picked.map((m, idx) => {
    if (!m) return `<div class="series-card"><strong>Map ${idx + 1}</strong><span>待确定</span></div>`;
    const chooser = m.by === 'decider' ? '剩余决胜图' : `${teamName(m.by)} 选择`;
    const side = m.sideChoice ? `${escapeHtml(m.sideChoice.teamName)} 选择 ${m.sideChoice.side}` : '阵营待选';
    return `<div class="series-card"><strong>Map ${m.mapNo}: ${escapeHtml(m.name)}</strong><span>${escapeHtml(m.zh)} · ${escapeHtml(chooser)} · ${side}</span></div>`;
  }).join('')}</div>`;
  seriesEl.innerHTML = html;
  renderFloatingResult(picked);
}

function oppositeSide(side) {
  return side === 'CT' ? 'T' : side === 'T' ? 'CT' : '待选';
}

function startingSideForTeam(map, team) {
  if (!map?.sideChoice) return '待选';
  return map.sideChoice.by === team ? map.sideChoice.side : oppositeSide(map.sideChoice.side);
}

function renderFloatingResult(picked) {
  if (!state.started && !state.finished) {
    floatingResult.classList.add('hidden');
    showFloatBtn.classList.add('hidden');
    return;
  }
  floatingSeries.style.setProperty('--series-count', String(picked.length));
  floatingResult.classList.toggle('final', state.finished);
  floatingResult.querySelector('.float-head strong').textContent = state.finished ? 'BP 完成' : '实时选图';
  floatingSeries.innerHTML = picked.map((m, idx) => {
    if (!m) return `<div class="float-map pending"><b>Map ${idx + 1}</b><span>待确定</span></div>`;
    const side = m.sideChoice ? m.sideChoice.side : '待选边';
    const sideA = startingSideForTeam(m, 'A');
    const sideB = startingSideForTeam(m, 'B');
    return `
      <div class="float-map" style="--map-color:${m.color};--map-image:${cssUrl(m.image)}">
        <div class="float-map-bg"></div>
        <b>MAP ${m.mapNo} · ${escapeHtml(m.name)}</b>
        <span>${escapeHtml(m.zh)} · ${m.sideChoice ? `${escapeHtml(m.sideChoice.teamName)} 选择 ${escapeHtml(side)}` : '阵营待选'}</span>
        <div class="float-sides">
          <em class="${sideA.toLowerCase()}">${escapeHtml(state.teams.A)} 开局 ${escapeHtml(sideA)}</em>
          <em class="${sideB.toLowerCase()}">${escapeHtml(state.teams.B)} 开局 ${escapeHtml(sideB)}</em>
        </div>
      </div>
    `;
  }).join('');
  floatingResult.classList.toggle('hidden', floatHidden);
  showFloatBtn.classList.toggle('hidden', !floatHidden);
}

function renderTimeline() {
  if (!state.timeline.length) {
    timelineEl.innerHTML = '<li>暂无操作</li>';
    return;
  }
  timelineEl.innerHTML = state.timeline.map((item) => {
    const auto = item.auto ? ' <em>超时随机</em>' : '';
    if (item.type === 'ban') return `<li><strong>${escapeHtml(item.teamName)}</strong> ban ${escapeHtml(item.mapName)}${auto}</li>`;
    if (item.type === 'pick') return `<li><strong>${escapeHtml(item.teamName)}</strong> pick Map ${item.mapNo}: ${escapeHtml(item.mapName)}${auto}</li>`;
    if (item.type === 'side') return `<li><strong>${escapeHtml(item.teamName)}</strong> 在 Map ${item.mapNo} ${escapeHtml(item.mapName)} 选择 ${item.side}${auto}</li>`;
    if (item.type === 'system') return `<li><strong>系统</strong> ${escapeHtml(item.message || '')}</li>`;
    return `<li><strong>系统</strong> 将 ${escapeHtml(item.mapName)} 设为 Map 3 决胜图</li>`;
  }).join('');
}

function render() {
  $('#roomId').textContent = state.id;
  $('#teamAName').textContent = state.teams.A;
  $('#teamBName').textContent = state.teams.B;
  $('#seriesMode').textContent = state.mode || 'BO3';
  roleEl.textContent = roleLabel(myRole());
  renderArenaBackground();
  renderLinks();
  renderTurn();
  renderMaps();
  renderSeries();
  renderTimeline();
}

$('#createForm').addEventListener('submit', createRoom);
activePoolBtn.addEventListener('click', () => {
  selectedMapIds = [...appConfig.defaultMapIds];
  renderCreateMapPool();
});
$('#resetBtn').addEventListener('click', resetRoom);
readyBtn.addEventListener('click', () => {
  const role = myRole();
  const mineReady = Boolean(state?.ready?.[role]);
  sendReady(!mineReady);
});
hideFloatBtn.addEventListener('click', () => {
  floatHidden = true;
  localStorage.setItem('bpFloatHidden', '1');
  floatingResult.classList.add('hidden');
  showFloatBtn.classList.remove('hidden');
});
showFloatBtn.addEventListener('click', () => {
  floatHidden = false;
  localStorage.removeItem('bpFloatHidden');
  floatingResult.classList.remove('hidden');
  showFloatBtn.classList.add('hidden');
});
sidePicker.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => sendAction({ type: 'side', side: btn.dataset.side }));
});

if (params.get('room')) connect();
else loadConfig().catch(() => showToast('加载图池失败'));
