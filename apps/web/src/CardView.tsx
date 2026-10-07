import { isWild, rankLabel, type Card } from "@guandan/game";
import { usePixel } from "./pixel.js";

const SUIT_SYMBOLS: Record<Card["suit"], string> = { S: "♠", H: "♥", C: "♣", D: "♦", J: "" };

export function cardName(card: Card): string {
  if (card.suit === "J") return rankLabel(card.rank);
  return `${{ S: "黑桃", H: "红桃", C: "梅花", D: "方块" }[card.suit]}${rankLabel(card.rank)}`;
}

const CARD_IMAGE_BASE = `${import.meta.env.BASE_URL}cards/`;
/** 像素版牌面（art/cards.py 画的 PNG），文件名和 SVG 一一对应。 */
const PIXEL_CARD_BASE = `${import.meta.env.BASE_URL}cards-pixel/`;

/** 牌面图片：例如黑桃 A 为 Sa.svg、红桃 10 为 H10.svg；大王 J1（彩色）、小王 J2（黑白）。 */
export function cardImage(card: Card, pixel = false): string {
  const base = pixel ? PIXEL_CARD_BASE : CARD_IMAGE_BASE;
  const ext = pixel ? "png" : "svg";
  if (card.suit === "J") return `${base}${card.rank === 17 ? "J1" : "J2"}.${ext}`;
  const rank = ({ 11: "j", 12: "q", 13: "k", 14: "a" } as Record<number, string>)[card.rank] ?? String(card.rank);
  return `${base}${card.suit}${rank}.${ext}`;
}

/** 提前加载整副牌面（当前画面风格的那一套），避免发牌时图片一张张冒出来。 */
export function preloadCardImages(pixel = false): void {
  for (const suit of ["S", "H", "D", "C"] as const) {
    for (let rank = 2; rank <= 14; rank += 1) new Image().src = cardImage({ id: "", suit, rank }, pixel);
  }
  for (const rank of [16, 17]) new Image().src = cardImage({ id: "", suit: "J", rank }, pixel);
}

/**
 * 一张扑克牌：经典牌面图片。逢人配带金边和「配」角标，级牌带金色细边；王牌左上角竖写 JOKER。
 * 像素版换成像素牌面图：角标和 JOKER 字样已经画在图里，不再叠加。
 */
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
  const pixel = usePixel();
  const joker = card.suit === "J";
  const wild = isWild(card, level);
  const className = [
    "card",
    joker ? `card-joker${card.rank === 17 ? " card-red" : ""}` : "",
    wild ? "card-wild" : "",
    !joker && card.rank === level ? "card-level" : "",
    selected ? "card-selected" : "",
    dimmed ? "card-dimmed" : "",
    small ? "card-small" : "",
  ].filter(Boolean).join(" ");
  const label = `${cardName(card)}${wild ? "（逢人配）" : !joker && card.rank === level ? "（级牌）" : ""}`;
  const content = pixel ? (
    <>
      <img src={cardImage(card, true)} alt="" draggable={false} />
      {wild && <span className="card-wild-badge" aria-hidden="true">配</span>}
    </>
  ) : (
    <>
      <img src={cardImage(card)} alt="" draggable={false} />
      {joker ? <span className="card-joker-text" aria-hidden="true">JOKER</span> : (
        // 加大的角标：手牌叠放时主要露出左上角，原图的角标太小。
        <span className={`card-index${card.suit === "H" || card.suit === "D" ? " red" : ""}`} aria-hidden="true">
          <b>{rankLabel(card.rank)}</b><i>{SUIT_SYMBOLS[card.suit]}</i>
        </span>
      )}
      {wild && <span className="card-wild-badge" aria-hidden="true">配</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={className} onClick={onClick} title={label} aria-label={label} aria-pressed={selected}>
      {content}
    </button>
  ) : (
    <span className={className} title={label} role="img" aria-label={label}>{content}</span>
  );
}

export default CardView;
