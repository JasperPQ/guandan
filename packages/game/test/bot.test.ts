import { describe, expect, it } from "vitest";
import {
	applyAction,
	botAdvice,
	botCommand,
	createMatch,
	debugPlan,
	detectCombos,
	viewForPlayer,
	type Card,
	type MatchAction,
	type MatchState,
	type Seat,
} from "../src/index.js";

const players = ["p0", "p1", "p2", "p3"].map((id) => ({ id, name: id.toUpperCase() }));

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

/** 造一个出牌中的局面；lastPlay 由 seat 出的 specs。 */
function setup(hands: string[][], turn: Seat, options: { level?: number; last?: { seat: Seat; specs: string[] } } = {}): MatchState {
	const state = createMatch(players, () => 0.5);
	const level = options.level ?? 2;
	state.hand = { ...state.hand, hands: hands.map((hand) => cards(...hand)), turn, level, played: [] };
	if (options.last) {
		const played = cards(...options.last.specs);
		const combo = detectCombos(played, level)[0]!;
		state.hand.lastPlay = { seat: options.last.seat, cards: played, combo };
		state.hand.actions = [null, null, null, null];
		state.hand.actions[options.last.seat] = { kind: "play", cards: played, combo };
	}
	return state;
}

function advise(state: MatchState, seat: Seat) {
	return botAdvice(viewForPlayer(state, players[seat]!.id), players[seat]!.id)!;
}

function playedSpecs(state: MatchState, seat: Seat, action: MatchAction): string[] {
	if (action.type !== "play") return [];
	const hand = state.hand.hands[seat]!;
	return action.cardIds.map((id) => {
		const card = hand.find((candidate) => candidate.id === id)!;
		const rank = ({ 11: "J", 12: "Q", 13: "K", 14: "A", 16: "SJ", 17: "BJ" } as Record<number, string>)[card.rank] ?? String(card.rank);
		return card.suit === "J" ? rank : `${card.suit}${rank}`;
	}).sort();
}

describe("人机只看自己能看到的信息", () => {
	it("输入是 viewForPlayer 之后的状态：换掉别人的手牌，决定不变", () => {
		const state = createMatch(players, () => 0.3);
		const view = viewForPlayer(state, "p0");
		expect("hands" in view.hand).toBe(false);
		expect(JSON.stringify(view)).not.toContain(state.hand.hands[1]![0]!.id + "\"");
		const before = botCommand(view, "p0");
		// 把另外三家的手牌互相换一下
		const shuffled: MatchState = structuredClone(state);
		shuffled.hand.hands = [shuffled.hand.hands[0]!, shuffled.hand.hands[3]!, shuffled.hand.hands[1]!, shuffled.hand.hands[2]!];
		expect(botCommand(viewForPlayer(shuffled, "p0"), "p0")).toEqual(before);
	});

	it("不是自己的视角就不动", () => {
		const state = createMatch(players, () => 0.3);
		expect(botCommand(viewForPlayer(state, "p1"), "p0")).toBeNull();
	});
});

describe("跟牌", () => {
	it("对家出的牌不压", () => {
		const state = setup([["SA", "S3", "D3", "S7", "C9", "HJ", "SQ", "DK"], ["S4"], ["S5", "S6"], ["S8", "S9"]], 0, { last: { seat: 2, specs: ["SK"] } });
		const advice = advise(state, 0);
		expect(advice.action.type).toBe("pass");
		expect(advice.reason).toContain("对家");
	});

	it("对家已经走完：不压，等着接风", () => {
		const state = setup([["SA", "S3"], ["S4", "D4"], [], ["S8", "S9"]], 0, { last: { seat: 2, specs: ["S5"] } });
		expect(advise(state, 0).action.type).toBe("pass");
	});

	it("对手只剩 2 张：拆牌也要压住", () => {
		const state = setup([["SA", "DA", "S3", "D3", "S7", "D7", "S9", "D9", "CJ", "DJ"], ["S4", "D4"], ["S5", "S6", "S8", "C8", "D10", "C10"], ["S8", "C9", "H5", "C5", "D6", "C6"]], 0, { last: { seat: 1, specs: ["SK"] } });
		const advice = advise(state, 0);
		expect(advice.action.type).toBe("play");
		expect(playedSpecs(state, 0, advice.action)).toEqual(["SA"]);
	});

	it("对手只剩 3 张、只有炸弹压得住：炸", () => {
		const state = setup([["S6", "D6", "C6", "H6", "S3", "D4", "S8", "D9", "CJ", "DQ"], ["S4", "D4", "C4"], ["S5", "S7"], ["S8", "C9", "H5"]], 0, { last: { seat: 1, specs: ["SA", "DA"] } });
		const advice = advise(state, 0);
		expect(advice.action.type).toBe("play");
		expect(playedSpecs(state, 0, advice.action)).toEqual(["C6", "D6", "H6", "S6"]);
	});

	it("对手牌还多：不为一对 A 拆炸弹", () => {
		const state = setup([["S6", "D6", "C6", "H6", "S3", "D4", "S8", "D9", "CJ", "DQ"], cards27(), cards27(), cards27()], 0, { last: { seat: 1, specs: ["SA", "DA"] } });
		expect(advise(state, 0).action.type).toBe("pass");
	});

	it("压上去一手打完就压", () => {
		const state = setup([["S9", "S10", "DJ", "CQ", "HK"], cards27(), cards27(), cards27()], 0, { last: { seat: 3, specs: ["S3", "D4", "C5", "H6", "S7"] } });
		const advice = advise(state, 0);
		expect(advice.action.type).toBe("play");
		expect(advice.reason).toContain("一手打完");
	});
});

