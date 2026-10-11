/**
 * 掼蛋人机（「普通」难度）。
 *
 * 输入只能是 viewForPlayer 之后的状态（看得到自己的手牌、各家张数、本局已经打出的牌、
 * 公开的进贡还贡），看不到别人的手牌。
 *
 * 思路：
 * - 拆牌：把手牌拆成若干手（单张、对子、三同张、三带二、顺子、三连对、钢板、炸弹、同花顺、天王炸），
 *   每一手按「这手牌打出去能不能收回牌权」估一个分，非炸弹每手 −1 + 胜率，炸弹记正分。
 *   整手牌的分 = 最好拆法的总分（逢人配可以补进顺子、对子、炸弹）。
 * - 领出：先走最小、最难接的「小牌」；只剩一手小牌时先打大牌收回牌权，最后一手直接走完。
 *   对家快走完时送他单张 / 对子；对手剩 1、2 张时不出他能接走的单张、对子。
 * - 跟牌：对家的牌一般不压（除非一手出完或接过来就能走完）；对手的牌按「打出去后手牌分变化」决定，
 *   对手快走完时放宽、必要时上炸弹。
 * - 进贡选同花顺用不上的那张；还贡还一张拆了最不心疼的小牌。
 */
import { BIG_JOKER, SMALL_JOKER, isJoker, isWild, rankLabel, singleValue, type Card, type Suit } from "./cards.js";
import { beats, bombPower, describeCombo, detectCombos, type Combo, type ComboType } from "./combos.js";
import { returnCandidates, tributeCandidates, type MatchAction, type Seat } from "./match.js";
import type { MatchView } from "./view.js";

export interface BotAdvice {
	action: MatchAction;
	/** 一句玩家听得懂的理由（教程「提示」用）。 */
	reason: string;
}

/** 可调参数（模拟脚本调参用）。 */
export const botTuning = {
	/** 跟对手的牌：打出去后手牌分至少要涨这么多才压。 */
	follow: 0,
	/** 对手剩这么多张以内就放宽跟牌。 */
	urgentCards: 9,
	/** 领出时每多一张牌的加分（越大越爱出长牌型）。 */
	leadSize: 0.1,
	/** 炸弹：对手剩这么多张以内就炸。 */
	bombCards: 5,
};

type NaturalSuit = "S" | "H" | "C" | "D";
const NATURAL_SUITS: NaturalSuit[] = ["S", "H", "C", "D"];

/** 拆牌里的一手：需要哪些点数各几张、几张逢人配。 */
export interface PlanCombo {
	type: ComboType;
	size: number;
	key: number;
	need: [number, number][];
	wilds: number;
	suit?: NaturalSuit;
	value: number;
}

/** 一次决策里共用的上下文：级牌、没见过的牌（用来判断一手牌是不是已经没人压得住）。 */
interface Ctx {
	level: number;
	/** 每个原本点数（2–14、16、17）还没见过的张数（不含逢人配）。 */
	unseen: number[];
	unseenWilds: number;
	memo: Map<string, DfsResult>;
}

interface DfsResult {
	score: number;
	combos: PlanCombo[];
}

// ---------------------------------------------------------------------------
// 每手牌的估分
// ---------------------------------------------------------------------------

const SINGLE_W: Record<number, number> = { 17: 0.95, 16: 0.85, 15: 0.7, 14: 0.5, 13: 0.35, 12: 0.22, 11: 0.12, 10: 0.06, 9: 0.02 };
const PAIR_W: Record<number, number> = { 17: 0.97, 16: 0.9, 15: 0.72, 14: 0.52, 13: 0.36, 12: 0.22, 11: 0.12, 10: 0.06, 9: 0.02 };
const TRIPLE_W: Record<number, number> = { 15: 0.78, 14: 0.62, 13: 0.46, 12: 0.32, 11: 0.2, 10: 0.11, 9: 0.05 };
const STRAIGHT_W: Record<number, number> = { 14: 0.6, 13: 0.42, 12: 0.27, 11: 0.14, 10: 0.06 };
const TUBE_W: Record<number, number> = { 14: 0.62, 13: 0.46, 12: 0.31, 11: 0.18, 10: 0.1, 9: 0.05 };
const PLATE_W: Record<number, number> = { 14: 0.66, 13: 0.5, 12: 0.36, 11: 0.22, 10: 0.12, 9: 0.06 };
/** 已经没人压得住（只能用炸弹）的一手牌的胜率。 */
const TOP_W = 0.92;
/** 拆牌时三同张先多记一点：之后多半能带走一个对子。 */
const TRIPLE_DFS_BONUS = 0.5;

