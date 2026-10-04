import { describe, expect, it } from "vitest";
import {
	applyAction,
	createMatch,
	viewForPlayer,
	type Card,
	type MatchAction,
	type MatchState,
	type Seat,
} from "../src/index.js";

const players = ["p0", "p1", "p2", "p3"].map((id) => ({ id, name: id.toUpperCase() }));
/** 不洗牌：按建牌顺序发牌，结果可预测。 */
const noShuffle = () => 0.999999;

let serial = 0;
function cards(...specs: string[]): Card[] {
	return specs.map((spec) => {
		serial += 1;
		if (spec === "SJ") return { id: `c${serial}`, suit: "J", rank: 16 };
		if (spec === "BJ") return { id: `c${serial}`, suit: "J", rank: 17 };
		const rankText = spec.slice(1);
		const rank = ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[rankText] ?? Number(rankText);
		return { id: `c${serial}`, suit: spec[0] as Card["suit"], rank };
	});
}

function setup(hands: string[][], turn: Seat, patch: Partial<MatchState> = {}, level = 2): MatchState {
	const state = { ...createMatch(players, noShuffle), ...patch };
	state.hand = { ...state.hand, hands: hands.map((hand) => cards(...hand)), turn, level };
	return state;
}

function act(state: MatchState, seat: Seat, action: MatchAction): MatchState {
	return applyAction(state, players[seat]!.id, action, noShuffle);
}

function play(state: MatchState, seat: Seat, ...specs: string[]): MatchState {
	const hand = [...state.hand.hands[seat]!];
	const cardIds = specs.map((spec) => {
		const wanted = cards(spec)[0]!;
		const index = hand.findIndex((card) => card.suit === wanted.suit && card.rank === wanted.rank);
		if (index < 0) throw new Error(`seat ${seat} has no ${spec}`);
		return hand.splice(index, 1)[0]!.id;
	});
	return act(state, seat, { type: "play", cardIds });
}

describe("createMatch", () => {
	it("deals 27 distinct cards to each of four players", () => {
		const state = createMatch(players);
		expect(state.hand.hands.map((hand) => hand.length)).toEqual([27, 27, 27, 27]);
		expect(new Set(state.hand.hands.flat().map((card) => card.id)).size).toBe(108);
		expect(state.phase).toBe("playing");
		expect(state.hand.level).toBe(2);
	});
});

describe("tricks", () => {
	it("enforces turn order, follows type, and returns the lead to the trick winner", () => {
		let state = setup([["S3", "S9"], ["S5", "D5", "S8"], ["S4", "S7"], ["S6", "SK"]], 0);
		expect(() => act(state, 0, { type: "pass" })).toThrow("领出");
		expect(() => play(state, 1, "S5")).toThrow("还没轮到");
		state = play(state, 0, "S3");
		expect(() => play(state, 1, "S5", "D5")).toThrow("压不过");
		state = play(state, 1, "S5");
		state = act(state, 2, { type: "pass" });
		state = act(state, 3, { type: "pass" });
		state = act(state, 0, { type: "pass" });
		expect(state.hand.turn).toBe(1);
		expect(state.hand.lastPlay).toBeNull();
	});

	it("passes the lead to the partner when a finished player wins the trick", () => {
		let state = setup([["SA"], ["S5", "S6"], ["S4", "S7"], ["S6", "S8"]], 0);
		state = play(state, 0, "SA");
		expect(state.hand.finishOrder).toEqual([0]);
		state = act(state, 1, { type: "pass" });
		state = act(state, 2, { type: "pass" });
		state = act(state, 3, { type: "pass" });
		expect(state.hand.turn).toBe(2);
	});

	it("asks the player to choose when a wild card allows several readings", () => {
		// 打 5：红桃 5 + 8 8 + 3 3 可以是 888 带 33，也可以是 333 带 88。
		const state = setup([["H5", "S8", "D8", "C3", "S3", "S9"], ["S4"], ["S4"], ["S4"]], 0, {}, 5);
		const ids = state.hand.hands[0]!.slice(0, 5).map((card) => card.id);
		expect(() => act(state, 0, { type: "play", cardIds: ids })).toThrow("多种出法");
		const chosen = act(state, 0, { type: "play", cardIds: ids, combo: { type: "fullHouse", size: 5, key: 8 } });
		expect(chosen.hand.lastPlay?.combo.key).toBe(8);
	});
});

