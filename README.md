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

## 画面风格：像素版（默认）和原始版本

首页、等待大厅、牌桌默认是像素风，顶栏「切换原版 / 切换像素版」随时切换，只影响自己看到的画面，记在浏览器的 `gm-board-style` 里（和宝石商人、德州扑克、游戏中心共用同一个选择）。

- 原始样式 `styles.css` 一字未改；像素皮肤 `guandan-pixel.css` 用 `?inline` 导入，只在像素版时放进页面。
- 牌在两种画面下标记不同（`pixel.ts` 的 `PixelContext`）：原版是 `public/cards/` 的 SVG 加放大角标；像素版是 `public/cards-pixel/` 的 PNG，角标已经画在图里。

## 像素牌面（`art/`）

掼蛋和德州扑克共用一副像素牌，`art/cards.py` 生成后同时导出到两个仓库：

- 41×57 像素：点阵角标（2 像素粗的笔画）、按真牌位置摆的花色点、A 中间一个大花色，代码逐像素画；
- J/Q/K（每种花色一套）和大小王的人像由 PixelLab 生成（`art/faces.py`，选择记在 `art/selection.json`），小王是大王去色；
- 还有红、蓝两种牌背，以及德州扑克的像素牌桌、筹码、庄家按钮（导出到 texas-holdem 的 `src/assets/pixel/`）。

PixelLab 密钥只在 `~/.config/pixellab/api_key`，不进仓库；花费记在 `art/ledger.jsonl`。人像选图画廊：`python art/gallery.py`，再 `python -m http.server 8768 --directory art/out`。
