const crypto = require('crypto');
const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.join(__dirname, 'public');
const TURN_SECONDS = 30;


const MAP_POOL = [
  { id: 'ancient', name: 'Ancient', zh: '远古遗迹', color: '#7f8f63', image: '/maps/ancient.jpg', active: true },
  { id: 'anubis', name: 'Anubis', zh: '阿努比斯', color: '#c28c43', image: '/maps/anubis.jpg', active: true },
  { id: 'dust2', name: 'Dust II', zh: '炙热沙城 II', color: '#d3b06c', image: '/maps/dust2.jpg', active: true },
  { id: 'inferno', name: 'Inferno', zh: '炼狱小镇', color: '#b95335', image: '/maps/inferno.jpg', active: true },
  { id: 'mirage', name: 'Mirage', zh: '荒漠迷城', color: '#d6a24d', image: '/maps/mirage.jpg', active: true },
  { id: 'nuke', name: 'Nuke', zh: '核子危机', color: '#4f78a7', image: '/maps/nuke.jpg', active: true },
  { id: 'overpass', name: 'Overpass', zh: '死亡游乐园', color: '#6d8fb8', image: '/maps/overpass.jpg', active: true },
  { id: 'cache', name: 'Cache', zh: '死城之谜', color: '#6f8f59', image: '/maps/cache.jpg', active: false },
  { id: 'vertigo', name: 'Vertigo', zh: '殒命大厦', color: '#5f97b6', image: '/maps/vertigo.jpg', active: false },
  { id: 'train', name: 'Train', zh: '列车停放站', color: '#7b8794', image: '/maps/train.jpg', active: false },
];

const DEFAULT_MAP_IDS = MAP_POOL.filter((m) => m.active).map((m) => m.id);
const MODES = { BO1: 1, BO3: 3, BO5: 5 };

function buildSteps(mode) {
  if (mode === 'BO1') {
    return [
      { team: 'A', type: 'ban', title: 'Team A 禁用 1 张地图' },
      { team: 'B', type: 'ban', title: 'Team B 禁用 1 张地图' },
      { team: 'A', type: 'ban', title: 'Team A 再禁用 1 张地图' },
      { team: 'B', type: 'ban', title: 'Team B 再禁用 1 张地图' },
      { team: 'A', type: 'ban', title: 'Team A 第 3 次禁用地图' },
      { team: 'B', type: 'ban', title: 'Team B 第 3 次禁用地图' },
      { team: 'A', type: 'side', targetMapNo: 1, decider: true, title: 'Team A 为唯一地图选择阵营' },
    ];
  }
  if (mode === 'BO5') {
    return [
      { team: 'A', type: 'ban', title: 'Team A 禁用 1 张地图' },
      { team: 'B', type: 'ban', title: 'Team B 禁用 1 张地图' },
      { team: 'A', type: 'pick', mapNo: 1, title: 'Team A 选择第 1 张图' },
      { team: 'B', type: 'side', targetMapNo: 1, title: 'Team B 为第 1 张图选择阵营' },
      { team: 'B', type: 'pick', mapNo: 2, title: 'Team B 选择第 2 张图' },
      { team: 'A', type: 'side', targetMapNo: 2, title: 'Team A 为第 2 张图选择阵营' },
      { team: 'A', type: 'pick', mapNo: 3, title: 'Team A 选择第 3 张图' },
      { team: 'B', type: 'side', targetMapNo: 3, title: 'Team B 为第 3 张图选择阵营' },
      { team: 'B', type: 'pick', mapNo: 4, title: 'Team B 选择第 4 张图' },
      { team: 'A', type: 'side', targetMapNo: 4, title: 'Team A 为第 4 张图选择阵营' },
      { team: 'A', type: 'side', targetMapNo: 5, decider: true, title: 'Team A 为决胜图选择阵营' },
    ];
  }
  return [
    { team: 'A', type: 'ban', title: 'Team A 禁用 1 张地图' },
    { team: 'B', type: 'ban', title: 'Team B 禁用 1 张地图' },
    { team: 'A', type: 'pick', mapNo: 1, title: 'Team A 选择第 1 张图' },
    { team: 'B', type: 'side', targetMapNo: 1, title: 'Team B 为第 1 张图选择阵营' },
    { team: 'B', type: 'pick', mapNo: 2, title: 'Team B 选择第 2 张图' },
    { team: 'A', type: 'side', targetMapNo: 2, title: 'Team A 为第 2 张图选择阵营' },
    { team: 'B', type: 'ban', title: 'Team B 再禁用 1 张地图' },
    { team: 'A', type: 'ban', title: 'Team A 再禁用 1 张地图' },
    { team: 'B', type: 'side', targetMapNo: 3, decider: true, title: 'Team B 为决胜图选择阵营' },
  ];
}

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Map();

