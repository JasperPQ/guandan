import { BIG_JOKER, createDeck, isJoker, isWild, shuffle, singleValue, sortCards, type Card } from "./cards.js";
import { beats, detectCombos, sameCombo, type Combo } from "./combos.js";

export type Seat = 0 | 1 | 2 | 3;
export type Team = 0 | 1;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];

export interface MatchPlayer {
	id: string;
	name: string;
}

export type Phase = "tribute" | "return" | "playing" | "handOver" | "finished";

export interface TrickPlay {
	seat: Seat;
	cards: Card[];
	combo: Combo;
}

export type SeatAction = { kind: "play"; cards: Card[]; combo: Combo } | { kind: "pass" };

export interface TributeTransfer {
	from: Seat;
	to: Seat;
	card: Card;
}

export interface TributeState {
	givers: Seat[];
	/** receivers[0] 为头游，双下时 receivers[1] 为二游。 */
	receivers: Seat[];
	resisted: boolean;
	/** 已交出但尚未分配的贡牌。 */
	given: Partial<Record<Seat, Card>>;
	transfers: TributeTransfer[];
	returns: TributeTransfer[];
	leadSeat: Seat | null;
}

export interface HandState {
	number: number;
	level: number;
	/** 庄家队；第一局为 null。 */
	dealerTeam: Team | null;
	hands: Card[][];
	turn: Seat;
	lastPlay: TrickPlay | null;
	passes: number;
	/** 每个座位在当前这一轮最近的动作，用于桌面展示。 */
	actions: (SeatAction | null)[];
	finishOrder: Seat[];
	tribute: TributeState | null;
}

export interface HandResult {
	finishOrder: Seat[];
	winnerTeam: Team;
	upgrade: number;
	levelPlayed: number;
	teamLevels: [number, number];
	aFailed: Team | null;
	aReset: Team | null;
}

export interface MatchState {
	players: MatchPlayer[];
	teamLevels: [number, number];
	aFailures: [number, number];
	phase: Phase;
	hand: HandState;
	lastResult: HandResult | null;
	ready: boolean[];
	winnerTeam: Team | null;
}

export type MatchAction =
	| { type: "play"; cardIds: string[]; combo?: Combo }
	| { type: "pass" }
	| { type: "tribute"; cardId: string }
	| { type: "returnTribute"; cardId: string }
	| { type: "ready" };

export class RuleViolation extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RuleViolation";
	}
}

export function teamOf(seat: Seat): Team {
	return (seat % 2) as Team;
}

export function partnerOf(seat: Seat): Seat {
	return ((seat + 2) % 4) as Seat;
}

function nextSeat(seat: Seat): Seat {
	return ((seat + 1) % 4) as Seat;
}

function deal(random: () => number, level: number): Card[][] {
	const deck = shuffle(createDeck(), random);
	return SEATS.map((seat) => sortCards(deck.slice(seat * 27, seat * 27 + 27), level));
}

function newHand(number: number, level: number, dealerTeam: Team | null, random: () => number, turn: Seat): HandState {
	return {
		number,
		level,
		dealerTeam,
		hands: deal(random, level),
		turn,
		lastPlay: null,
		passes: 0,
		actions: [null, null, null, null],
		finishOrder: [],
		tribute: null,
	};
}

export function createMatch(players: MatchPlayer[], random: () => number = Math.random): MatchState {
	if (players.length !== 4) throw new RuleViolation("掼蛋需要 4 位玩家。");
	return {
		players: players.map((player) => ({ ...player })),
		teamLevels: [2, 2],
		aFailures: [0, 0],
		phase: "playing",
		hand: newHand(1, 2, null, random, Math.floor(random() * 4) as Seat),
		lastResult: null,
		ready: [false, false, false, false],
		winnerTeam: null,
	};
}

/** 进贡可选的牌：除逢人配外单张最大的那些牌。 */
export function tributeCandidates(hand: readonly Card[], level: number): Card[] {
	const eligible = hand.filter((card) => !isWild(card, level));
	const best = Math.max(...eligible.map((card) => singleValue(card.rank, level)));
	return eligible.filter((card) => singleValue(card.rank, level) === best);
}

/** 还贡可选的牌：原本点数不超过 10；没有时可还任意一张。 */
export function returnCandidates(hand: readonly Card[]): Card[] {
	const low = hand.filter((card) => !isJoker(card) && card.rank <= 10);
	return low.length > 0 ? low : [...hand];
}

/** 当前局面下这组牌可以按哪些牌型打出。 */
export function legalCombos(cards: readonly Card[], hand: HandState): Combo[] {
	return detectCombos(cards, hand.level).filter((combo) => beats(combo, hand.lastPlay?.combo ?? null));
}

function seatOf(state: MatchState, playerId: string): Seat {
	const seat = state.players.findIndex((player) => player.id === playerId);
	if (seat < 0) throw new RuleViolation("你不在这场对局中。");
	return seat as Seat;
}

