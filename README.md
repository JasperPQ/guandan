# 掼蛋

和朋友在线打掼蛋：4 人两队、两副牌、逢人配、进贡还贡、从 2 打到 A。规则见 [RULES.md](RULES.md)。

## 本地运行

```bash
npm install
npm run dev
```

浏览器打开 http://localhost:5174 。游戏服务在 3002 端口，开发时由 Vite 转发，和宝石商人（5173 / 3001）可以同时运行。
自己测试需要 4 位玩家：开 4 个标签页，分别用不同昵称加入同一个房间。

## 结构

- `packages/game`：纯规则引擎（牌型识别、比大小、出牌流程、升级、进贡），以及前后端共用的协议类型。
- `apps/server`：Socket.IO 服务，负责房间、选座、对局、聊天、断线重连；每位玩家只收到自己的手牌。
- `apps/web`：React 前端。

## 测试

```bash
npm test        # 规则引擎与服务端集成测试
npm run typecheck
```