function toBase64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function token(bytes = 12) {
  return toBase64Url(crypto.randomBytes(bytes));
}

function roomId() {
  return crypto.randomBytes(4).toString('hex');
}

function normalizeMode(mode) {
  const value = String(mode || 'BO3').toUpperCase();
  return MODES[value] ? value : 'BO3';
}

function normalizeMapIds(mapIds) {
  const valid = new Set(MAP_POOL.map((m) => m.id));
  const ids = Array.isArray(mapIds) ? mapIds : DEFAULT_MAP_IDS;
  const unique = [];
  for (const id of ids) {
    const value = String(id || '');
    if (valid.has(value) && !unique.includes(value)) unique.push(value);
  }
  if (unique.length !== 7) throw new Error('必须从图池中选择 7 张地图');
  return unique;
}

function freshMaps(mapIds) {
  const selected = normalizeMapIds(mapIds);
  return selected.map((id) => MAP_POOL.find((m) => m.id === id)).map((m) => ({
    ...m,
    status: 'available', // available | banned | picked
    by: null,
    order: null,
    mapNo: null,
    sideChoice: null,
  }));
}

function createRoom({ teamA = 'Team A', teamB = 'Team B', mode = 'BO3', mapIds = DEFAULT_MAP_IDS } = {}) {
  let id;
  do id = roomId(); while (rooms.has(id));
  const now = new Date().toISOString();
  const normalizedMode = normalizeMode(mode);
  const selectedMapIds = normalizeMapIds(mapIds);
  const room = {
    id,
    createdAt: now,
    updatedAt: now,
    teams: { A: teamA.trim() || 'Team A', B: teamB.trim() || 'Team B' },
    tokens: { A: token(), B: token(), admin: token() },
    mode: normalizedMode,
    bestOf: MODES[normalizedMode],
    mapPoolIds: selectedMapIds,
    steps: buildSteps(normalizedMode),
    maps: freshMaps(selectedMapIds),
    currentStep: 0,
    timeline: [],
    ready: { A: false, B: false },
    started: false,
    turnStartedAt: null,
    turnEndsAt: null,
    turnTimer: null,
    finished: false,
    sockets: new Set(),
  };
  rooms.set(id, room);
  return room;
}

function resetRoom(room) {
  clearTurnTimer(room);
  room.maps = freshMaps(room.mapPoolIds);
  room.currentStep = 0;
  room.timeline = [];
  room.ready = { A: false, B: false };
  room.started = false;
  room.turnStartedAt = null;
  room.turnEndsAt = null;
  room.finished = false;
  room.updatedAt = new Date().toISOString();
}

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function roomLinks(room, origin) {
  const qs = (params) => new URLSearchParams(params).toString();
  return {
    admin: `${origin}/?${qs({ room: room.id, role: 'admin', token: room.tokens.admin })}`,
    teamA: `${origin}/?${qs({ room: room.id, role: 'A', token: room.tokens.A })}`,
    teamB: `${origin}/?${qs({ room: room.id, role: 'B', token: room.tokens.B })}`,
    spectator: `${origin}/?${qs({ room: room.id, role: 'spectator' })}`,
  };
}

function getMapByNo(room, mapNo) {
  return room.maps.find((m) => m.mapNo === mapNo);
}

function availableMaps(room) {
  return room.maps.filter((m) => m.status === 'available');
}

function ensureDecider(room, mapNo) {
  const targetMapNo = mapNo || room.bestOf;
  if (getMapByNo(room, targetMapNo)) return;
  const left = availableMaps(room);
  if (left.length !== 1) return;
  const m = left[0];
  m.status = 'picked';
  m.by = 'decider';
  m.mapNo = targetMapNo;
  m.order = room.timeline.length + 1;
  room.timeline.push({
    type: 'decider',
    team: 'system',
    mapId: m.id,
    mapName: m.name,
    zh: m.zh,
    mapNo: targetMapNo,
    at: new Date().toISOString(),
  });
}

