/**
 * 新手教程的剧本（站内统一做法，见 ~/projects/pipeline/handbook/tutorial-notes.md）。
 *
 * 你坐座位 0（下方），右边咕噜一号（座位 1，对手）、对面咕噜二号（座位 2，队友）、左边咕噜三号（座位 3，对手）。
 * 出牌顺序 你 → 咕噜一号 → 咕噜二号 → 咕噜三号。三段局面都直接摆好（不洗牌、不用随机数）：
 *
 * 第一段（第 3 局，你们坐庄打 5，红桃 5 是逢人配）：
 *   你用逢人配凑顺子 8–Q → 咕噜一号顺子 10–A 压 → 你四张 7 炸 → 咕噜一号同花顺压回 → 你不出 →
 *   咕噜一号出对 4、队友对 K 压 → 你有对 A 也不压 → 队友出完最后一对 6（头游）→ 大家都不要、你接风 →
 *   你出对 3、对 A 出完（二游）→ 双上，升 3 级：5 → 8。
 * 第二段（第 4 局，打 8）：双下进贡：咕噜一号贡大王给头游（队友），咕噜三号贡级牌 8 给你；队友还 5，你还 3。
 * 第三段（快进到第 9 局，你们打 A）：你出完最后一对 K（头游），队友接风出完（二游）→ 过 A，赢下整场。
 *
 * 练习局：普通的一局（从 2 打起），你和三个人机；打完一局就可以结束或者再练一局。
 */
import { sortCards, type Card, type Suit } from "./cards.js";
import type { Combo } from "./combos.js";
import { botCommand } from "./bot.js";
import { applyAction, createMatch, legalCombos, type HandState, type MatchAction, type MatchState, type Seat } from "./match.js";
import { viewForPlayer } from "./view.js";

export type TutorialFace = "base" | "happy" | "surprised" | "think";
/** 剧本专用的「快进」：换成摆好的下一段局面。 */
export type TutorialCommand = MatchAction | { type: "fastForward" };

interface StepBase {
	readonly id: string;
	/** 侧栏进度里的课名（只有几步带）。 */
	readonly lesson?: string;
	/** 主句（24px），一句话。 */
	readonly say: string;
	/** 补充（12px），最多两句。 */
	readonly note?: string;
	/** 触屏上换的说法。 */
	readonly noteTouch?: string;
	/** 高亮哪个元素（data-tutorial）。 */
	readonly anchor?: string;
	readonly face?: TutorialFace;
}

export type TutorialStep =
	| (StepBase & { readonly kind: "info"; readonly finale?: boolean })
	| (StepBase & {
			readonly kind: "do";
			readonly expect: TutorialCommand;
			/** 选牌以后高亮挪到哪：当前选中的牌（按牌写，比如 "S3 D3"）和它一样时用这个锚点。 */
			readonly then?: readonly { readonly cards: string; readonly anchor: string }[];
	  })
	| (StepBase & { readonly kind: "watch"; readonly moves: readonly TutorialCommand[] });

/** 自己的玩家 id（剧本和练习局一样）。 */
export const TUTORIAL_SELF = "me";
const BOT_NAMES = ["咕噜一号", "咕噜二号", "咕噜三号"];
/** 剧本里人机的 id 用 s 开头，练习局用 b 开头：教程里的「准备」「快进」只在剧本局面里换局面。 */
const SCRIPT_BOTS = ["s1", "s2", "s3"];
const PRACTICE_BOTS = ["b1", "b2", "b3"];

// ---------------------------------------------------------------------------
// 摆牌
// ---------------------------------------------------------------------------

const RANKS: Record<string, number> = { J: 11, Q: 12, K: 13, A: 14 };

/** "S9" → 黑桃 9，"SJ" 是黑桃 J；"小王" "大王"。 */
function parseCard(spec: string, prefix: string): Card {
	if (spec === "小王" || spec === "大王") return { id: `${prefix}-${spec}`, suit: "J", rank: spec === "小王" ? 16 : 17 };
	const suit = spec[0] as Suit;
	const text = spec.slice(1);
	return { id: `${prefix}-${spec}`, suit, rank: RANKS[text] ?? Number(text) };
}