function takeCards(hand: Card[], cardIds: readonly string[]): Card[] {
	if (new Set(cardIds).size !== cardIds.length) throw new RuleViolation("选择的牌有重复。");
	return cardIds.map((cardId) => {
		const index = hand.findIndex((card) => card.id === cardId);
		if (index < 0) throw new RuleViolation("你没有这张牌。");
		return hand.splice(index, 1)[0]!;
	});
}

function nextSeatWithCards(hand: HandState, from: Seat): Seat {
	let seat = nextSeat(from);
	while (hand.hands[seat]!.length === 0 && seat !== from) seat = nextSeat(seat);
	return seat;
}

function handIsOver(hand: HandState): boolean {
	const [first, second] = hand.finishOrder;
	if (first !== undefined && second !== undefined && teamOf(first) === teamOf(second)) return true;
	return hand.finishOrder.length >= 3;
}

function finishHand(state: MatchState): void {
	const hand = state.hand;
	const order = [...hand.finishOrder];
	for (const seat of SEATS) if (!order.includes(seat)) order.push(seat);
	hand.finishOrder = order;

	const winner = order[0]!;
	const winnerTeam = teamOf(winner);
	const upgrade = 4 - order.indexOf(partnerOf(winner));
	const dealer = hand.dealerTeam;
	const playingA = dealer !== null && hand.level === 14;

	if (playingA && dealer === winnerTeam && upgrade >= 2) {
		state.phase = "finished";
		state.winnerTeam = winnerTeam;
		state.lastResult = { finishOrder: order, winnerTeam, upgrade, levelPlayed: hand.level, teamLevels: [...state.teamLevels], aFailed: null, aReset: null };
		return;
	}

	state.teamLevels[winnerTeam] = Math.min(14, state.teamLevels[winnerTeam] + upgrade);
	let aFailed: Team | null = null;
	let aReset: Team | null = null;
	if (playingA) {
		aFailed = dealer;
		state.aFailures[dealer] += 1;
		if (state.aFailures[dealer] >= 3) {
			state.teamLevels[dealer] = 2;
			state.aFailures[dealer] = 0;
			aReset = dealer;
		}
	}
	state.lastResult = { finishOrder: order, winnerTeam, upgrade, levelPlayed: hand.level, teamLevels: [...state.teamLevels], aFailed, aReset };
	state.phase = "handOver";
	state.ready = [false, false, false, false];
}

function startNextHand(state: MatchState, random: () => number): void {
	const result = state.lastResult!;
	const order = result.finishOrder;
	const dealerTeam = result.winnerTeam;
	const hand = newHand(state.hand.number + 1, state.teamLevels[dealerTeam], dealerTeam, random, order[0]!);
	const doubleDown = teamOf(order[1]!) === dealerTeam;
	const givers = doubleDown ? [order[2]!, order[3]!] : [order[3]!];
	const receivers = doubleDown ? [order[0]!, order[1]!] : [order[0]!];
	const bigJokers = givers.reduce((total: number, seat) => total + hand.hands[seat]!.filter((card) => card.rank === BIG_JOKER).length, 0);
	const resisted = bigJokers >= 2;
	hand.tribute = { givers, receivers, resisted, given: {}, transfers: [], returns: [], leadSeat: null };
	state.hand = hand;
	state.phase = resisted ? "playing" : "tribute";
}

function assignTribute(state: MatchState): void {
	const hand = state.hand;
	const tribute = hand.tribute!;
	const [head, second] = tribute.receivers;
	let pairs: [Seat, Seat][];
	if (tribute.givers.length === 1) {
		pairs = [[tribute.givers[0]!, head!]];
	} else {
		const [left, right] = tribute.givers as [Seat, Seat];
		const leftValue = singleValue(tribute.given[left]!.rank, hand.level);
		const rightValue = singleValue(tribute.given[right]!.rank, hand.level);
		// 一样大时，坐在头游下家位置的人把牌给头游。
		const toHead = leftValue !== rightValue
			? (leftValue > rightValue ? left : right)
			: (nextSeat(head!) === left ? left : right);
		const other = toHead === left ? right : left;
		pairs = [[toHead, head!], [other, second!]];
	}
	for (const [from, to] of pairs) {
		const card = tribute.given[from]!;
		hand.hands[to] = sortCards([...hand.hands[to]!, card], hand.level);
		tribute.transfers.push({ from, to, card });
	}
	tribute.given = {};
	tribute.leadSeat = pairs[0]![0];
	state.phase = "return";
}

