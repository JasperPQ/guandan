# 掼蛋

和朋友在线打掼蛋：4 人两队、两副牌、逢人配、进贡还贡、从 2 打到 A。规则见 [RULES.md](RULES.md)。

## 本地运行

```bash
npm install
npm run dev
```

浏览器打开 http://localhost:5174 。游戏服务在 3002 端口，开发时由 Vite 转发，和宝石商人（5173 / 3001）可以同时运行。
一个人就能测：建房后在三个空座位上点「加人机」再开始。想测得快：`TURN_MS=1500 BOT_DELAY_SCALE=0.3 npm run dev`。

## 人机和托管（全站统一做法）

- **加人机**：房主在等待大厅的空座位上点「加人机」（座位决定队伍，所以加在哪个座位就是哪队），依次叫咕噜一号 / 二号 / 三号，带「人机」标签，房主可以「移出」。一个真人加满三个人机就能开局；人机自动同意「再来一场」，房间里只剩人机时关闭。
- **每一步限时**（原来没有倒计时，这次补上）：出牌、进贡、还贡各 30 秒，一局结束后的「准备」60 秒。到点没动：跟牌时算「不出」，领出 / 进贡 / 还贡由人机替他挑一手，准备阶段直接准备。
- **托管 = 人机代打**：出牌、进贡、还贡连续超时 2 次转托管，由人机替他打，直到他自己动一下或点「取消托管」。准备阶段的超时不算。
- **离线**：轮到离线的人时先等 3 秒（刷新页面来得及回来，不算超时），然后由人机代打；用原昵称和房间码回来，座位交还给他。
- **人机策略**（`packages/game/src/bot.ts`，只有「普通」一档）：只看 `viewForPlayer` 之后的状态（自己的手牌、各家张数、本局已打出的牌、公开的进贡还贡）。把手牌拆成若干手（逢人配可以补顺子、对子、炸弹，同花顺单独找），每手按「打出去能不能收回牌权」估分；领出先走小牌、只剩一手小牌时先打大牌；对家的牌不压（对家走完时等着接风），对手快走完放宽跟牌、必要时上炸弹；进贡挑同花顺用不上的那张，还贡挑拆了最不心疼的小牌。`botAdvice` 每一步附一句理由。
- **强度**（`~/projects/qa-reports/tools/bots/sim-guandan.ts`，300 场从 2 打到过 A）：对随机 100%；对「出最小牌、不压对家、对手剩 5 张才炸」的基线整场 100%、单局头游所在队 91%；每步平均约 0.1 ms，最慢约 7 ms。参数在 `botTuning`。

## 新手教程（全站统一做法：剧本局 + 练习提示 + 小贴士，咕噜嘎向导）

- 首页和等待大厅有「新手教程」入口（地址带 `?tutorial` 直接打开）；在等待大厅看教程不离开房间，房主一开局就自动回到牌桌。
- 教程不连服务器：浏览器里直接跑规则引擎。剧本在 `packages/game/src/tutorial.ts`（34 步 11 课，三段摆好的局面：打 5 时逢人配凑顺子、炸弹和同花顺、不压队友、接风、双上升 3 级；下一局双下进贡还贡；快进到打 A、过 A 赢下整场），剧本单测在 `packages/game/test/tutorial.test.ts`。
- 网页：共用教练层 `apps/web/src/tutorial/`（从欲罢不能复制，不改逻辑），本游戏的部分是 `TutorialMode.tsx`、`tutorialGame.ts`（「提示」的说法、小贴士）。牌桌 `Table.tsx` 上要高亮的东西带 `data-tutorial`。
- 学完开一局人机练习（打完一局可以结束或再练一局），随时能点「提示」（键盘 H）：就是人机从你的位置算一步再配一句理由，牌桌替你选好牌。一个人加人机开的房间里也有「提示」，有别的真人时没有。
- 真实对局里「第一次遇到」逢人配、进贡、还贡、接风、炸弹、升级、托管时出一条小贴士，每条只出一次。
- 走查脚本：`node ~/projects/qa-reports/tools/tut-guandan.mjs <输出目录> flow|skip|waiting|room [1440|1920|1024|390] [night|day]`。

## 结构

- `packages/game`：纯规则引擎（牌型识别、比大小、出牌流程、升级、进贡），以及前后端共用的协议类型。
- `apps/server`：Socket.IO 服务，负责房间、选座、对局、聊天、断线重连；每位玩家只收到自己的手牌。
- `apps/web`：React 前端。

## 测试

```bash
npm test        # 规则引擎、人机、服务端集成测试（含 bots.test.ts）
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

## 背景音乐

进了房间（等候房间、对局、观战）和新手教程里循环放 `apps/web/public/bgm/guandan.mp3`，首页和房间列表不放。曲子是他用 Suno 做的，原文件在桌面 `bgm v1/掼蛋.mp3`（2026-10-11 接入）。播放器是 `apps/web/src/bgm.tsx`（大厅和各游戏是同一份文件，改了要同步到所有仓库）：一个页面只有一个播放器，从等候房间进牌桌不会从头放；循环处交叉淡化；切到别的标签页时暂停。顶栏的 ♪ 按钮能开关、调音量，设置全站共用（localStorage `gm-music`、`gm-music-volume`，默认开、音量 60）。浏览器要求先点过页面才能出声，从首页点进房间正好满足。

换曲子：把新文件放进 `apps/web/public/bgm/`，用 `~/miniconda3/envs/quant/bin/python -I ~/projects/qa-reports/tools/bgm-analyze.py <文件>` 量出 gain / start / end，改 `App.tsx` 里的 `BGM`。本地检查：`URL=http://localhost:<网页端口>/ node ~/projects/qa-reports/tools/bgm-check.mjs`（进房间、开局、离开、开关、顶栏是否被挤成两行）。