function rankOfValue(value: number, level: number): number[] {
	// 单张大小 value 对应的原本点数（15 = 级牌）。
	if (value === 15) return [level];
	if (value >= 16) return [value];
	return value === level ? [] : [value];
}

/** 比 key 大的同点数牌型，还有没有可能在别人手里（need 张，逢人配可以补）。 */
function higherGroupPossible(ctx: Ctx, key: number, need: number): boolean {
	for (let value = key + 1; value <= 17; value += 1) {
		for (const rank of rankOfValue(value, ctx.level)) {
			const natural = ctx.unseen[rank] ?? 0;
			const jokerRank = rank >= 16;
			const available = jokerRank ? natural : natural + ctx.unseenWilds;
			if (jokerRank && need > 2) continue;
			if (available >= need) return true;
		}
		// 逢人配自己当级牌用（单张、对子）
		if (value === 15 && ctx.unseenWilds + (ctx.unseen[ctx.level] ?? 0) >= need) return true;
	}
	return false;
}

function groupWin(ctx: Ctx, type: "single" | "pair" | "triple", key: number): number {
	const need = type === "single" ? 1 : type === "pair" ? 2 : 3;
	if (!higherGroupPossible(ctx, key, need)) return TOP_W;
	const table = type === "single" ? SINGLE_W : type === "pair" ? PAIR_W : TRIPLE_W;
	return table[key] ?? 0;
}

function bombValue(type: ComboType, size: number, key: number): number {
	if (type === "jokerBomb") return 1.1;
	if (type === "straightFlush") return 0.62;
	const base = size >= 8 ? 0.95 : size === 7 ? 0.86 : size === 6 ? 0.76 : size === 5 ? 0.5 : 0.3;
	return base + 0.002 * key;
}

/** 一手牌的分：非炸弹 −1 + 胜率（越大越不需要别人让牌），炸弹为正。 */
function comboValue(ctx: Ctx, type: ComboType, size: number, key: number): number {
	switch (type) {
		case "single":
		case "pair":
		case "triple":
			return -1 + groupWin(ctx, type, key);
		case "fullHouse":
			return -1 + groupWin(ctx, "triple", key);
		case "straight":
			return -1 + (STRAIGHT_W[key] ?? 0);
		case "tube":
			return -1 + (TUBE_W[key] ?? 0);
		case "plate":
			return -1 + (PLATE_W[key] ?? 0);
		default:
			return bombValue(type, size, key);
	}
}

export function isBombType(type: ComboType): boolean {
	return type === "bomb" || type === "straightFlush" || type === "jokerBomb";
}

// ---------------------------------------------------------------------------
// 拆牌
// ---------------------------------------------------------------------------

/** 连续牌型里的位置 → 原本点数（位置 1 是当 1 用的 A）。 */
const posRank = (position: number) => (position === 1 ? 14 : position);

function groupType(size: number): ComboType {
	return size === 1 ? "single" : size === 2 ? "pair" : size === 3 ? "triple" : "bomb";
}

/** 不含王、不含逢人配的点数计数（下标 2–14）。 */
function dfs(ctx: Ctx, counts: number[], wilds: number): DfsResult {
	let lowest = 0;
	for (let rank = 2; rank <= 14; rank += 1) {
		if (counts[rank]! > 0) {
			lowest = rank;
			break;
		}
	}
	if (lowest === 0) {
		if (wilds === 0) return { score: 0, combos: [] };
		// 剩下的逢人配：一张当单张级牌，两张当对子。
		const type = groupType(wilds);
		const value = comboValue(ctx, type, wilds, 15);
		return { score: value, combos: [{ type, size: wilds, key: 15, need: [], wilds, value }] };
	}
	const memoKey = counts.slice(2, 15).join("") + wilds;
	const cached = ctx.memo.get(memoKey);
	if (cached) return cached;

	let best: DfsResult = { score: -Infinity, combos: [] };
	const consider = (combo: PlanCombo, dfsBonus: number, nextCounts: number[], nextWilds: number) => {
		const rest = dfs(ctx, nextCounts, nextWilds);
		const score = combo.value + dfsBonus + rest.score;
		if (score > best.score) best = { score, combos: [combo, ...rest.combos] };
	};

	// 1. 这个点数的牌全部成组（可以加逢人配凑成更大的组）。
	const count = counts[lowest]!;
	const key = singleValue(lowest, ctx.level);
	for (let extra = 0; extra <= wilds; extra += 1) {
		const size = count + extra;
		if (size > 10) break;
		const type = groupType(size);
		const next = counts.slice();
		next[lowest] = 0;
		const value = comboValue(ctx, type, size, key);
		consider({ type, size, key, need: [[lowest, count]], wilds: extra, value }, type === "triple" ? TRIPLE_DFS_BONUS : 0, next, wilds - extra);
	}

	// 2. 连续牌型：顺子（5×1）、三连对（3×2）、钢板（2×3），从这个点数开始（2 还可以接 A 当 1）。
	const shapes: [ComboType, number, number, number][] = [
		["straight", 5, 1, 10],
		["tube", 3, 2, 12],
		["plate", 2, 3, 13],
	];
	for (const [type, length, width, maxLow] of shapes) {
		const lows = lowest === 2 ? [1, 2] : [lowest];
		// J 以上开头的顺子：用逢人配补 10 起头的那几张。
		if (type === "straight" && lowest >= 11) lows.push(10);
		for (const low of lows) {
			if (low > maxLow) continue;
			const next = counts.slice();
			const need: [number, number][] = [];
			let wildsNeeded = 0;
			for (let offset = 0; offset < length; offset += 1) {
				const rank = posRank(low + offset);
				const use = Math.min(width, next[rank]!);
				// 比最低点数还低的位置只能用逢人配（那些点数已经没有牌了）。
				if (rank < lowest && rank !== 14 && use > 0) {
					wildsNeeded = 99;
					break;
				}
				if (use > 0) {
					next[rank] = next[rank]! - use;
					need.push([rank, use]);
				}
				wildsNeeded += width - use;
			}
			if (wildsNeeded > wilds) continue;
			if (!need.some(([rank]) => rank === lowest)) continue;
			// 逢人配不能比自然牌还多（避免用两张逢人配硬凑）。
			if (wildsNeeded > 0 && wildsNeeded * 2 > length * width) continue;
			const comboKey = low + length - 1;
			const value = comboValue(ctx, type, length * width, comboKey);
			consider({ type, size: length * width, key: comboKey, need, wilds: wildsNeeded, value }, 0, next, wilds - wildsNeeded);
		}
	}

	ctx.memo.set(memoKey, best);
	return best;
}