describe("hand results and upgrades", () => {
	it("ends at a double finish, upgrades three levels, and lets the losers resist tribute with two big jokers", () => {
		let state = setup([["SA"], ["S3", "S4"], ["SK"], ["S5", "S6"]], 0);
		state = play(state, 0, "SA");
		state = act(state, 1, { type: "pass" });
		state = act(state, 2, { type: "pass" });
		state = act(state, 3, { type: "pass" });
		state = play(state, 2, "SK");
		expect(state.phase).toBe("handOver");
		expect(state.lastResult).toMatchObject({ winnerTeam: 0, upgrade: 3 });
		expect(state.teamLevels).toEqual([5, 2]);

		for (const seat of [0, 1, 2] as Seat[]) state = act(state, seat, { type: "ready" });
		expect(state.phase).toBe("handOver");
		state = act(state, 3, { type: "ready" });
		// 不洗牌时座位 2、4（索引 1、3）各拿到一张大王：双下合计两张，抗贡。
		expect(state.hand.level).toBe(5);
		expect(state.hand.dealerTeam).toBe(0);
		expect(state.hand.tribute).toMatchObject({ givers: [1, 3], receivers: [0, 2], resisted: true });
		expect(state.phase).toBe("playing");
		expect(state.hand.turn).toBe(0);
	});

	it("upgrades by partner position: second place +3, third +2, last +1", () => {
		let state = setup([["SA"], ["S3"], ["S4", "S9"], ["S5", "S6"]], 0);
		state = play(state, 0, "SA");
		for (const seat of [1, 2, 3] as Seat[]) state = act(state, seat, { type: "pass" });
		state = play(state, 2, "S4"); // 接风
		state = play(state, 3, "S5");
		state = act(state, 1, { type: "pass" }); // 座位 1 只剩 3，压不过 5
		state = play(state, 2, "S9");
		expect(state.phase).toBe("handOver");
		expect(state.lastResult?.finishOrder).toEqual([0, 2, 1, 3]);
		expect(state.lastResult?.upgrade).toBe(3);
	});

	it("wins the match on its own A only when the partner is not last", () => {
		const base = { teamLevels: [14, 9] as [number, number] };
		let state = setup([["SA"], ["S3"], ["SK"], ["S4"]], 0, base, 14);
		state.hand.dealerTeam = 0;
		state = play(state, 0, "SA");
		for (const seat of [1, 2, 3] as Seat[]) state = act(state, seat, { type: "pass" });
		state = play(state, 2, "SK");
		expect(state.phase).toBe("finished");
		expect(state.winnerTeam).toBe(0);

		let failed = setup([["SA"], ["S9"], ["S3", "S4"], ["S10"]], 0, { ...base, aFailures: [2, 0] }, 14);
		failed.hand.dealerTeam = 0;
		failed = play(failed, 0, "SA");
		for (const seat of [1, 2, 3] as Seat[]) failed = act(failed, seat, { type: "pass" });
		failed = play(failed, 2, "S3");
		failed = play(failed, 3, "S10");
		failed = act(failed, 1, { type: "pass" });
		failed = act(failed, 2, { type: "pass" });
		failed = play(failed, 1, "S9");
		expect(failed.lastResult).toMatchObject({ finishOrder: [0, 3, 1, 2], upgrade: 1, aFailed: 0, aReset: 0 });
		expect(failed.phase).toBe("handOver");
		expect(failed.teamLevels).toEqual([2, 9]);
	});
});

describe("tribute", () => {
	function tributeState(hands: string[][], givers: Seat[], receivers: Seat[]): MatchState {
		const state = setup(hands, 0, {}, 5);
		state.phase = "tribute";
		state.hand.tribute = { givers, receivers, resisted: false, given: {}, transfers: [], returns: [], leadSeat: null };
		return state;
	}

	it("requires the biggest non-wild card, then a return of 10 or lower, and lets the giver lead", () => {
		let state = tributeState([["S3", "SK"], ["S4"], ["S6"], ["H5", "SA", "S9", "BJ"]], [3], [0]);
		const smallest = state.hand.hands[3]!.find((card) => card.rank === 9)!;
		expect(() => act(state, 3, { type: "tribute", cardId: smallest.id })).toThrow("最大");
		const wild = state.hand.hands[3]!.find((card) => card.suit === "H")!;
		expect(() => act(state, 3, { type: "tribute", cardId: wild.id })).toThrow("最大");
		const joker = state.hand.hands[3]!.find((card) => card.rank === 17)!;
		state = act(state, 3, { type: "tribute", cardId: joker.id });
		expect(state.phase).toBe("return");
		expect(state.hand.hands[0]!.some((card) => card.id === joker.id)).toBe(true);

		const king = state.hand.hands[0]!.find((card) => card.rank === 13)!;
		expect(() => act(state, 0, { type: "returnTribute", cardId: king.id })).toThrow("10");
		const three = state.hand.hands[0]!.find((card) => card.rank === 3)!;
		state = act(state, 0, { type: "returnTribute", cardId: three.id });
		expect(state.phase).toBe("playing");
		expect(state.hand.turn).toBe(3);
		expect(state.hand.hands[3]!.some((card) => card.id === three.id)).toBe(true);
	});

	it("gives the bigger of two tributes to first place, and breaks ties by the seat after first place", () => {
		let state = tributeState([["S3"], ["SA", "S4"], ["S6"], ["SK", "S4"]], [1, 3], [0, 2]);
		state = act(state, 3, { type: "tribute", cardId: state.hand.hands[3]![0]!.id });
		state = act(state, 1, { type: "tribute", cardId: state.hand.hands[1]![0]!.id });
		expect(state.hand.tribute?.transfers.map((transfer) => [transfer.from, transfer.to])).toEqual([[1, 0], [3, 2]]);
		expect(state.hand.tribute?.leadSeat).toBe(1);

		let tied = tributeState([["S3"], ["SA", "S4"], ["S6"], ["DA", "S4"]], [1, 3], [0, 2]);
		tied = act(tied, 1, { type: "tribute", cardId: tied.hand.hands[1]![0]!.id });
		tied = act(tied, 3, { type: "tribute", cardId: tied.hand.hands[3]![0]!.id });
		expect(tied.hand.tribute?.transfers[0]).toMatchObject({ from: 1, to: 0 });
	});
});

describe("viewForPlayer", () => {
	it("shows only the viewer's own cards", () => {
		const state = createMatch(players);
		const view = viewForPlayer(state, "p2");
		expect(view.mySeat).toBe(2);
		expect(view.hand.myCards).toEqual(state.hand.hands[2]);
		expect(view.hand.cardCounts).toEqual([27, 27, 27, 27]);
		const serialized = JSON.stringify(view);
		for (const seat of [0, 1, 3]) {
			const hidden = state.hand.hands[seat]!.filter((card) => !state.hand.hands[2]!.some((mine) => mine.id === card.id));
			expect(hidden.some((card) => serialized.includes(`"${card.id}"`))).toBe(false);
		}
	});
});