function hand(prefix: string, text: string, level: number): Card[] {
	return sortCards(text.split(/\s+/).filter(Boolean).map((spec) => parseCard(spec, prefix)), level);
}

function players(selfName: string, bots: readonly string[]) {
	return [{ id: TUTORIAL_SELF, name: selfName }, ...bots.map((id, index) => ({ id, name: BOT_NAMES[index]! }))];
}

function baseHand(number: number, level: number, dealerTeam: 0 | 1, hands: Card[][], turn: Seat): HandState {
	return {
		number,
		level,
		dealerTeam,
		hands,
		turn,
		lastPlay: null,
		passes: 0,
		actions: [null, null, null, null],
		finishOrder: [],
		tribute: null,
		played: [],
	};
}

/** 第一段：第 3 局，你们坐庄打 5，你先出。 */
const HAND_ONE = {
	level: 5,
	hands: [
		"C8 S9 HJ DQ H5 S7 C7 D7 H7 S3 D3 SA DA",
		"D10 CJ HQ DK CA S9 S10 SJ SQ SK S4 D4 C2 D2 C9 H9",
		"CK HK C6 D6",
		"S2 H3 C4 H4 D8 H8 D9 CQ HJ S6",
	],
};

/** 第二段：第 4 局，你们打 8；对手双下，要向你们进贡。 */
const HAND_TWO = {
	level: 8,
	hands: [
		"S3 C4 D6 HQ SK CA H8 D9",
		"大王 C3 D5 C6 H9 DJ SQ",
		"SA DA C5 C7 D10 HJ",
		"S8 D3 H4 S5 D7 C10",
	],
};

/** 第三段：第 9 局，你们坐庄打 A，你只剩一对 K、队友只剩一张 9。 */
const HAND_A = {
	level: 14,
	hands: ["SK DK", "C3 D4 C6 H7 S10", "S9", "D5 C8 HJ"],
};

/** 剧本开局：第一段局面。 */
export function createTutorialGame(selfName = "你"): MatchState {
	const match = createMatch(players(selfName, SCRIPT_BOTS), () => 0);
	match.teamLevels = [5, 3];
	match.phase = "playing";
	match.hand = baseHand(3, HAND_ONE.level, 0, HAND_ONE.hands.map((text, seat) => hand(`a${seat}`, text, HAND_ONE.level)), 0);
	return match;
}

/** 第一段双上结束后，下一局摆成第二段：对手双下，两人进贡。 */
function scriptedHandTwo(state: MatchState): MatchState {
	const next = structuredClone(state);
	next.phase = "tribute";
	next.ready = [false, false, false, false];
	next.hand = baseHand(4, HAND_TWO.level, 0, HAND_TWO.hands.map((text, seat) => hand(`b${seat}`, text, HAND_TWO.level)), 2);
	next.hand.tribute = { givers: [1, 3], receivers: [2, 0], resisted: false, given: {}, transfers: [], returns: [], leadSeat: null };
	return next;
}

/** 快进：第 9 局，你们坐庄打 A。 */
function scriptedHandA(state: MatchState): MatchState {
	const next = structuredClone(state);
	next.phase = "playing";
	next.teamLevels = [14, 10];
	next.aFailures = [0, 0];
	next.ready = [false, false, false, false];
	next.lastResult = null;
	next.hand = baseHand(9, HAND_A.level, 0, HAND_A.hands.map((text, seat) => hand(`c${seat}`, text, HAND_A.level)), 0);
	return next;
}

/** 练习局：普通的一局，你和三个人机。 */
export function createPracticeGame(selfName = "你", seed = 1): MatchState {
	let value = seed >>> 0 || 1;
	const random = () => {
		value = (value * 1103515245 + 12345) % 2147483648;
		return value / 2147483648;
	};
	return createMatch(players(selfName, PRACTICE_BOTS), random);
}

const isScript = (state: MatchState) => state.players[1]?.id === SCRIPT_BOTS[0];

/**
 * 教程里走一步：就是规则引擎，外加
 * - 你点「准备下一局」时，人机一起准备（剧本里接着换成摆好的第二段局面）；
 * - 剧本的「快进」换成第三段局面。
 */
