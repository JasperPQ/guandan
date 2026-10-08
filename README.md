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

## 画面：白天版和夜间版

只有像素风一种画面（原始版本已删掉），配色分夜间（深色，默认）和白天（白底）两种。顶栏「切换白天版 / 切换夜间版」随时切换，只影响自己看到的画面，记在浏览器的 `gm-pixel-theme` 里；gulugagame.com 上的大厅和各个游戏同源，共用这一个选择。

- 夜间配色就是 `guandan-pixel.css`（叠在改版前的 `styles.css` 上，`styles.css` 只当底子用）本身。白天版不单独写：`apps/web/day-theme.ts`（Vite 插件）在构建时把这些样式里和颜色有关的声明照抄一份，选择器前加 `:root[data-theme="day"]`，按 `apps/web/day-palette.ts` 的调色表换成白天的颜色。改夜间样式时白天版自动跟着变，只有新出现的深色需要在调色表里补一行。
- 机械换色不合适的地方在 `apps/web/src/theme-day.css` 里手写。
- `index.html` 里一小段脚本在样式生效前就给 `<html>` 加上 `data-theme="day"`，打开页面不会先闪一下深色；切换逻辑和按钮在 `src/theme.tsx`。
- 牌面是 `public/cards-pixel/` 的像素 PNG，角标已经画在图里。

## 像素牌面（`art/`）

掼蛋和德州扑克共用一副像素牌，`art/cards.py` 生成后同时导出到两个仓库：

- 41×57 像素：点阵角标（2 像素粗的笔画）、按真牌位置摆的花色点、A 中间一个大花色，代码逐像素画；
- J/Q/K（每种花色一套）和大小王的人像由 PixelLab 生成（`art/faces.py`，选择记在 `art/selection.json`），小王是大王去色；
- 还有红、蓝两种牌背，以及德州扑克的像素牌桌、筹码、庄家按钮（导出到 texas-holdem 的 `src/assets/pixel/`）。

PixelLab 密钥只在 `~/.config/pixellab/api_key`，不进仓库；花费记在 `art/ledger.jsonl`。人像选图画廊：`python art/gallery.py`，再 `python -m http.server 8768 --directory art/out`。

## 服务器上的启动方式

pm2 按仓库根目录的 `ecosystem.config.cjs` 直接启动一个 `node --import tsx` 进程跑服务端（不经过 `npm start`），每个游戏省下约 50 MB 内存（实测，原来被几层包装进程占掉的部分）。端口和密钥存在 pm2 里，不进仓库；`deploy.sh` 照旧 `pm2 restart`。改了 `ecosystem.config.cjs` 之后，要在服务器上带着原来的环境变量 `pm2 delete` 再 `pm2 start ecosystem.config.cjs` 一次。
