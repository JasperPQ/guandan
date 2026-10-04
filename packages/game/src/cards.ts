export type Suit = "S" | "H" | "C" | "D" | "J";

/** 点数：2–14（11=J、12=Q、13=K、14=A），16=小王，17=大王。 */
export interface Card {
	readonly id: string;
	readonly suit: Suit;
	readonly rank: number;
}

export const SMALL_JOKER = 16;
export const BIG_JOKER = 17;
export const LEVEL_SLOT = 15;
export const NATURAL_RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

const SUITS: Suit[] = ["S", "H", "C", "D"];

export function createDeck(): Card[] {
	const cards: Card[] = [];
	for (const deck of [0, 1]) {
		for (const suit of SUITS) {
			for (const rank of NATURAL_RANKS) cards.push({ id: `${deck}${suit}${rank}`, suit, rank });
		}
		cards.push({ id: `${deck}J${SMALL_JOKER}`, suit: "J", rank: SMALL_JOKER });
		cards.push({ id: `${deck}J${BIG_JOKER}`, suit: "J", rank: BIG_JOKER });
	}
	return cards;
}

export function shuffle<T>(items: readonly T[], random: () => number): T[] {
	const result = [...items];
	for (let index = result.length - 1; index > 0; index -= 1) {
		const swap = Math.floor(random() * (index + 1));
		[result[index], result[swap]] = [result[swap]!, result[index]!];
	}
	return result;
}

export function isJoker(card: Card): boolean {
	return card.suit === "J";
}

/** 逢人配：红桃级牌。 */
export function isWild(card: Card, level: number): boolean {
	return card.suit === "H" && card.rank === level;
}

/** 单张大小：级牌提到 A 之上。 */
export function singleValue(rank: number, level: number): number {
	return rank === level ? LEVEL_SLOT : rank;
}

/** 手牌排序：从小到大，同点数按花色。 */
export function sortCards(cards: readonly Card[], level: number): Card[] {
	const suitOrder: Record<Suit, number> = { D: 0, C: 1, H: 2, S: 3, J: 4 };
	return [...cards].sort((left, right) =>
		singleValue(left.rank, level) - singleValue(right.rank, level)
		|| suitOrder[left.suit] - suitOrder[right.suit]
		|| left.id.localeCompare(right.id));
}

export function rankLabel(rank: number): string {
	if (rank === BIG_JOKER) return "大王";
	if (rank === SMALL_JOKER) return "小王";
	return ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[rank] ?? String(rank);
}