/** 三同张配上最小的对子组成三带二，重新算分。 */
function finishPlan(ctx: Ctx, combos: PlanCombo[]): DfsResult {
	const triples = combos.filter((combo) => combo.type === "triple").sort((a, b) => a.key - b.key);
	const pairs = combos.filter((combo) => combo.type === "pair" && combo.value < -0.6).sort((a, b) => a.key - b.key);
	const used = new Set<PlanCombo>();
	const merged: PlanCombo[] = [];
	for (const triple of triples) {
		const pair = pairs.find((candidate) => !used.has(candidate) && candidate.key !== triple.key);
		if (!pair) continue;
		used.add(pair);
		used.add(triple);
		const value = comboValue(ctx, "fullHouse", 5, triple.key);
		merged.push({ type: "fullHouse", size: 5, key: triple.key, need: [...triple.need, ...pair.need], wilds: triple.wilds + pair.wilds, value });
	}
	const result = [...combos.filter((combo) => !used.has(combo)), ...merged];
	return { score: result.reduce((total, combo) => total + combo.value, 0), combos: result };
}

interface HandInfo {
	cards: Card[];
	level: number;
	wildCards: Card[];
	/** 原本点数 → 自然牌（不含逢人配）。 */
	byRank: Map<number, Card[]>;
}

function handInfo(cards: readonly Card[], level: number): HandInfo {
	const byRank = new Map<number, Card[]>();
	const wildCards: Card[] = [];
	for (const card of cards) {
		if (isWild(card, level)) wildCards.push(card);
		else byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
	}
	return { cards: [...cards], level, wildCards, byRank };
}

/** 同花顺候选：花色、起点、用到的自然牌、要几张逢人配。 */
interface FlushOption {
	suit: NaturalSuit;
	low: number;
	cards: Card[];
	wilds: number;
}

function flushOptions(info: HandInfo): FlushOption[] {
	const options: FlushOption[] = [];
	const wilds = info.wildCards.length;
	for (const suit of NATURAL_SUITS) {
		const bySuitRank = new Map<number, Card>();
		for (const [rank, cards] of info.byRank) {
			if (rank >= 16) continue;
			const card = cards.find((candidate) => candidate.suit === suit);
			if (card) bySuitRank.set(rank, card);
		}
		if (bySuitRank.size < 3) continue;
		for (let low = 1; low <= 10; low += 1) {
			const cards: Card[] = [];
			for (let offset = 0; offset < 5; offset += 1) {
				const card = bySuitRank.get(posRank(low + offset));
				if (card) cards.push(card);
			}
			if (5 - cards.length <= wilds && cards.length >= 4) options.push({ suit, low, cards, wilds: 5 - cards.length });
		}
	}
	return options;
}