export function tutorialApply(state: MatchState, playerId: string, command: TutorialCommand, random: () => number = Math.random): MatchState {
	if (command.type === "fastForward") {
		if (!isScript(state)) throw new Error("练习局不能快进。");
		return scriptedHandA(state);
	}
	if (command.type === "ready" && playerId === TUTORIAL_SELF) {
		let next = applyAction(state, playerId, command, random);
		for (const player of next.players) {
			if (next.phase !== "handOver") break;
			const seat = next.players.indexOf(player);
			if (!next.ready[seat]) next = applyAction(next, player.id, { type: "ready" }, random);
		}
		return isScript(state) && next.phase !== "handOver" ? scriptedHandTwo(state) : next;
	}
	return applyAction(state, playerId, command, random);
}

// ---------------------------------------------------------------------------
// 剧本
// ---------------------------------------------------------------------------

/** 剧本按牌写（"S3 D3"），从那个座位那一段的手牌里挑具体的牌。 */
function cardsOf(prefix: string, text: string): string[] {
	return text.split(/\s+/).filter(Boolean).map((spec) => `${prefix}-${spec}`);
}
const play = (prefix: string, text: string, combo?: Combo): TutorialCommand => ({ type: "play", cardIds: cardsOf(prefix, text), ...(combo ? { combo } : {}) });
const PASS: TutorialCommand = { type: "pass" };

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
	{
		id: "team",
		kind: "info",
		lesson: "组队",
		say: "掼蛋四个人分两队：坐你对面的咕噜二号是你的队友。",
		note: "左右两边的咕噜一号、咕噜三号是对手。出牌顺序：你 → 右边 → 对面 → 左边。",
		anchor: "plate-top",
		face: "happy",
	},
	{
		id: "goal",
		kind: "info",
		say: "谁先出完手牌谁是「头游」，头游所在的队升级；先打过 A 的队赢下整场。",
		note: "这里显示两队各自打到几了：你们打 5，对手打 3。",
		anchor: "team-levels",
	},
	{
		id: "level",
		kind: "info",
		lesson: "级牌",
		say: "这局打 5，5 就是「级牌」：它比 A 还大，只比大小王小。",
		note: "每局打的是坐庄那队的级数，所以每局的级牌不一样。",
		anchor: "level",
	},
	{
		id: "hand",
		kind: "info",
		say: "你的手牌从小到大排好了：5 排在 A 的后面。",
		note: "单张从大到小：大王、小王、级牌、A、K、Q……2。花色不分大小。",
		anchor: "hand",
	},
	{
		id: "wild",
		kind: "info",
		lesson: "逢人配",
		say: "红桃 5 叫「逢人配」，可以当成除大小王以外的任何一张牌。",
		note: "两副牌里一共两张。单独出的时候，它就是一张级牌 5。",
		anchor: "card:a0-H5",
		face: "think",
	},
	{
		id: "lead",
		kind: "do",
		lesson: "出牌",
		say: "轮到你领出：选 8、9、J、Q 和红桃 5，凑成顺子。",
		note: "红桃 5 顶替缺的 10。顺子正好 5 张连着的牌，不分花色。",
		anchor: "hand",
		expect: play("a0", "C8 S9 H5 HJ DQ"),
		then: [{ cards: "C8 S9 H5 HJ DQ", anchor: "btn-play" }],
	},
	{
		id: "lead-watch",
		kind: "watch",
		say: "咕噜一号用更大的顺子 10–A 压你，另外两家都不要。",
		note: "普通牌型要用同一种、同样张数、更大的牌才压得住。",
		anchor: "play-right",
		moves: [play("a1", "D10 CJ HQ DK CA"), PASS, PASS],
	},
	{
		id: "bomb",
		kind: "do",
		lesson: "炸弹",
		say: "四张 7 是「炸弹」，什么普通牌型都能压：选四张 7，出炸弹！",
		note: "四张或更多同样点数的牌就是炸弹。",
		anchor: "hand",
		expect: play("a0", "S7 C7 D7 H7"),
		then: [{ cards: "S7 C7 D7 H7", anchor: "btn-play" }],
	},
	{
		id: "flush-watch",
		kind: "watch",
		say: "咕噜一号出了「同花顺」：同一种花色的顺子，也是炸弹。",
		anchor: "play-right",
		moves: [play("a1", "S9 S10 SJ SQ SK", { type: "straightFlush", size: 5, key: 13 }), PASS, PASS],
		face: "surprised",
	},
	{
		id: "bomb-order",
		kind: "info",
		say: "炸弹比大小：天王炸 > 6 张以上的炸弹 > 同花顺 > 5 张炸弹 > 4 张炸弹。",
		note: "张数一样比点数。天王炸是两张大王加两张小王，最大。",
		anchor: "play-right",
		face: "think",
	},
	{
		id: "bomb-pass",
		kind: "do",
		say: "你压不过同花顺了：点「不出」。",
		anchor: "btn-pass",
		expect: PASS,
	},
	{
		id: "combos",
		kind: "info",
		lesson: "牌型",
		say: "普通牌型有七种：单张、对子、三同张、三带二、顺子、三连对、钢板。",
		note: "三带二是三张带一对；三连对是三个连着的对子，比如 334455；钢板是两个连着的三张，比如 333444。",
	},
	{
		id: "pair-watch",
		kind: "watch",
		say: "咕噜一号出对 4，你的队友咕噜二号用对 K 压住了。",
		anchor: "play-top",
		moves: [play("a1", "S4 D4"), play("a2", "CK HK"), PASS],
	},
	{
		id: "partner",
		kind: "do",
		lesson: "配合队友",
		say: "队友的牌不用压：点「不出」，让他接着出。",
		note: "你虽然有一对 A，压自己队友只会浪费大牌。队友只剩 2 张了。",
		anchor: "btn-pass",
		expect: PASS,
	},
	{
		id: "out-watch",
		kind: "watch",
		say: "咕噜二号把最后一对 6 出完了，他是头游！",
		anchor: "plate-top",
		moves: [PASS, play("a2", "C6 D6"), PASS],
		face: "happy",
	},
	{
		id: "jiefeng",
		kind: "do",
		lesson: "接风",
		say: "队友已经出完，你也点「不出」。",
		note: "出完牌的人那一手要是没人压，就由他的对家接着领出，叫「接风」。",
		anchor: "btn-pass",
		expect: PASS,
	},
	{
		id: "jiefeng-watch",
		kind: "watch",
		say: "咕噜一号也不要：轮到你接风领出。",
		anchor: "hand",
		moves: [PASS],
	},
	{
		id: "pair",
		kind: "do",
		say: "先出对 3。",
		anchor: "hand",
		expect: play("a0", "S3 D3"),
		then: [{ cards: "S3 D3", anchor: "btn-play" }],
	},
	{
		id: "pair-pass-watch",
		kind: "watch",
		say: "两个对手都不要。",
		moves: [PASS, PASS],
	},
	{
		id: "last",
		kind: "do",
		say: "最后一对 A 出完，你就是二游！",
		anchor: "hand",
		expect: play("a0", "SA DA"),
		then: [{ cards: "SA DA", anchor: "btn-play" }],
	},
	{
		id: "result",
		kind: "info",
		lesson: "升级",
		say: "你们拿了头游和二游（双上），这局马上结束，你们升 3 级：5 → 8。",
		anchor: "result",
		face: "happy",
	},
	{
		id: "upgrade",
		kind: "info",
		say: "头游所在的队升级：双上升 3 级，头游 + 三游升 2 级，头游 + 末游升 1 级。",
		note: "下一局由头游所在的队坐庄，打这一队的级数。",
		anchor: "result-levels",
	},
	{
		id: "ready",
		kind: "do",
		say: "点「准备下一局」。",
		anchor: "btn-ready",
		expect: { type: "ready" },
	},
	{
		id: "tribute",
		kind: "info",
		lesson: "进贡还贡",
		say: "上一局对手是三游和末游（双下），这局开打前要向你们「进贡」。",
		note: "进贡要交出手里最大的一张单牌，逢人配不算。只有末游一个人输时，末游给头游贡一张。",
		anchor: "turn",
		face: "think",
	},
	{
		id: "tribute-watch",
		kind: "watch",
		say: "两人各贡一张：大的给头游，小的给二游。咕噜三号最大的是级牌 8，给了你。",
		anchor: "tribute-note",
		moves: [{ type: "tribute", cardId: "b1-大王" }, { type: "tribute", cardId: "b3-S8" }, { type: "returnTribute", cardId: "b2-C5" }],
	},
	{
		id: "return",
		kind: "do",
		say: "收了贡要还一张 10 以下的牌：选 3，点「还贡」。",
		note: "队友已经还了一张 5 给咕噜一号。",
		anchor: "hand",
		expect: { type: "returnTribute", cardId: "b0-S3" },
		then: [{ cards: "S3", anchor: "btn-return" }],
	},
	{
		id: "resist",
		kind: "info",
		say: "进贡完由进贡的人先出；双下时贡牌大的人先出。",
		note: "要进贡的一方手里一共有两张大王，就可以「抗贡」：不用进贡，由头游先出。第一局不进贡。",
		anchor: "turn",
	},
	{
		id: "skip",
		kind: "watch",
		lesson: "过 A",
		say: "快进到后面：你们已经打到 A 了。",
		anchor: "level",
		moves: [{ type: "fastForward" }],
	},
	{
		id: "a-last",
		kind: "do",
		say: "你们坐庄打 A，你只剩一对 K：出完它！",
		anchor: "hand",
		expect: play("c0", "SK DK"),
		then: [{ cards: "SK DK", anchor: "btn-play" }],
	},
	{
		id: "a-watch",
		kind: "watch",
		say: "没人要，队友接风，把最后一张 9 也出完了。",
		anchor: "result",
		moves: [PASS, PASS, PASS, play("c2", "S9")],
	},
	{
		id: "win",
		kind: "info",
		say: "打 A 的时候拿到头游、队友又不是末游，就是「过 A」：你们赢下整场！",
		anchor: "result",
		face: "happy",
	},
	{
		id: "a-fail",
		kind: "info",
		say: "没过 A 就下次接着打 A；打 A 累计失败 3 次，级数退回 2。",
		face: "think",
	},
	{
		id: "site",
		kind: "info",
		lesson: "本站设定",
		say: "出牌、进贡、还贡限时 30 秒；连续超时 2 次进入托管，就是人机替你打。",
		note: "空座位可以加人机；掉线 3 秒后人机接手，用原昵称和房间码回来就能接着打。",
	},
	{
		id: "finale",
		kind: "info",
		finale: true,
		say: "学会了！和三个人机打一局练练吧。",
		note: "拿不准就点「提示」，我告诉你我会怎么出、为什么。",
		face: "happy",
	},
];