function currentTurn(room) {
  if (room.finished || !room.started) return null;
  return room.steps[room.currentStep] || null;
}

function roleOnline(room, role) {
  for (const ws of room.sockets) {
    if (ws.role === role && ws.readyState === ws.OPEN) return true;
  }
  return false;
}

function presence(room) {
  return { A: roleOnline(room, 'A'), B: roleOnline(room, 'B') };
}

function clearTurnTimer(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
}

function scheduleTurnTimer(room) {
  clearTurnTimer(room);
  const step = currentTurn(room);
  if (!step) {
    room.turnStartedAt = null;
    room.turnEndsAt = null;
    return;
  }

  const started = Date.now();
  const stepIndex = room.currentStep;
  room.turnStartedAt = new Date(started).toISOString();
  room.turnEndsAt = new Date(started + TURN_SECONDS * 1000).toISOString();
  room.turnTimer = setTimeout(() => {
    if (!room.started || room.finished || room.currentStep !== stepIndex) return;
    try {
      applyAutoAction(room);
      broadcast(room);
    } catch (err) {
      room.timeline.push({
        type: 'system',
        message: `自动选择失败：${err.message || String(err)}`,
        at: new Date().toISOString(),
      });
      broadcast(room);
    }
  }, TURN_SECONDS * 1000);
}

function startBpIfReady(room) {
  if (room.started || room.finished) return false;
  const online = presence(room);
  if (!online.A || !online.B || !room.ready.A || !room.ready.B) return false;
  room.started = true;
  room.updatedAt = new Date().toISOString();
  scheduleTurnTimer(room);
  return true;
}

function serializeRoom(room, role, origin) {
  const turn = currentTurn(room);
  const maps = [...room.maps].sort((a, b) => {
    const ao = a.mapNo || 99;
    const bo = b.mapNo || 99;
    if (ao !== bo) return ao - bo;
    return MAP_POOL.findIndex((m) => m.id === a.id) - MAP_POOL.findIndex((m) => m.id === b.id);
  });
  const result = {
    id: room.id,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    teams: room.teams,
    mode: room.mode,
    bestOf: room.bestOf,
    mapPoolIds: room.mapPoolIds,
    maps,
    steps: room.steps,
    currentStep: room.currentStep,
    turn,
    timeline: room.timeline,
    started: room.started,
    waitingForPlayers: !room.finished && !room.started,
    presence: presence(room),
    ready: room.ready,
    turnStartedAt: room.turnStartedAt,
    turnEndsAt: room.turnEndsAt,
    turnSeconds: TURN_SECONDS,
    finished: room.finished,
    role,
  };
  if (role === 'admin' && origin) result.links = roomLinks(room, origin);
  return result;
}

function assertCanAct(room, role, payload) {
  if (room.finished) throw new Error('BP 已结束');
  if (!room.started) throw new Error('等待双方进入房间后才会开启 BP');
  const step = currentTurn(room);
  if (!step) throw new Error('没有可执行步骤');
  if (role !== step.team) throw new Error(`当前轮到 ${room.teams[step.team]} 操作`);
  if (!payload || payload.type !== step.type) throw new Error(`当前步骤需要执行 ${step.type}`);
  return step;
}

function applyAction(room, role, payload, options = {}) {
  const step = assertCanAct(room, role, payload);
  const now = new Date().toISOString();

  if (step.type === 'ban' || step.type === 'pick') {
    const map = room.maps.find((m) => m.id === payload.mapId);
    if (!map) throw new Error('地图不存在');
    if (map.status !== 'available') throw new Error('这张地图已经被选择或禁用');

    map.status = step.type === 'ban' ? 'banned' : 'picked';
    map.by = role;
    map.order = room.timeline.length + 1;
    if (step.type === 'pick') map.mapNo = step.mapNo;

    room.timeline.push({
      type: step.type,
      team: role,
      teamName: room.teams[role],
      mapId: map.id,
      mapName: map.name,
      zh: map.zh,
      mapNo: step.mapNo || null,
      at: now,
      auto: Boolean(options.auto),
    });
  } else if (step.type === 'side') {
    const side = String(payload.side || '').toUpperCase();
    if (!['CT', 'T'].includes(side)) throw new Error('阵营只能选择 CT 或 T');
    if (step.decider) ensureDecider(room, step.targetMapNo);
    const map = getMapByNo(room, step.targetMapNo);
    if (!map) throw new Error('目标地图尚未确定');
    if (map.sideChoice) throw new Error('该地图阵营已选择');

    map.sideChoice = { by: role, teamName: room.teams[role], side, at: now };
    room.timeline.push({
      type: 'side',
      team: role,
      teamName: room.teams[role],
      mapId: map.id,
      mapName: map.name,
      zh: map.zh,
      mapNo: step.targetMapNo,
      side,
      at: now,
      auto: Boolean(options.auto),
    });
  }

  room.currentStep += 1;
  const nextStep = room.steps[room.currentStep];
  if (nextStep && nextStep.decider) ensureDecider(room, nextStep.targetMapNo);
  if (room.currentStep >= room.steps.length) {
    room.finished = true;
    clearTurnTimer(room);
    room.turnStartedAt = null;
    room.turnEndsAt = null;
  } else {
    scheduleTurnTimer(room);
  }
  room.updatedAt = now;
}