function countsOf(info: HandInfo, exclude: Set<string>): { counts: number[]; small: number; big: number } {
	const counts = new Array<number>(18).fill(0);
	for (const [rank, cards] of info.byRank) {
		for (const card of cards) if (!exclude.has(card.id)) counts[rank] = counts[rank]! + 1;
	}
	return { counts, small: counts[SMALL_JOKER]!, big: counts[BIG_JOKER]! };
}

function jokerCombos(ctx: Ctx, small: number, big: number): PlanCombo[] {
	if (small === 2 && big === 2) return [{ type: "jokerBomb", size: 4, key: BIG_JOKER, need: [[SMALL_JOKER, 2], [BIG_JOKER, 2]], wilds: 0, value: comboValue(ctx, "jokerBomb", 4, BIG_JOKER) }];
	const combos: PlanCombo[] = [];
	for (const [rank, count] of [[SMALL_JOKER, small], [BIG_JOKER, big]] as const) {
		if (count === 0) continue;
		const type = count === 2 ? "pair" : "single";
		combos.push({ type, size: count, key: rank, need: [[rank, count]], wilds: 0, value: comboValue(ctx, type, count, rank) });
	}
	return combos;
}

export interface Plan {
	score: number;
	combos: PlanCombo[];
	/** 拆牌里同花顺用到的牌：拆别的牌型时尽量不动。 */
	flushCards: Set<string>;
}

/** 整手牌最好的拆法。 */
function planHand(ctx: Ctx, info: HandInfo): Plan {
	const wilds = info.wildCards.length;
	const options = flushOptions(info);
	const choices: FlushOption[][] = [[]];
	for (let first = 0; first < options.length; first += 1) {
		choices.push([options[first]!]);
		for (let second = first + 1; second < options.length; second += 1) {
			const a = options[first]!;
			const b = options[second]!;
			if (a.wilds + b.wilds > wilds) continue;
			if (a.cards.some((card) => b.cards.includes(card))) continue;
			choices.push([a, b]);
		}
	}
	let best: Plan = { score: -Infinity, combos: [], flushCards: new Set() };
	for (const choice of choices.slice(0, 24)) {
		const used = new Set(choice.flatMap((option) => option.cards.map((card) => card.id)));
		const flushWilds = choice.reduce((total, option) => total + option.wilds, 0);
		const { counts, small, big } = countsOf(info, used);
		const rest = dfs(ctx, counts, wilds - flushWilds);
		const finished = finishPlan(ctx, [...rest.combos, ...jokerCombos(ctx, small, big)]);
		const flushCombos: PlanCombo[] = choice.map((option) => ({
			type: "straightFlush",
			size: 5,
			key: option.low + 4,
			need: option.cards.map((card) => [card.rank, 1] as [number, number]),
			wilds: option.wilds,
			suit: option.suit,
			value: comboValue(ctx, "straightFlush", 5, option.low + 4),
		}));
		const score = finished.score + flushCombos.reduce((total, combo) => total + combo.value, 0);
		if (score > best.score) best = { score, combos: [...finished.combos, ...flushCombos], flushCards: used };
	}
	return best;
}

// ---------------------------------------------------------------------------
// 把一手牌落实成具体的牌
// ---------------------------------------------------------------------------

export interface Play {
	cards: Card[];
	combo: Combo;
}

function realize(info: HandInfo, spec: { type: ComboType; size: number; key: number; need: [number, number][]; wilds: number; suit?: NaturalSuit }, reserved: Set<string>): Play | null {
	const chosen: Card[] = [];
	const taken = new Set<string>();
	for (const [rank, count] of spec.need) {
		const pool = (info.byRank.get(rank) ?? []).filter((card) => !taken.has(card.id));
		const ordered = spec.suit
			? pool.filter((card) => card.suit === spec.suit)
			: [...pool.filter((card) => !reserved.has(card.id)), ...pool.filter((card) => reserved.has(card.id))];
		if (ordered.length < count) return null;
		for (const card of ordered.slice(0, count)) {
			chosen.push(card);
			taken.add(card.id);
		}
	}
	if (spec.wilds > info.wildCards.length) return null;
	chosen.push(...info.wildCards.slice(0, spec.wilds));
	const combo = detectCombos(chosen, info.level).find((candidate) => candidate.type === spec.type && candidate.key === spec.key && candidate.size === spec.size);
	return combo ? { cards: chosen, combo } : null;
}

type Spec = { type: ComboType; size: number; key: number; need: [number, number][]; wilds: number; suit?: NaturalSuit };