export const TUTORIAL_FINAL_STEP = "finale";

/** 牌的写法（"S9"、"大王"）。 */
export function cardSpec(card: Card): string {
	if (card.suit === "J") return card.rank === 17 ? "大王" : "小王";
	const rank = ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[card.rank] ?? String(card.rank);
	return `${card.suit}${rank}`;
}

const specKey = (specs: readonly string[]) => [...specs].sort().join(",");

/** 选中的牌和剧本写法（"S3 D3"）是不是同一套。 */
export function selectionMatches(cards: readonly Card[], text: string): boolean {
	return cards.length > 0 && specKey(cards.map(cardSpec)) === specKey(text.split(/\s+/).filter(Boolean));
}

/** 牌 id 去掉段前缀后的写法（"a0-S9" → "S9"）。 */
const idSpec = (id: string) => id.replace(/^[a-z]\d-/, "");

/** 两条命令是不是同一步（出牌按牌比，不管认法）。 */
export function sameCommand(a: TutorialCommand, b: TutorialCommand): boolean {
	if (a.type !== b.type) return false;
	switch (a.type) {
		case "play":
			return b.type === "play" && specKey(a.cardIds.map(idSpec)) === specKey(b.cardIds.map(idSpec));
		case "tribute":
			return b.type === "tribute" && idSpec(a.cardId) === idSpec(b.cardId);
		case "returnTribute":
			return b.type === "returnTribute" && idSpec(a.cardId) === idSpec(b.cardId);
		default:
			return true;
	}
}