function applyPlay(state: MatchState, seat: Seat, cardIds: readonly string[], requested: Combo | undefined): void {
	const hand = state.hand;
	if (hand.turn !== seat) throw new RuleViolation("还没轮到你出牌。");
	if (cardIds.length === 0) throw new RuleViolation("请先选择要出的牌。");
	const remaining = [...hand.hands[seat]!];
	const cards = takeCards(remaining, cardIds);
	const options = legalCombos(cards, hand);
	if (options.length === 0) {
		throw new RuleViolation(detectCombos(cards, hand.level).length === 0 ? "这组牌不是有效牌型。" : "这组牌压不过上家。");
	}
	const combo = requested ? options.find((option) => sameCombo(option, requested)) : options.length === 1 ? options[0] : undefined;
	if (!combo) throw new RuleViolation(requested ? "这组牌不能按所选牌型打出。" : "这组牌有多种出法，请选择牌型。");

	if (!hand.lastPlay) hand.actions = [null, null, null, null];
	hand.hands[seat] = remaining;
	hand.lastPlay = { seat, cards, combo };
	hand.passes = 0;
	hand.actions[seat] = { kind: "play", cards, combo };
	if (remaining.length === 0) {
		hand.finishOrder.push(seat);
		if (handIsOver(hand)) {
			finishHand(state);
			return;
		}
	}
	hand.turn = nextSeatWithCards(hand, seat);
}

function applyPass(state: MatchState, seat: Seat): void {
	const hand = state.hand;
	if (hand.turn !== seat) throw new RuleViolation("还没轮到你。");
	const lastPlay = hand.lastPlay;
	if (!lastPlay) throw new RuleViolation("领出时必须出牌。");
	hand.actions[seat] = { kind: "pass" };
	hand.passes += 1;
	const lastHasCards = hand.hands[lastPlay.seat]!.length > 0;
	const responders = SEATS.filter((candidate) => hand.hands[candidate]!.length > 0 && candidate !== lastPlay.seat).length;
	if (hand.passes >= responders) {
		// 一轮结束；出牌者已出完时由对家接风。
		hand.turn = lastHasCards ? lastPlay.seat : partnerOf(lastPlay.seat);
		hand.lastPlay = null;
		hand.passes = 0;
		return;
	}
	hand.turn = nextSeatWithCards(hand, seat);
}

export function applyAction(
	previous: MatchState,
	playerId: string,
	action: MatchAction,
	random: () => number = Math.random,
): MatchState {
	const state = structuredClone(previous);
	const seat = seatOf(state, playerId);
	const hand = state.hand;

	switch (action?.type) {
		case "play":
			if (state.phase !== "playing") throw new RuleViolation("现在不是出牌阶段。");
			if (!Array.isArray(action.cardIds) || action.cardIds.some((cardId) => typeof cardId !== "string")) {
				throw new RuleViolation("出牌数据无效。");
			}
			applyPlay(state, seat, action.cardIds, action.combo);
			return state;
		case "pass":
			if (state.phase !== "playing") throw new RuleViolation("现在不是出牌阶段。");
			applyPass(state, seat);
			return state;
		case "tribute": {
			const tribute = hand.tribute;
			if (state.phase !== "tribute" || !tribute) throw new RuleViolation("现在不是进贡阶段。");
			if (!tribute.givers.includes(seat)) throw new RuleViolation("你这局不需要进贡。");
			if (tribute.given[seat]) throw new RuleViolation("你已经进贡了。");
			if (!tributeCandidates(hand.hands[seat]!, hand.level).some((card) => card.id === action.cardId)) {
				throw new RuleViolation("必须进贡手中除逢人配外最大的牌。");
			}
			const remaining = [...hand.hands[seat]!];
			tribute.given[seat] = takeCards(remaining, [action.cardId])[0]!;
			hand.hands[seat] = remaining;
			if (tribute.givers.every((giver) => tribute.given[giver])) assignTribute(state);
			return state;
		}
		case "returnTribute": {
			const tribute = hand.tribute;
			if (state.phase !== "return" || !tribute) throw new RuleViolation("现在不是还贡阶段。");
			const transfer = tribute.transfers.find((candidate) => candidate.to === seat);
			if (!transfer) throw new RuleViolation("你这局不需要还贡。");
			if (tribute.returns.some((candidate) => candidate.from === seat)) throw new RuleViolation("你已经还贡了。");
			if (!returnCandidates(hand.hands[seat]!).some((card) => card.id === action.cardId)) {
				throw new RuleViolation("还贡的牌点数不能超过 10。");
			}
			const remaining = [...hand.hands[seat]!];
			const card = takeCards(remaining, [action.cardId])[0]!;
			hand.hands[seat] = remaining;
			hand.hands[transfer.from] = sortCards([...hand.hands[transfer.from]!, card], hand.level);
			tribute.returns.push({ from: seat, to: transfer.from, card });
			if (tribute.returns.length === tribute.transfers.length) {
				state.phase = "playing";
				hand.turn = tribute.leadSeat!;
			}
			return state;
		}
		case "ready":
			if (state.phase !== "handOver") throw new RuleViolation("现在不需要准备。");
			state.ready[seat] = true;
			if (state.ready.every(Boolean)) startNextHand(state, random);
			return state;
		default:
			throw new RuleViolation("无法识别的行动。");
	}
}