/** 手里所有能打出的牌型（同一种牌型同一个大小只列一种拿法）。 */
function allSpecs(info: HandInfo): Spec[] {
	const specs: Spec[] = [];
	const level = info.level;
	const wilds = info.wildCards.length;
	const count = (rank: number) => info.byRank.get(rank)?.length ?? 0;
	// 同点数：单张、对子、三同张、炸弹
	const groups: Spec[] = [];
	for (let rank = 2; rank <= 14; rank += 1) {
		const natural = count(rank);
		const key = singleValue(rank, level);
		for (let size = 1; size <= Math.min(10, natural + wilds); size += 1) {
			const use = Math.min(size, natural);
			if (use === 0) continue;
			groups.push({ type: groupType(size), size, key, need: [[rank, use]], wilds: size - use });
		}
	}
	if (count(level) === 0 && wilds > 0) {
		for (let size = 1; size <= wilds; size += 1) groups.push({ type: groupType(size), size, key: 15, need: [], wilds: size });
	}
	for (const rank of [SMALL_JOKER, BIG_JOKER]) {
		const natural = count(rank);
		for (let size = 1; size <= Math.min(2, natural); size += 1) groups.push({ type: groupType(size), size, key: rank, need: [[rank, size]], wilds: 0 });
	}
	specs.push(...groups);
	if (count(SMALL_JOKER) === 2 && count(BIG_JOKER) === 2) specs.push({ type: "jokerBomb", size: 4, key: BIG_JOKER, need: [[SMALL_JOKER, 2], [BIG_JOKER, 2]], wilds: 0 });
	// 三带二
	const triples = groups.filter((spec) => spec.type === "triple");
	const pairs = groups.filter((spec) => spec.type === "pair");
	for (const triple of triples) {
		const options = pairs
			.filter((pair) => pair.need[0]?.[0] !== triple.need[0]?.[0] && pair.wilds + triple.wilds <= wilds && pair.need.length > 0)
			.sort((a, b) => a.wilds - b.wilds || a.key - b.key)
			.slice(0, 3);
		for (const pair of options) specs.push({ type: "fullHouse", size: 5, key: triple.key, need: [...triple.need, ...pair.need], wilds: triple.wilds + pair.wilds });
	}
	// 连续牌型
	const shapes: [ComboType, number, number, number][] = [["straight", 5, 1, 10], ["tube", 3, 2, 12], ["plate", 2, 3, 13]];
	for (const [type, length, width, maxLow] of shapes) {
		for (let low = 1; low <= maxLow; low += 1) {
			const need: [number, number][] = [];
			let wildsNeeded = 0;
			for (let offset = 0; offset < length; offset += 1) {
				const rank = posRank(low + offset);
				const use = Math.min(width, count(rank));
				if (use > 0) need.push([rank, use]);
				wildsNeeded += width - use;
			}
			if (wildsNeeded <= wilds && need.length > 0) specs.push({ type, size: length * width, key: low + length - 1, need, wilds: wildsNeeded });
		}
	}
	// 同花顺
	for (const option of flushOptions(info)) {
		specs.push({ type: "straightFlush", size: 5, key: option.low + 4, need: option.cards.map((card) => [card.rank, 1]), wilds: option.wilds, suit: option.suit });
	}
	return specs;
}

/** 手里能压过 target（null = 领出，任何牌型）的所有出法。 */
export function enumeratePlays(cards: readonly Card[], level: number, target: Combo | null, reserved: Set<string> = new Set()): Play[] {
	const info = handInfo(cards, level);
	const plays: Play[] = [];
	for (const spec of allSpecs(info)) {
		if (target && !beats({ type: spec.type, size: spec.size, key: spec.key }, target)) continue;
		const play = realize(info, spec, reserved);
		if (play && beats(play.combo, target)) plays.push(play);
	}
	return plays;
}

// ---------------------------------------------------------------------------
// 局面
// ---------------------------------------------------------------------------

function makeCtx(view: MatchView): Ctx {
	const level = view.hand.level;
	const unseen = new Array<number>(18).fill(0);
	for (let rank = 2; rank <= 14; rank += 1) unseen[rank] = rank === level ? 6 : 8;
	unseen[SMALL_JOKER] = 2;
	unseen[BIG_JOKER] = 2;
	let unseenWilds = 2;
	const seen = [...view.hand.myCards, ...(view.hand.played ?? [])];
	for (const card of seen) {
		if (isWild(card, level)) unseenWilds -= 1;
		else unseen[card.rank] = unseen[card.rank]! - 1;
	}
	return { level, unseen, unseenWilds: Math.max(0, unseenWilds), memo: new Map() };
}

function evaluate(ctx: Ctx, cards: readonly Card[]): number {
	if (cards.length === 0) return 50;
	return planHand(ctx, handInfo(cards, ctx.level)).score;
}

function without(cards: readonly Card[], removed: readonly Card[]): Card[] {
	const ids = new Set(removed.map((card) => card.id));
	return cards.filter((card) => !ids.has(card.id));
}

function partnerSeat(seat: Seat): Seat {
	return ((seat + 2) % 4) as Seat;
}

