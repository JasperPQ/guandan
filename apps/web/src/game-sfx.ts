/**
 * 掼蛋的动作音效：对比前后两次对局视图（MatchView）推断刚发生了什么，放对应的声音。
 * 引擎不下发事件，所以看这些变化：打出去的牌（hand.played）、「不出」的次数（hand.passes）和轮到谁（hand.turn）、
 * 走完的顺序（finishOrder）、进贡 / 还贡（tribute）、阶段（phase）和局数（hand.number）。
 * 声音都来自全站共用的 gm-sound.tsx（sfx.* 和 synth），这里只决定「什么动作配什么声音、什么时候响」。
 *
 * - 自己的动作 mine=true 响亮，别人的减半；观战时都算别人的。
 * - 第一次拿到对局（进房间、重连、观战刚进来、教程换一局）不出声；一下跳了好几步（断线重连、教程快进）只放最后一手。
 * - 同一步里的几个声音按顺序错开几十到几百毫秒，听起来像一个动作的结果。
 */
import { useEffect, useRef } from "react";
import type { MatchView, Seat } from "@guandan/game";
import { sfx, synth, type SfxName } from "./gm-sound.js";

/** 开发时把放过的声音名字记进 window.__sfxLog（自测脚本靠它确认响的是哪个）。 */
function log(name: string) {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as { __sfxLog?: string[] };
  (w.__sfxLog ??= []).push(name);
}

type SfxArgs<N extends SfxName> = Parameters<(typeof sfx)[N]>;

/** delay 毫秒后放一个 sfx.* 声音。 */
function play<N extends SfxName>(delay: number, name: N, ...args: SfxArgs<N>) {
  const run = () => {
    log(name);
    (sfx[name] as (...a: SfxArgs<N>) => void)(...args);
  };
  if (delay <= 0) run();
  else window.setTimeout(run, delay);
}

/** delay 毫秒后放一个这款游戏自己的声音。 */
function cue(delay: number, name: string, run: () => void) {
  const go = () => {
    log(name);
    run();
  };
  if (delay <= 0) go();
  else window.setTimeout(go, delay);
}

const { tone, noise, level } = synth;

/** 同花顺：一串往上的亮音接一声闷响（比普通炸弹多一层「漂亮」）。 */
function straightFlush(mine: boolean) {
  const v = level(mine);
  [523, 659, 784, 988, 1319].forEach((f, i) => tone(f, { at: i * 0.05, duration: 0.22, volume: 0.1 * v, type: "triangle" }));
  window.setTimeout(() => sfx.boom(mine), 260);
}

/** 天王炸（四个王）：往上蹿的呼啸，炸开，再撒一把亮晶晶。 */
function jokerBomb(mine: boolean) {
  const v = level(mine);
  noise({ duration: 0.4, volume: 0.25 * v, freq: 500, freqTo: 5000, q: 1.2 });
  tone(260, { duration: 0.38, volume: 0.12 * v, type: "sawtooth", glideTo: 1500 });
  window.setTimeout(() => sfx.boom(mine), 380);
  [1568, 2093, 2637, 3136].forEach((f, i) => tone(f, { at: 0.55 + i * 0.06, duration: 0.22, volume: 0.06 * v, type: "triangle" }));
}

/** 剩 1–2 张时提醒一下（两声短促的嘀）。 */
function alarm(mine: boolean, left: number) {
  const v = level(mine);
  const f = left === 1 ? 1320 : 1100;
  tone(f, { duration: 0.07, volume: 0.11 * v, type: "square" });
  tone(f, { at: 0.12, duration: 0.07, volume: 0.11 * v, type: "square" });
}

/** 别人点了「准备下一局」：一声很轻的嗒。 */
function tick() {
  tone(1400, { duration: 0.04, volume: 0.05, type: "triangle" });
}

/** 自己最近一次点击 / 按键的时间：自己的动作来了但很久没点过、而且倒计时快到了，就是超时被系统代出。 */
let lastGesture = 0;
for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, () => { lastGesture = Date.now(); }, { capture: true, passive: true });

/**
 * 牌桌上调用：对比前后两次对局，放刚发生的动作的声音；轮到自己时响一声。
 * mySeat：自己的座位（观战传 null）；myTurn：现在要自己做决定（出牌、进贡、还贡）；secondsLeft：自己这一步的倒计时。
 */
