# CS2 在线地图 BP WebSocket 服务

一个轻量级 CS2 地图 Ban/Pick 房间系统，支持房间链接分享、双队实时 WebSocket 同步、管理员/观战端、Ready 后开局、30 秒超时随机选择、全屏 BP 动画和最终结果展示。

## 功能特性

- 支持 BO1 / BO3 / BO5 三种赛制。
- 创建房间时可从完整 10 图池中选择 7 张进入本场 BP。
- 默认一键使用当前服役 7 图池。
- Team A / Team B 都进入并点击 Ready 后才开始 BP。
- 每轮操作 30 秒倒计时，超时自动随机 ban / pick / 选边。
- 管理员端可复制 Team A、Team B、Observer、Admin 链接。
- 支持观战端实时同步。
- 地图卡片、ban/pick、选边和最终结果均带地图背景与动画。
- BP 完成后全屏显示 MAP 结果和双方开局 CT/T。

## 运行

```powershell
npm install
npm start
```

默认监听：

```text
http://localhost:8080
```

也可以自定义端口：

```powershell
$env:PORT=3000; npm start
```

## 创建房间

1. 输入 Team A / Team B 名称。
2. 选择模式：BO1、BO3 或 BO5。
3. 从 10 张地图中选择 7 张作为本场图池。
4. 点击“创建 BP 房间”。
5. 管理员复制 Team A / Team B 链接给双方。
6. 双方进入并点击 Ready 后开始 BP。

## 完整图池

当前可选 10 张地图：

- Ancient / 远古遗迹
- Anubis / 阿努比斯
- Dust II / 炙热沙城 II
- Inferno / 炼狱小镇
- Mirage / 荒漠迷城
- Nuke / 核子危机
- Overpass / 死亡游乐园
- Cache / 死城之谜（非服役）
- Vertigo / 殒命大厦（非服役）
- Train / 列车停放站（非服役）

默认服役 7 图池为：Ancient、Anubis、Dust II、Inferno、Mirage、Nuke、Overpass。

## BP 规则

### BO1

1. Team A ban
2. Team B ban
3. Team A ban
4. Team B ban
5. Team A ban
6. Team B ban
7. 剩余地图为唯一比赛地图，Team A 选择开局阵营

### BO3

1. Team A ban
2. Team B ban
3. Team A pick Map 1
4. Team B 选择 Map 1 阵营
5. Team B pick Map 2
6. Team A 选择 Map 2 阵营
7. Team B ban
8. Team A ban
9. 剩余地图为 Map 3 decider，Team B 选择 Map 3 阵营

### BO5

1. Team A ban
2. Team B ban
3. Team A pick Map 1
4. Team B 选择 Map 1 阵营
5. Team B pick Map 2
6. Team A 选择 Map 2 阵营
7. Team A pick Map 3
8. Team B 选择 Map 3 阵营
9. Team B pick Map 4
10. Team A 选择 Map 4 阵营
11. 剩余地图为 Map 5 decider，Team A 选择 Map 5 阵营

## API

```text
GET  /api/health
GET  /api/config
POST /api/rooms
GET  /api/rooms/:id
WS   /ws
```

`/api/config` 会返回完整图池、默认图池和支持模式。