/** 这一步要等哪些座位。 */
export function tutorialPending(state: MatchState): Seat[] {
	const hand = state.hand;
	const tribute = hand.tribute;
	switch (state.phase) {
		case "playing":
			return [hand.turn];
		case "tribute":
			return tribute ? tribute.givers.filter((seat) => !tribute.given[seat]) : [];
		case "return":
			return tribute ? tribute.transfers.filter((transfer) => !tribute.returns.some((done) => done.from === transfer.to)).map((transfer) => transfer.to) : [];
		case "handOver":
			return ([0, 1, 2, 3] as Seat[]).filter((seat) => !state.ready[seat]);
		default:
			return [];
	}
}

/** 现在轮到谁：出牌时是轮到的人；进贡、还贡、准备这种几个人一起做的，先让人机，最后才是自己；整场结束返回 null。 */
export function tutorialActor(state: MatchState): string | null {
	if (state.phase === "finished") return null;
	const pending = tutorialPending(state);
	const bot = pending.find((seat) => state.players[seat]!.id !== TUTORIAL_SELF);
	const seat = bot ?? pending[0];
	return seat === undefined ? null : state.players[seat]!.id;
}

/** 练习局里自己现在能不能发命令（进贡、还贡、准备不用等人机先做）。 */
export function tutorialCanAct(state: MatchState, playerId: string): boolean {
	const seat = state.players.findIndex((player) => player.id === playerId);
	return seat >= 0 && tutorialPending(state).includes(seat as Seat);
}