export function useGameSfx(match: MatchView, mySeat: Seat | null, myTurn: boolean, secondsLeft: number | null) {
  const prev = useRef<{ match: MatchView; myTurn: boolean } | null>(null);
  // 轮到自己时倒计时最后看到的秒数（判断超时用）
  const lastSeconds = useRef<number | null>(null);
  if (myTurn) lastSeconds.current = secondsLeft;

  useEffect(() => {
    const before = prev.current;
    prev.current = { match, myTurn };
    if (!before || before.match === match) return;
    const last = before.match;
    // 换了一场（教程「再练一局」、再来一场）：当成重新进来，不出声
    if (match.players.some((player, seat) => player.id !== last.players[seat]?.id)) return;
    const mine = (seat: number) => seat === mySeat;
    const hand = match.hand;
    const old = last.hand;
    let t = 0;
    let mineActed = false;

    if (hand.number !== old.number) {
      // 新的一局：洗牌、发牌；抗贡时亮一下
      if (hand.number < old.number) return;
      play(0, "shuffle");
      play(380, "deal", 12);
      t = 900;
      if (hand.tribute?.resisted) {
        play(t, "sparkle", false);
        t += 400;
      }
    } else {
      // 出牌：打出去的牌变多了，就是 lastPlay 那一手（跳了好几手也只放最后一手）
      if (hand.played.length > old.played.length && hand.lastPlay) {
        const { seat, cards, combo } = hand.lastPlay;
        const m = mine(seat);
        if (m) mineActed = true;
        if (combo.type === "jokerBomb") {
          play(t, "card", m, 4);
          cue(t + 90, "jokerBomb", () => jokerBomb(m));
          t += 900;
        } else if (combo.type === "straightFlush") {
          play(t, "card", m, 5);
          cue(t + 150, "straightFlush", () => straightFlush(m));
          t += 800;
        } else if (combo.type === "bomb") {
          play(t, "card", m, cards.length);
          play(t + 160, "boom", m);
          t += 600;
        } else {
          play(t, "card", m, cards.length);
          t += 150 + Math.min(cards.length, 6) * 45;
        }
        const left = hand.cardCounts[seat] ?? 0;
        if ((left === 1 || left === 2) && (old.cardCounts[seat] ?? 0) > left) {
          cue(t + 100, "alarm", () => alarm(m, left));
          t += 300;
        }
      }
      // 不出：轮到的人没出牌就换人了（不出的次数多了；或者最后一个不出、这一轮结束）。
      // 不能只看 actions[seat] 变成「不出」：同一轮里转回来再不出一次，那一格本来就是「不出」。
      const passed = old.lastPlay !== null && match.phase === "playing" && last.phase === "playing" && hand.played.length === old.played.length
        && (hand.passes > old.passes || (hand.lastPlay === null && hand.turn !== old.turn));
      const passSeat = passed ? old.turn : -1;
      if (passSeat >= 0) {
        if (mine(passSeat)) mineActed = true;
        play(t, "pass", mine(passSeat));
        t += 200;
      }
      // 走完了：头游亮晶晶，其余一声得分
      // （一局结束时引擎会把没走完的人补在后面，他们手里还有牌，不算）
      for (const seat of hand.finishOrder.slice(old.finishOrder.length).filter((candidate) => hand.cardCounts[candidate] === 0)) {
        if (old.finishOrder.length === 0 && seat === hand.finishOrder[0]) play(t + 150, "sparkle", mine(seat));
        else play(t + 150, "score", mine(seat));
        t += 500;
      }
      // 进贡：交出贡牌的人（贡牌面朝下，只响一声出牌）；最后一个交完时贡牌分到对方手里
      const tribute = hand.tribute;
      const oldTribute = old.tribute;
      if (tribute && oldTribute) {
        const doneBefore = new Set([...oldTribute.givenSeats, ...oldTribute.transfers.map((transfer) => transfer.from)]);
        const givers = [...tribute.givenSeats, ...tribute.transfers.map((transfer) => transfer.from)].filter((seat) => !doneBefore.has(seat));
        for (const seat of new Set(givers)) {
          if (mine(seat)) mineActed = true;
          play(t, "card", mine(seat), 1);
          t += 220;
        }
        if (tribute.transfers.length > oldTribute.transfers.length) {
          for (const transfer of tribute.transfers.slice(oldTribute.transfers.length)) {
            play(t + 150, "draw", mine(transfer.to));
            t += 200;
          }
        }
        // 还贡：只有相关的两个人看得到是哪张；其他人在还贡阶段结束时听到一声
        for (const transfer of tribute.returns.slice(oldTribute.returns.length)) {
          if (mine(transfer.from)) mineActed = true;
          play(t, "card", mine(transfer.from), 1);
          play(t + 200, "draw", mine(transfer.to));
          t += 400;
        }
        if (last.phase === "return" && match.phase === "playing" && tribute.returns.length === oldTribute.returns.length) {
          play(t, "draw", false);
          t += 250;
        }
      }
      // 别人准备好下一局
      if (match.phase === "handOver" && last.phase === "handOver" && match.ready.some((ready, seat) => ready && !last.ready[seat] && !mine(seat))) {
        cue(t, "tick", tick);
      }
    }

    // 一局结束：本方升级就响得分，对方升级就往下滑；整场结束放赢 / 输
    if (match.phase !== last.phase && (match.phase === "handOver" || match.phase === "finished")) {
      t += 400;
      const winnerTeam = match.phase === "finished" ? match.winnerTeam : match.lastResult?.winnerTeam;
      if (match.phase === "finished") {
        play(t + 300, "gameOver", mySeat !== null && winnerTeam === mySeat % 2);
        t += 1000;
      } else if (mySeat === null) {
        play(t, "score", false);
        t += 400;
      } else if (winnerTeam === mySeat % 2) {
        play(t, "score", true, (match.lastResult?.upgrade ?? 0) >= 2);
        t += 500;
      } else {
        play(t, "bust", true);
        t += 500;
      }
    }

    // 超时：自己的动作来了，可上一次看到的倒计时已经到 1 秒、而且好几秒没点过东西（托管时没有倒计时，不算）
    if (mineActed && lastSeconds.current !== null && lastSeconds.current <= 1 && Date.now() - lastGesture > 2500) {
      play(0, "timeout");
      t += 350;
    }
    if (!myTurn) lastSeconds.current = null;

    if (myTurn && !before.myTurn) play(t + 250, "yourTurn");
  }, [match, myTurn]);
}

/** 点选手牌：选上往上一声，放下往下一声。 */
export function selectSound(on: boolean) {
  play(0, "select", on);
}

/** 不能点的地方（不是能选的牌、观战点手牌）。 */
export function denySound() {
  play(0, "deny");
}

/** 服务器拒绝了操作、房间出错。 */
export function errorSound() {
  play(0, "error");
}
