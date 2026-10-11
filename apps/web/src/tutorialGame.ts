/**
 * 掼蛋和教程有关的部分（共用的 tutorial/ 文件夹之外，每款游戏自己写的）：
 * 游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 */
import { botAdvice, describeCombo, isWild, type MatchView, type Seat } from "@guandan/game";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "guandan";

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 高亮哪个元素（data-tutorial）；null 不指。 */
  readonly anchor: string | null;
  /** 建议出的牌 / 进贡还贡的那张（牌桌替你选好）。 */
  readonly cardIds: readonly string[];
}

/** 「提示」：让人机从你的位置算一步（界面拿到的本来就是你能看到的那份），配一句原因。 */
export function hintFor(match: MatchView, playerId: string): Hint {
  const advice = botAdvice(match, playerId);
  if (!advice) return { say: "现在不用你做决定，等一下。", anchor: null, cardIds: [] };
  const { action, reason } = advice;
  switch (action.type) {
    case "play": {
      const combo = action.combo ? describeCombo(action.combo, match.hand.level) : "";
      return { say: `我会出${combo}。`, note: reason, anchor: "btn-play", cardIds: action.cardIds };
    }
    case "pass":
      return { say: "我会不出。", note: reason, anchor: "btn-pass", cardIds: [] };
    case "tribute":
      return { say: "我会贡这一张。", note: reason, anchor: "btn-tribute", cardIds: [action.cardId] };
    case "returnTribute":
      return { say: "我会还这一张。", note: reason, anchor: "btn-return", cardIds: [action.cardId] };
    default:
      return { say: "准备下一局。", anchor: "btn-ready", cardIds: [] };
  }
}

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  wild: { title: "逢人配", text: "红桃级牌是逢人配：可以当成除大小王以外的任何一张牌，凑顺子、对子、炸弹都行；单独出就是一张级牌。" },
  tribute: { title: "进贡", text: "上一局你们队输了：开打前要交出手里最大的一张单牌（逢人配不算）。两个人都输时，大的那张给头游。" },
  returnTribute: { title: "还贡", text: "你收到了贡牌，要还给进贡的人一张 10 以下的牌，挑一张用不上的小牌。" },
  resist: { title: "抗贡", text: "要进贡的一方手里一共有两张大王：这局不用进贡，由头游先出。" },
  partner: { title: "队友的牌", text: "坐你对面的是队友：他出的牌一般不用压，让他接着出。" },
  jiefeng: { title: "接风", text: "队友出完了最后一手，大家都不要：轮到你接着领出。" },
  alert: { title: "对手快出完了", text: "对手只剩几张：别让他轻松接走，必要时用炸弹抢回牌权。" },
  bomb: { title: "炸弹", text: "四张以上同点数是炸弹，同花顺、天王炸也是：能压任何普通牌型。炸弹之间比张数，同花顺排在 5 张和 6 张炸弹之间。" },
  upgrade: { title: "升级", text: "头游所在的队升级：双上升 3 级，头游 + 三游升 2 级，头游 + 末游升 1 级。打 A 时拿到头游、队友不是末游就赢下整场。" },
  auto: { title: "托管中", text: "托管就是人机替你打。点「取消托管」就能自己接着打。" },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。auto 是自己现在是不是托管中。 */
export function detectTips(match: MatchView, auto: boolean): string[] {
  const ids: string[] = [];
  const seat = match.mySeat;
  if (seat === null) return ids;
  const hand = match.hand;
  if (auto) ids.push("auto");
  const tribute = hand.tribute;
  if (match.phase === "tribute" && tribute?.givers.includes(seat) && !tribute.givenSeats.includes(seat)) ids.push("tribute");
  if (match.phase === "return" && tribute?.transfers.some((transfer) => transfer.to === seat)) ids.push("returnTribute");
  if (tribute?.resisted && !hand.actions.some(Boolean)) ids.push("resist");
  if (match.phase === "handOver") ids.push("upgrade");
  if (match.phase === "playing") {
    const partner = ((seat + 2) % 4) as Seat;
    const last = hand.lastPlay;
    if (hand.turn === seat && !last && hand.finishOrder.includes(partner) && hand.actions[partner]?.kind === "play") ids.push("jiefeng");
    if (hand.turn === seat && last?.seat === partner && (hand.cardCounts[partner] ?? 0) > 0) ids.push("partner");
    if (last && ["bomb", "straightFlush", "jokerBomb"].includes(last.combo.type) && last.seat !== seat) ids.push("bomb");
    const opponents = ([0, 1, 2, 3] as Seat[]).filter((other) => other % 2 !== seat % 2);
    if (opponents.some((other) => (hand.cardCounts[other] ?? 0) > 0 && (hand.cardCounts[other] ?? 0) <= 3)) ids.push("alert");
    if (hand.myCards.some((card) => isWild(card, hand.level))) ids.push("wild");
  }
  return ids;
}

/** 局面的「步数」标识：每走一步都会变（掼蛋的状态里没有版本号）。 */
export function matchStepKey(match: MatchView): string {
  const hand = match.hand;
  return [hand.number, match.phase, hand.played.length, hand.passes, hand.turn, match.ready.join(""), hand.tribute?.givenSeats.length ?? 0, hand.tribute?.returns.length ?? 0].join(":");
}

