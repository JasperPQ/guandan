import { describe, expect, it } from "vitest";
import { beats, detectCombos, type Card, type Combo } from "../src/index.js";

let serial = 0;
/** "S5" 黑桃 5、"HA" 红桃 A、"SJ" 小王、"BJ" 大王。 */
function cards(...specs: string[]): Card[] {
	return specs.map((spec) => {
		serial += 1;
		if (spec === "SJ") return { id: `t${serial}`, suit: "J", rank: 16 };
		if (spec === "BJ") return { id: `t${serial}`, suit: "J", rank: 17 };
		const rankText = spec.slice(1);
		const rank = ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[rankText] ?? Number(rankText);
		return { id: `t${serial}`, suit: spec[0] as Card["suit"], rank };
	});
}

function types(specs: string[], level = 2): string[] {
	return detectCombos(cards(...specs), level).map((combo) => `${combo.type}:${combo.key}`).sort();
}

describe("detectCombos", () => {
	it("recognises same-rank groups and joker pairs", () => {
		expect(types(["S9"])).toEqual(["single:9"]);
		expect(types(["S9", "D9"])).toEqual(["pair:9"]);
		expect(types(["S9", "D9", "C9"])).toEqual(["triple:9"]);
		expect(types(["S9", "D9", "C9", "H9", "S9"])).toEqual(["bomb:9"]);
		expect(types(["BJ", "BJ"])).toEqual(["pair:17"]);
		expect(types(["BJ", "SJ"])).toEqual([]);
	});

	it("ranks the level card above aces", () => {
		expect(types(["S7"], 7)).toEqual(["single:15"]);
		const levelPair = detectCombos(cards("S7", "D7"), 7)[0]!;
		const acePair = detectCombos(cards("SA", "DA"), 7)[0]!;
		expect(beats(levelPair, acePair)).toBe(true);
	});

	it("recognises full house, straights, tubes and plates", () => {
		expect(types(["S3", "D3", "C3", "S8", "D8"])).toEqual(["fullHouse:3"]);
		expect(types(["S3", "D3", "C3", "S8", "D9"])).toEqual([]);
		expect(types(["SA", "D2", "C3", "S4", "D5"])).toEqual(["straight:5"]);
		expect(types(["S10", "DJ", "CQ", "SK", "DA"])).toEqual(["straight:14"]);
		expect(types(["SQ", "DK", "CA", "S2", "D3"])).toEqual([]);
		expect(types(["S3", "D4", "C5", "S6", "D7", "C8"])).toEqual([]);
		expect(types(["S3", "D3", "C4", "S4", "D5", "C5"])).toEqual(["tube:5"]);
		expect(types(["SA", "DA", "C2", "S2", "D3", "C3"])).toEqual(["tube:3"]);
		expect(types(["SK", "DK", "CK", "SA", "DA", "CA"])).toEqual(["plate:14"]);
		expect(types(["SA", "DA", "CA", "S2", "D2", "C2"])).toEqual(["plate:2"]);
	});

	it("uses the natural rank of level cards inside sequences", () => {
		expect(types(["S3", "D4", "C5", "S6", "D7"], 5)).toEqual(["straight:7"]);
	});

	it("recognises straight flushes and joker bombs", () => {
		expect(types(["S5", "S6", "S7", "S8", "S9"])).toEqual(["straight:9", "straightFlush:9"]);
		expect(types(["SJ", "SJ", "BJ", "BJ"])).toEqual(["jokerBomb:17"]);
	});

	it("lets the red-heart level card stand in for any non-joker", () => {
		// 打 5：红桃 5 是逢人配。
		expect(types(["H5", "S9", "D9"], 5)).toEqual(["triple:9"]);
		expect(types(["H5", "S3", "D4", "C6", "S7"], 5)).toEqual(["straight:7"]);
		expect(types(["H5", "S4", "D5", "C6", "S7"], 5)).toEqual(["straight:7", "straight:8"]);
		expect(types(["H5", "S9", "S10", "S11", "SQ"], 5)).toEqual(["straight:12", "straight:13", "straightFlush:12", "straightFlush:13"]);
		expect(types(["H5", "H5", "S9", "D9"], 5)).toEqual(["bomb:9"]);
		expect(types(["H5", "BJ"], 5)).toEqual([]);
		expect(types(["H5"], 5)).toEqual(["single:15"]);
		expect(types(["H5", "H5"], 5)).toEqual(["pair:15"]);
		expect(types(["H5", "S8", "D8", "C3", "S3"], 5)).toEqual(["fullHouse:3", "fullHouse:8"]);
	});
});

describe("beats", () => {
	const combo = (type: Combo["type"], size: number, key: number): Combo => ({ type, size, key });

	it("orders bombs by size with the straight flush between five and six", () => {
		const ladder = [
			combo("bomb", 4, 14),
			combo("bomb", 5, 3),
			combo("straightFlush", 5, 6),
			combo("bomb", 6, 3),
			combo("bomb", 8, 3),
			combo("bomb", 10, 3),
			combo("jokerBomb", 4, 17),
		];
		for (let index = 1; index < ladder.length; index += 1) {
			expect(beats(ladder[index]!, ladder[index - 1]!)).toBe(true);
			expect(beats(ladder[index - 1]!, ladder[index]!)).toBe(false);
		}
	});

	it("only lets the same type and size beat non-bombs", () => {
		expect(beats(combo("pair", 2, 9), combo("pair", 2, 8))).toBe(true);
		expect(beats(combo("pair", 2, 8), combo("pair", 2, 8))).toBe(false);
		expect(beats(combo("triple", 3, 14), combo("pair", 2, 3))).toBe(false);
		expect(beats(combo("bomb", 4, 2), combo("straight", 5, 14))).toBe(true);
		expect(beats(combo("straight", 5, 6), combo("straight", 5, 5))).toBe(true);
	});
});