function comboText(combo: Combo, level: number): string {
	return describeCombo(combo, level);
}

function winValue(ctx: Ctx, combo: Combo): number {
	return isBombType(combo.type) ? 1 : comboValue(ctx, combo.type, combo.size, combo.key) + 1;
}

/** 这手牌能不能一下子全部打出去。 */
function wholeHandPlay(cards: readonly Card[], level: number, target: Combo | null): Play | null {
	const combos = detectCombos(cards, level).filter((combo) => beats(combo, target));
	if (combos.length === 0) return null;
	combos.sort((a, b) => bombPower(a) - bombPower(b));
	return { cards: [...cards], combo: combos[0]! };
}

function playAction(play: Play): MatchAction {
	return { type: "play", cardIds: play.cards.map((card) => card.id), combo: play.combo };
}

/** 对手（还没走完的）里最少的张数。 */
function opponentsLeft(view: MatchView, seat: Seat): number[] {
	return ([0, 1, 2, 3] as Seat[])
		.filter((other) => other % 2 !== seat % 2 && (view.hand.cardCounts[other] ?? 0) > 0)
		.map((other) => view.hand.cardCounts[other] ?? 0);
}

// ---------------------------------------------------------------------------
// 领出
// ---------------------------------------------------------------------------

function leadAdvice(view: MatchView, seat: Seat, ctx: Ctx): BotAdvice {
	const level = view.hand.level;
	const cards = view.hand.myCards;
	const whole = wholeHandPlay(cards, level, null);
	if (whole) return { action: playAction(whole), reason: `一手打完：${comboText(whole.combo, level)}。` };

	const info = handInfo(cards, level);
	const plan = planHand(ctx, info);
	const plays: { play: Play; plan: PlanCombo }[] = [];
	for (const combo of plan.combos) {
		const play = realize(info, combo, plan.flushCards);
		if (play) plays.push({ play, plan: combo });
	}
	if (plays.length === 0) {
		// 理论上不会发生：退回打最小的一张。
		const fallback = enumeratePlays(cards, level, null).sort((a, b) => a.combo.key - b.combo.key)[0]!;
		return { action: playAction(fallback), reason: "先出一张小牌。" };
	}

	const partner = partnerSeat(seat);
	const partnerCount = view.hand.cardCounts[partner] ?? 0;
	const opponents = opponentsLeft(view, seat);
	const oppMin = opponents.length > 0 ? Math.min(...opponents) : 99;
	const nonBombs = plays.filter((entry) => !isBombType(entry.play.combo.type));
	const losers = nonBombs.filter((entry) => winValue(ctx, entry.play.combo) < 0.8);

	// 只剩一手小牌：先把稳赢的大牌 / 炸弹打出去收回牌权，最后一手直接走完。
	if (losers.length <= 1 && plays.length >= 2) {
		const winners = plays.filter((entry) => !losers.includes(entry));
		// 稳赢的非炸弹先打，炸弹留到最后用来抢牌权；没有就打最小的炸弹
		winners.sort((a, b) => bombPower(a.play.combo) - bombPower(b.play.combo) || winValue(ctx, b.play.combo) - winValue(ctx, a.play.combo));
		const pick = winners.find((entry) => !isBombType(entry.play.combo.type)) ?? (losers.length === 0 ? winners[0] : undefined);
		if (pick) return { action: playAction(pick.play), reason: `先出大牌 ${comboText(pick.play.combo, level)} 拿回牌权，再走最后一手。` };
	}

	let best: { play: Play; score: number; reason: string } | null = null;
	for (const entry of plays) {
		const combo = entry.play.combo;
		const bomb = isBombType(combo.type);
		let score = -entry.plan.value + botTuning.leadSize * combo.size - 0.01 * combo.key;
		let reason = `先走小牌 ${comboText(combo, level)}，大牌留着收牌权。`;
		if (bomb) score -= 3;
		if (combo.size >= 5 && !bomb) reason = `先出${comboText(combo, level)}，一次走掉 ${combo.size} 张，别人不好接。`;
		// 对手只剩 1–2 张：不出他能直接接走的单张 / 对子
		if (oppMin <= 2 && !bomb && combo.size === oppMin && (combo.type === "single" || combo.type === "pair")) {
			const win = winValue(ctx, combo);
			score -= win >= 0.8 ? 0 : 1.5;
			if (win >= 0.8) reason = `对手只剩 ${oppMin} 张，出最大的${comboText(combo, level)}顶住。`;
		}
		// 对家快走完：送他小单张 / 小对子
		if (partnerCount > 0 && partnerCount <= 2 && oppMin > 2 && !bomb && combo.size === partnerCount && (combo.type === "single" || combo.type === "pair")) {
			score += 1 - winValue(ctx, combo);
			reason = `对家只剩 ${partnerCount} 张，送他一手小${combo.type === "single" ? "单张" : "对子"}。`;
		}
		if (!best || score > best.score) best = { play: entry.play, score, reason };
	}
	return { action: playAction(best!.play), reason: best!.reason };
}