/** 人机替 playerId 走一步（只给它看自己座位能看到的局面）。 */
export function tutorialBot(state: MatchState, playerId: string): TutorialCommand | null {
	return botCommand(viewForPlayer(state, playerId), playerId);
}

/**
 * 锚点在这个局面下应该看得见（剧本单测用；和网页上 data-tutorial 的出现条件一致）。viewer 是自己的座位。
 * 位置：下方 bottom = 自己，右 right = viewer+1，上 top = viewer+2，左 left = viewer+3。
 */
export function anchorVisible(state: MatchState, anchor: string, viewer: Seat = 0): boolean {
	const hand = state.hand;
	const positions = ["bottom", "right", "top", "left"];
	const seatAt = (position: string) => ((viewer + positions.indexOf(position)) % 4) as Seat;
	const myTurn = state.phase === "playing" && hand.turn === viewer;
	const tribute = hand.tribute;
	const handStarted = hand.actions.some(Boolean) || hand.finishOrder.length > 0;
	const overlay = state.phase === "handOver" || state.phase === "finished";
	if (/^plate-(bottom|right|top|left)$/.test(anchor) || anchor === "level" || anchor === "team-levels" || anchor === "turn") return true;
	if (anchor === "hand") return hand.hands[viewer]!.length > 0;
	const card = /^card:(.+)$/.exec(anchor);
	if (card) return hand.hands[viewer]!.some((candidate) => candidate.id === card[1]);
	const area = /^play-(bottom|right|top|left)$/.exec(anchor);
	if (area) return hand.actions[seatAt(area[1]!)]?.kind === "play";
	if (anchor === "btn-play") return myTurn;
	if (anchor === "btn-pass") return myTurn && hand.lastPlay !== null;
	if (anchor === "btn-tribute") return state.phase === "tribute" && Boolean(tribute?.givers.includes(viewer)) && !tribute?.given[viewer];
	if (anchor === "btn-return") {
		return state.phase === "return" && Boolean(tribute?.transfers.some((transfer) => transfer.to === viewer)) && !tribute?.returns.some((transfer) => transfer.from === viewer);
	}
	if (anchor === "tribute-note") return Boolean(tribute) && !handStarted && Boolean(tribute?.resisted || (tribute?.transfers.length ?? 0) > 0);
	if (anchor === "btn-ready") return state.phase === "handOver" && !state.ready[viewer];
	if (anchor === "result") return overlay && state.lastResult !== null;
	if (anchor === "result-levels") return state.phase === "handOver" && state.lastResult !== null;
	return false;
}

/** 剧本单测用：这手牌能不能按剧本打出去（压得过上一手）。 */
export function scriptPlayLegal(state: MatchState, cardIds: readonly string[]): boolean {
	const seatHand = state.hand.hands[state.hand.turn]!;
	const cards = cardIds.map((id) => seatHand.find((card) => card.id === id));
	if (cards.some((card) => !card)) return false;
	return legalCombos(cards as Card[], state.hand).length > 0;
}

