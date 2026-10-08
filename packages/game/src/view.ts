import type { Card } from "./cards.js";
import type { HandState, MatchState, Seat, TributeState } from "./match.js";

export interface HandView extends Omit<HandState, "hands" | "tribute"> {
	myCards: Card[];
	/** 只发给打开了「观战看手牌」的观战者：四个座位各自的手牌。 */
	allCards?: Card[][];
	cardCounts: number[];
	tribute: TributeView | null;
}

export interface TributeView extends Omit<TributeState, "given"> {
	/** 已经交出贡牌的座位；牌面只有本人可见。 */
	givenSeats: Seat[];
	myGiven: Card | null;
}

export interface MatchView extends Omit<MatchState, "hand"> {
	mySeat: Seat | null;
	hand: HandView;
}

/** 只给某位玩家看的对局视图：隐藏其他人的手牌、未公开的贡牌和与他无关的还贡。 */
export function viewForPlayer(state: MatchState, playerId: string): MatchView {
	const index = state.players.findIndex((player) => player.id === playerId);
	const mySeat = index < 0 ? null : (index as Seat);
	const { hands, tribute, ...hand } = state.hand;
	return {
		...structuredClone({ ...state, hand: undefined }),
		mySeat,
		hand: {
			...structuredClone(hand),
			myCards: mySeat === null ? [] : structuredClone(hands[mySeat]!),
			cardCounts: hands.map((cards) => cards.length),
			tribute: tribute ? {
				givers: [...tribute.givers],
				receivers: [...tribute.receivers],
				resisted: tribute.resisted,
				transfers: structuredClone(tribute.transfers),
				returns: tribute.returns
					.filter((transfer) => transfer.from === mySeat || transfer.to === mySeat)
					.map((transfer) => ({ ...transfer })),
				leadSeat: tribute.leadSeat,
				givenSeats: (Object.keys(tribute.given).map(Number) as Seat[]),
				myGiven: mySeat === null ? null : tribute.given[mySeat] ?? null,
			} : null,
		},
	};
}