function randomItem(items) {
  if (!items.length) throw new Error('没有可随机选择的项目');
  return items[crypto.randomInt(items.length)];
}

function applyAutoAction(room) {
  const step = currentTurn(room);
  if (!step) return;
  if (step.type === 'ban' || step.type === 'pick') {
    const map = randomItem(availableMaps(room));
    applyAction(room, step.team, { type: step.type, mapId: map.id }, { auto: true });
    return;
  }
  if (step.type === 'side') {
    applyAction(room, step.team, { type: 'side', side: randomItem(['CT', 'T']) }, { auto: true });
  }
}

function broadcast(room) {
  for (const ws of room.sockets) {
    if (ws.readyState !== ws.OPEN) continue;
    ws.send(JSON.stringify({ type: 'state', state: serializeRoom(room, ws.role, ws.origin) }));
  }
}

function validateRole(room, role, suppliedToken) {
  if (role === 'spectator') return true;
  if (role === 'A' || role === 'B' || role === 'admin') return room.tokens[role] === suppliedToken;
  return false;
}

app.post('/api/rooms', (req, res) => {
  try {
    const room = createRoom(req.body || {});
    res.status(201).json({ id: room.id, links: roomLinks(room, baseUrl(req)) });
  } catch (err) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

app.get('/api/config', (_req, res) => {
  res.json({ maps: MAP_POOL, defaultMapIds: DEFAULT_MAP_IDS, modes: Object.keys(MODES) });
});

app.get('/api/rooms/:id', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });
  res.json(serializeRoom(room, 'spectator'));
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, maps: MAP_POOL.map((m) => m.name) });
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const room = rooms.get(url.searchParams.get('room'));
  const role = url.searchParams.get('role') || 'spectator';
  const suppliedToken = url.searchParams.get('token') || '';
  const origin = req.headers.origin || `http://${req.headers.host}`;

  if (!room || !validateRole(room, role, suppliedToken)) {
    ws.send(JSON.stringify({ type: 'error', error: '房间不存在或链接无效' }));
    ws.close(1008, 'invalid room or role');
    return;
  }

  ws.roomId = room.id;
  ws.role = role;
  ws.origin = origin;
  room.sockets.add(ws);
  ws.send(JSON.stringify({ type: 'state', state: serializeRoom(room, role, origin) }));
  broadcast(room);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: '消息不是合法 JSON' }));
      return;
    }

    try {
      if (msg.type === 'action') {
        applyAction(room, role, msg.payload);
        broadcast(room);
      } else if (msg.type === 'ready') {
        if (role !== 'A' && role !== 'B') throw new Error('只有队伍操作端可以 ready');
        if (room.started) throw new Error('BP 已经开始');
        room.ready[role] = Boolean(msg.ready !== false);
        startBpIfReady(room);
        broadcast(room);
      } else if (msg.type === 'reset') {
        if (role !== 'admin') throw new Error('只有管理员可以重置房间');
        resetRoom(room);
        startBpIfReady(room);
        broadcast(room);
      } else {
        throw new Error('未知消息类型');
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', error: err.message || String(err) }));
    }
  });

  ws.on('close', () => {
    room.sockets.delete(ws);
    broadcast(room);
  });
});

server.listen(PORT, () => {
  console.log(`CS2 BP server listening on http://localhost:${PORT}`);
});