// ---------------------------------------------------------------------------
// 跟牌
// ---------------------------------------------------------------------------

function followAdvice(view: MatchView, seat: Seat, ctx: Ctx): BotAdvice {
	const hand = view.hand;
	const level = hand.level;
	const cards = hand.myCards;
	const last = hand.lastPlay!;
	const target = last.combo;
	const fromPartner = last.seat === partnerSeat(seat);
	const pass: BotAdvice = { action: { type: "pass" }, reason: "" };

	const whole = wholeHandPlay(cards, level, target);
	if (whole && !(fromPartner && (hand.cardCounts[last.seat] ?? 0) === 0)) {
		return { action: playAction(whole), reason: `压上去就一手打完：${comboText(whole.combo, level)}。` };
	}

	const info = handInfo(cards, level);
	const plan = planHand(ctx, info);
	const before = plan.score;
	const plays = enumeratePlays(cards, level, target, plan.flushCards);
	if (plays.length === 0) return { ...pass, reason: fromPartner ? "对家的牌，让他走。" : "要不起。" };

	const scored = plays.map((play) => {
		const rest = without(cards, play.cards);
		const after = evaluate(ctx, rest);
		return { play, gain: after - before, after, bomb: isBombType(play.combo.type) };
	});
	scored.sort((a, b) => b.gain - a.gain);

	if (fromPartner) {
		if ((hand.cardCounts[last.seat] ?? 0) === 0) return { ...pass, reason: "对家已经走完，不压，等着接风。" };
		// 对家出的小牌、我接过来就能很快走完：接过来
		const take = scored.find((entry) => !entry.bomb && entry.gain >= 0.6);
		const partnerWin = winValue(ctx, target);
		if (take && partnerWin < 0.15 && !isBombType(target.type) && planLosers(ctx, without(cards, take.play.cards)) <= 1) {
			return { action: playAction(take.play), reason: `对家出的是小牌，我接过来下一手就能走完。` };
		}
		return { ...pass, reason: "对家的牌，不压，让他继续出。" };
	}

	const lastCount = hand.cardCounts[last.seat] ?? 0;
	const opponents = opponentsLeft(view, seat);
	const oppMin = opponents.length > 0 ? Math.min(...opponents) : 99;
	const partnerCount = hand.cardCounts[partnerSeat(seat)] ?? 0;
	let threshold = botTuning.follow;
	let why = "";
	if (lastCount === 0) {
		threshold = 0;
		why = "对手已经走完，不能让他的对家接风";
	}
	if (partnerCount > 0 && partnerCount <= 3) {
		threshold = Math.min(threshold, 0);
		why = why || `对家只剩 ${partnerCount} 张，要把牌权抢回来给他`;
	}
	if ((lastCount > 0 && lastCount <= botTuning.urgentCards) || oppMin <= botTuning.urgentCards - 2) {
		threshold = -0.7;
		why = `对手只剩 ${Math.min(lastCount || 99, oppMin)} 张，必须压住`;
	}

	const normal = scored.find((entry) => !entry.bomb);
	if (normal && normal.gain >= threshold) {
		const reason = why
			? `${why}，出${comboText(normal.play.combo, level)}。`
			: `${comboText(normal.play.combo, level)}压得住，也不拆别的牌。`;
		return { action: playAction(normal.play), reason };
	}

	// 炸弹：对手快走完、或者炸完自己很快能走完时才用。
	const bombs = scored.filter((entry) => entry.bomb).sort((a, b) => bombPower(a.play.combo) - bombPower(b.play.combo) || a.play.combo.key - b.play.combo.key);
	if (bombs.length > 0) {
		const bomb = bombs[0]!;
		const urgent = (lastCount > 0 && lastCount <= botTuning.bombCards) || oppMin <= botTuning.bombCards - 2 || lastCount === 0;
		const closeOut = planLosers(ctx, without(cards, bomb.play.cards)) <= 1;
		const bigTrick = target.size >= 5 && !isBombType(target.type) && bombs.length >= 2 && oppMin <= 10;
		if (urgent || closeOut || bigTrick) {
			const reason = urgent
				? `对手只剩 ${Math.min(lastCount || 99, oppMin)} 张，用${comboText(bomb.play.combo, level)}炸住。`
				: closeOut
					? `用${comboText(bomb.play.combo, level)}抢回牌权，剩下的牌很快能走完。`
					: `对手出了一大手，用${comboText(bomb.play.combo, level)}抢回牌权。`;
			return { action: playAction(bomb.play), reason };
		}
	}
	if (normal) return { ...pass, reason: `能压但要拆牌或者浪费大牌，先不出。` };
	return { ...pass, reason: bombs.length > 0 ? "只有炸弹压得住，现在还不值得炸。" : "要不起。" };
}

