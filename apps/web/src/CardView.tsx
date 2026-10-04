import { isWild, rankLabel, type Card } from "@guandan/game";

const suitSymbols: Record<Card["suit"], string> = { S: "♠", H: "♥", C: "♣", D: "♦", J: "" };

export function cardName(card: Card): string {
  if (card.suit === "J") return rankLabel(card.rank);
  return `${{ S: "黑桃", H: "红桃", C: "梅花", D: "方块" }[card.suit]}${rankLabel(card.rank)}`;
}

/** 一张扑克牌。逢人配带金边和「配」角标，级牌带金色小点。 */
function CardView({
  card,
  level,
  selected = false,
  dimmed = false,
  small = false,
  onClick,
}: {
  card: Card;
  level: number;
  selected?: boolean;
  dimmed?: boolean;
  small?: boolean;
  onClick?: () => void;
}) {
  const red = card.suit === "H" || card.suit === "D" || card.rank === 17;
  const joker = card.suit === "J";
  const wild = isWild(card, level);
  const className = [
    "card",
    red ? "card-red" : "",
    joker ? "card-joker" : "",
    wild ? "card-wild" : "",
    !joker && card.rank === level ? "card-level" : "",
    selected ? "card-selected" : "",
    dimmed ? "card-dimmed" : "",
    small ? "card-small" : "",
  ].filter(Boolean).join(" ");
  const label = `${cardName(card)}${wild ? "（逢人配）" : !joker && card.rank === level ? "（级牌）" : ""}`;
  const face = joker ? (
    <span className="card-joker-text">JOKER</span>
  ) : (
    <span className="card-corner">
      <b>{rankLabel(card.rank)}</b>
      <i>{suitSymbols[card.suit]}</i>
    </span>
  );
  const extras = (
    <>
      {!joker && <span className="card-pip" aria-hidden="true">{suitSymbols[card.suit]}</span>}
      {wild && <span className="card-wild-badge" aria-hidden="true">配</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={className} onClick={onClick} title={label} aria-label={label} aria-pressed={selected}>
      {face}{extras}
    </button>
  ) : (
    <span className={className} title={label} role="img" aria-label={label}>{face}{extras}</span>
  );
}

export default CardView;