/** 一手和测试无关的长牌（让对手的张数多一点）。 */
function cards27(): string[] {
	return ["S3", "D3", "C4", "D5", "S7", "C8", "D9", "S10", "CJ", "DQ", "SK", "C3", "D7"];
}

describe("领出", () => {
	it("对家只剩 1 张：送最小的单张", () => {
		const state = setup([["S3", "SK", "DK", "C7", "D7", "HA", "S9", "S10", "CJ"], cards27(), ["S8"], cards27()], 0);
		const advice = advise(state, 0);
		expect(playedSpecs(state, 0, advice.action)).toEqual(["S3"]);
		expect(advice.reason).toContain("对家只剩 1 张");
	});

	it("对手只剩 1 张：不出小单张", () => {
		const state = setup([["S3", "SK", "DK", "C7", "D7"], ["S4"], cards27(), cards27()], 0);
		const advice = advise(state, 0);
		expect(advice.action.type).toBe("play");
		expect(playedSpecs(state, 0, advice.action)).not.toEqual(["S3"]);
	});

	it("只剩一手小牌：先打炸弹以外稳赢的大牌，再走最后一手", () => {
		const state = setup([["BJ", "S3", "D3"], cards27(), cards27(), cards27()], 0);
		state.hand.played = cards("BJ", "SJ", "SJ");
		const advice = advise(state, 0);
		expect(playedSpecs(state, 0, advice.action)).toEqual(["BJ"]);
	});

	it("一手能出完就全出", () => {
		const state = setup([["S3", "D3", "C3", "S5", "D5"], cards27(), cards27(), cards27()], 0);
		const advice = advise(state, 0);
		expect(advice.action.type === "play" && advice.action.cardIds.length).toBe(5);
	});
});

describe("拆牌", () => {
	it("逢人配补顺子", () => {
		const plan = debugPlan(cards("S3", "D4", "C6", "S7", "H2"), 2);
		expect(plan.combos.map((combo) => combo.type)).toEqual(["straight"]);
	});

	it("四张同点留成炸弹，不拆成两对", () => {
		const plan = debugPlan(cards("S8", "D8", "C8", "H8", "S3", "DK"), 2);
		expect(plan.combos.some((combo) => combo.type === "bomb" && combo.size === 4)).toBe(true);
	});

	it("三同张带最小的对子", () => {
		const plan = debugPlan(cards("S9", "D9", "C9", "S4", "D4", "SK", "DK"), 2);
		const full = plan.combos.find((combo) => combo.type === "fullHouse");
		expect(full?.key).toBe(9);
		expect(full?.need.some(([rank]) => rank === 4)).toBe(true);
	});
});

describe("进贡还贡", () => {
	it("进贡交最大的，还贡交 10 以下的", () => {
		const state = createMatch(players, () => 0.5);
		state.phase = "tribute";
		state.hand.hands[3] = cards("SA", "DA", "S3", "S4", "H2");
		state.hand.tribute = { givers: [3], receivers: [0], resisted: false, given: {}, transfers: [], returns: [], leadSeat: null };
		const tribute = advise(state, 3);
		expect(tribute.action.type).toBe("tribute");
		const given = state.hand.hands[3]!.find((card) => tribute.action.type === "tribute" && card.id === tribute.action.cardId)!;
		expect(given.rank).toBe(14);
		let next = applyAction(state, "p3", tribute.action);
		expect(next.phase).toBe("return");
		const back = advise(next, 0);
		expect(back.action.type).toBe("returnTribute");
		const card = next.hand.hands[0]!.find((candidate) => back.action.type === "returnTribute" && candidate.id === back.action.cardId)!;
		expect(card.rank).toBeLessThanOrEqual(10);
		next = applyAction(next, "p0", back.action);
		expect(next.phase).toBe("playing");
	});
});

describe("自对弈", () => {
	it("30 局全部合法、每一步都有理由、不会死循环", () => {
		let seed = 7;
		const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
		for (let game = 0; game < 30; game += 1) {
			let state = createMatch(players, random);
			let steps = 0;
			const start = state.hand.number;
			while (state.phase !== "finished" && state.hand.number < start + 2) {
				let acted = false;
				for (const player of players) {
					const advice = botAdvice(viewForPlayer(state, player.id), player.id);
					if (!advice) continue;
					expect(advice.reason.length).toBeGreaterThan(0);
					state = applyAction(state, player.id, advice.action, random);
					acted = true;
					break;
				}
				expect(acted).toBe(true);
				steps += 1;
				expect(steps).toBeLessThan(3000);
			}
		}
	});
});