/** 一手牌拆完后还有几手「小牌」（需要别人让牌权才能出）。 */
function planLosers(ctx: Ctx, cards: readonly Card[]): number {
	if (cards.length === 0) return 0;
	const plan = planHand(ctx, handInfo(cards, ctx.level));
	return plan.combos.filter((combo) => !isBombType(combo.type) && combo.value + 1 < 0.8).length;
}

// ---------------------------------------------------------------------------
// 进贡、还贡
// ---------------------------------------------------------------------------

function tributeAdvice(view: MatchView, ctx: Ctx): BotAdvice {
	const cards = view.hand.myCards;
	const options = tributeCandidates(cards, view.hand.level);
	let best = options[0]!;
	let bestScore = -Infinity;
	for (const card of options) {
		const score = evaluate(ctx, without(cards, [card]));
		if (score > bestScore) {
			bestScore = score;
			best = card;
		}
	}
	return { action: { type: "tribute", cardId: best.id }, reason: `进贡必须交出最大的一张：${cardLabel(best)}。` };
}

function returnAdvice(view: MatchView, ctx: Ctx): BotAdvice {
	const cards = view.hand.myCards;
	const options = returnCandidates(cards);
	let best = options[0]!;
	let bestScore = -Infinity;
	const tried = new Set<string>();
	for (const card of options) {
		const signature = `${card.suit}${card.rank}`;
		if (tried.has(signature)) continue;
		tried.add(signature);
		const score = evaluate(ctx, without(cards, [card])) - 0.001 * card.rank;
		if (score > bestScore) {
			bestScore = score;
			best = card;
		}
	}
	return { action: { type: "returnTribute", cardId: best.id }, reason: `还一张拆了最不心疼的小牌：${cardLabel(best)}。` };
}

const SUIT_NAMES: Record<Suit, string> = { S: "黑桃", H: "红桃", C: "梅花", D: "方块", J: "" };

function cardLabel(card: Card): string {
	return isJoker(card) ? rankLabel(card.rank) : `${SUIT_NAMES[card.suit]}${rankLabel(card.rank)}`;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/** 人机下一步和理由；不该它动时返回 null。view 必须是 viewForPlayer(state, playerId)。 */
export function botAdvice(view: MatchView, playerId: string): BotAdvice | null {
	const seat = view.players.findIndex((player) => player.id === playerId);
	if (seat < 0 || view.mySeat !== seat) return null;
	const mySeat = seat as Seat;
	const hand = view.hand;
	switch (view.phase) {
		case "tribute": {
			const tribute = hand.tribute;
			if (!tribute || !tribute.givers.includes(mySeat) || tribute.givenSeats.includes(mySeat)) return null;
			return tributeAdvice(view, makeCtx(view));
		}
		case "return": {
			const tribute = hand.tribute;
			if (!tribute?.transfers.some((transfer) => transfer.to === mySeat)) return null;
			if (tribute.returns.some((transfer) => transfer.from === mySeat)) return null;
			return returnAdvice(view, makeCtx(view));
		}
		case "playing": {
			if (hand.turn !== mySeat || hand.myCards.length === 0) return null;
			const ctx = makeCtx(view);
			return hand.lastPlay ? followAdvice(view, mySeat, ctx) : leadAdvice(view, mySeat, ctx);
		}
		case "handOver":
			if (view.ready[mySeat]) return null;
			return { action: { type: "ready" }, reason: "准备下一局。" };
		default:
			return null;
	}
}

/** 人机的下一步（服务器、托管、离线代打用）。 */
export function botCommand(view: MatchView, playerId: string): MatchAction | null {
	return botAdvice(view, playerId)?.action ?? null;
}

/** 测试和模拟用：整手牌的拆法。 */
export function debugPlan(cards: readonly Card[], level: number, view?: MatchView): Plan {
	const ctx: Ctx = view ? makeCtx(view) : { level, unseen: defaultUnseen(level), unseenWilds: 2, memo: new Map() };
	return planHand(ctx, handInfo(cards, level));
}

function defaultUnseen(level: number): number[] {
	const unseen = new Array<number>(18).fill(0);
	for (let rank = 2; rank <= 14; rank += 1) unseen[rank] = rank === level ? 6 : 8;
	unseen[SMALL_JOKER] = 2;
	unseen[BIG_JOKER] = 2;
	return unseen;
}
