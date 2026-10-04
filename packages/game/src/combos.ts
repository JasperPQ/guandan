import { BIG_JOKER, SMALL_JOKER, isJoker, isWild, rankLabel, singleValue, type Card } from "./cards.js";

export type ComboType =
	| "single"
	| "pair"
	| "triple"
	| "fullHouse"
	| "straight"
	| "tube"
	| "plate"
	| "bomb"
	| "straightFlush"
	| "jokerBomb";

/** key：同牌型之间比较用的值。成组牌型用单张大小；连续牌型用最大一张的原本点数。 */
export interface Combo {
	readonly type: ComboType;
	readonly size: number;
	readonly key: number;
}

export const COMBO_NAMES: Record<ComboType, string> = {
	single: "单张",
	pair: "对子",
	triple: "三同张",
	fullHouse: "三带二",
	straight: "顺子",
	tube: "三连对",
	plate: "钢板",
	bomb: "炸弹",
	straightFlush: "同花顺",
	jokerBomb: "天王炸",
};

/** 炸弹威力：0 表示不是炸弹。 */
export function bombPower(combo: Combo): number {
	if (combo.type === "jokerBomb") return 1000;
	if (combo.type === "straightFlush") return 55;
	if (combo.type === "bomb") return combo.size * 10;
	return 0;
}

export function beats(next: Combo, current: Combo | null): boolean {
	if (!current) return true;
	const nextPower = bombPower(next);
	const currentPower = bombPower(current);
	if (nextPower > 0 || currentPower > 0) {
		if (nextPower !== currentPower) return nextPower > currentPower;
		return next.key > current.key;
	}
	return next.type === current.type && next.size === current.size && next.key > current.key;
}

export function sameCombo(left: Combo, right: Combo): boolean {
	return left.type === right.type && left.size === right.size && left.key === right.key;
}

/** 连续牌型中的位置 1 表示作 1 用的 A。 */
function sequenceRank(position: number): number {
	return position === 1 ? 14 : position;
}

function countRanks(cards: readonly Card[]): Map<number, number> {
	const counts = new Map<number, number>();
	for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
	return counts;
}

/** 检查自然牌能否用 wilds 张逢人配补成「从 low 开始 length 个连续点数、每个点数 width 张」。 */
function fitsSequence(counts: Map<number, number>, naturalCount: number, wilds: number, low: number, length: number, width: number): boolean {
	const ranks = Array.from({ length }, (_, offset) => sequenceRank(low + offset));
	for (const [rank, count] of counts) {
		if (!ranks.includes(rank) || count > width) return false;
	}
	return length * width - naturalCount === wilds;
}

/** 列出一组牌所有可能的牌型解释（已去重）。 */
export function detectCombos(cards: readonly Card[], level: number): Combo[] {
	const results: Combo[] = [];
	const add = (combo: Combo) => {
		if (!results.some((existing) => sameCombo(existing, combo))) results.push(combo);
	};
	const size = cards.length;
	if (size === 0) return results;

	const naturals = cards.filter((card) => !isWild(card, level));
	const wilds = size - naturals.length;
	const counts = countRanks(naturals);
	const hasJoker = naturals.some(isJoker);

	if (size === 4 && counts.get(SMALL_JOKER) === 2 && counts.get(BIG_JOKER) === 2) {
		add({ type: "jokerBomb", size, key: BIG_JOKER });
	}

	// 同点数：单张、对子、三同张、炸弹。逢人配不能配王。
	if (counts.size <= 1) {
		const rank = naturals[0]?.rank ?? level;
		const jokerRank = rank === SMALL_JOKER || rank === BIG_JOKER;
		if (!jokerRank || (wilds === 0 && size <= 2)) {
			const type = size === 1 ? "single" : size === 2 ? "pair" : size === 3 ? "triple" : "bomb";
			if (size <= 10) add({ type, size, key: singleValue(rank, level) });
		}
	}

	if (size === 5) {
		for (let triple = 2; triple <= 14; triple += 1) {
			for (const pair of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, SMALL_JOKER, BIG_JOKER]) {
				if (pair === triple) continue;
				const tripleCount = counts.get(triple) ?? 0;
				const pairCount = counts.get(pair) ?? 0;
				if (tripleCount + pairCount !== naturals.length || tripleCount > 3 || pairCount > 2) continue;
				if (pair >= SMALL_JOKER && pairCount !== 2) continue;
				if ((3 - tripleCount) + (2 - pairCount) === wilds) add({ type: "fullHouse", size, key: singleValue(triple, level) });
			}
		}
		if (!hasJoker) {
			const flush = naturals.every((card) => card.suit === naturals[0]?.suit);
			for (let low = 1; low <= 10; low += 1) {
				if (!fitsSequence(counts, naturals.length, wilds, low, 5, 1)) continue;
				add({ type: "straight", size, key: low + 4 });
				if (flush) add({ type: "straightFlush", size, key: low + 4 });
			}
		}
	}

	if (size === 6 && !hasJoker) {
		for (let low = 1; low <= 12; low += 1) {
			if (fitsSequence(counts, naturals.length, wilds, low, 3, 2)) add({ type: "tube", size, key: low + 2 });
		}
		for (let low = 1; low <= 13; low += 1) {
			if (fitsSequence(counts, naturals.length, wilds, low, 2, 3)) add({ type: "plate", size, key: low + 1 });
		}
	}

	return results;
}

/** 牌型的简短描述，例如「对子 K」「6 张炸弹 9」「顺子 10–A」。 */
export function describeCombo(combo: Combo, level: number): string {
	const keyRank = combo.key === 15 ? level : combo.key;
	switch (combo.type) {
		case "straight":
		case "straightFlush":
			return `${COMBO_NAMES[combo.type]} ${rankLabel(sequenceRank(combo.key - 4))}–${rankLabel(combo.key)}`;
		case "tube":
			return `三连对 ${rankLabel(sequenceRank(combo.key - 2))}–${rankLabel(combo.key)}`;
		case "plate":
			return `钢板 ${rankLabel(sequenceRank(combo.key - 1))}–${rankLabel(combo.key)}`;
		case "bomb":
			return `${combo.size} 张炸弹 ${rankLabel(keyRank)}`;
		case "jokerBomb":
			return "天王炸";
		default:
			return `${COMBO_NAMES[combo.type]} ${rankLabel(keyRank)}`;
	}
}
