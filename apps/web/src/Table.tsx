import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  beats,
  describeCombo,
  detectCombos,
  rankLabel,
  returnCandidates,
  tributeCandidates,
  type Card,
  type Combo,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type MatchAction,
  type MatchView,
  type Seat,
  type SeatAction,
} from "@guandan/game";
import CardView, { cardName, preloadCardImages } from "./CardView.js";
import GameRules from "./GameRules.js";

const PLACE_NAMES = ["头游", "二游", "三游", "末游"];
type Position = "bottom" | "right" | "top" | "left";
const POSITIONS: Position[] = ["bottom", "right", "top", "left"];

function seatAt(mySeat: Seat, position: Position): Seat {
  return ((mySeat + POSITIONS.indexOf(position)) % 4) as Seat;
}

function levelText(level: number): string {
  return rankLabel(level);
}

/** 手牌横向叠放，宽度不够时自动收紧间距。 */
function HandRow({ cards, level, selected, eligible, onToggle }: {
  cards: Card[];
  level: number;
  selected: Set<string>;
  eligible: Set<string> | null;
  onToggle: (cardId: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(40);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      const cardWidth = row.querySelector<HTMLElement>(".card")?.offsetWidth ?? 64;
      const available = row.clientWidth - cardWidth;
      setStep(cards.length > 1 ? Math.min(cardWidth + 4, available / (cards.length - 1)) : cardWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [cards.length]);

  return (
    <div className="hand-row" ref={rowRef}>
      <div className="hand-cards">
        {cards.map((card, index) => (
          <div className="hand-slot" key={card.id} style={index === 0 ? undefined : { marginLeft: `calc(${step}px - var(--card-w))` }}>
            <CardView
              card={card}
              level={level}
              selected={selected.has(card.id)}
              dimmed={eligible !== null && !eligible.has(card.id)}
              onClick={() => onToggle(card.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionDisplay({ action, level }: { action: SeatAction | null; level: number }) {
  if (!action) return null;
  if (action.kind === "pass") return <span className="pass-tag">不出</span>;
  return (
    <div className="played">
      <div className="played-cards">
        {action.cards.map((card) => <CardView card={card} level={level} small key={card.id} />)}
      </div>
      <span className="played-label">{describeCombo(action.combo, level)}</span>
    </div>
  );
}

function SeatPlate({ seat, match, member, position }: {
  seat: Seat;
  match: MatchView;
  member: LobbyMember | undefined;
  position: Position;
}) {
  const player = match.players[seat]!;
  const place = match.hand.finishOrder.indexOf(seat);
  const active = match.phase === "playing" && match.hand.turn === seat;
  const partner = match.mySeat !== null && (seat + 2) % 4 === match.mySeat;
  const count = match.hand.cardCounts[seat] ?? 0;
  return (
    <div className={`seat-plate seat-${position}${active ? " seat-active" : ""}${member?.connected === false ? " seat-offline" : ""}`}>
      <span className={`team-dot team-${seat % 2}`} aria-hidden="true" />
      <strong>{player.name}</strong>
      {partner && <span className="seat-tag">队友</span>}
      {member?.connected === false && <span className="seat-tag offline">离线</span>}
      {place >= 0
        ? <span className="seat-place">{PLACE_NAMES[place]}</span>
        : <span className={`seat-count${count <= 10 ? " warn" : ""}`} title={`剩 ${count} 张`}>{count}</span>}
    </div>
  );
}

function Table({
  room,
  busy,
  error,
  notice,
  brand,
  connection,
  chat,
  onAction,
  onRematch,
  onDissolve,
}: {
  room: LobbyRoomSnapshot;
  busy: boolean;
  error: string;
  notice: string;
  brand: ReactNode;
  connection: ReactNode;
  chat: ReactNode;
  onAction: (action: MatchAction) => void;
  onRematch: (accept: boolean) => void;
  onDissolve: () => void;
}) {
  useEffect(preloadCardImages, []);
  const match = room.match!;
  const hand = match.hand;
  const mySeat = match.mySeat ?? 0;
  const myTeam = mySeat % 2;
  const level = hand.level;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const isHost = room.members.find((member) => member.id === match.players[mySeat]?.id)?.isHost ?? false;
  const rematch = room.rematch;
  const [rematchDeadline, setRematchDeadline] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!rematch) return;
    setRematchDeadline(Date.now() + rematch.remainingMs);
    setNow(Date.now());
  }, [rematch?.remainingMs]);
  useEffect(() => {
    if (!rematch) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [Boolean(rematch)]);
  const secondsLeft = Math.max(0, Math.ceil((rematchDeadline - now) / 1000));
  const accepted = new Set(rematch?.acceptedIds ?? []);
  const myId = match.players[mySeat]?.id ?? "";

  // 换回合、换阶段或手牌变化时，丢掉已不在手里的选择。
  useEffect(() => {
    setSelected((current) => new Set([...current].filter((cardId) => hand.myCards.some((card) => card.id === cardId))));
  }, [hand.myCards]);
  useEffect(() => setSelected(new Set()), [match.phase, hand.number]);

  const selectedCards = useMemo(() => hand.myCards.filter((card) => selected.has(card.id)), [hand.myCards, selected]);
  const readings = useMemo(() => detectCombos(selectedCards, level), [selectedCards, level]);
  const legal = readings.filter((combo) => beats(combo, hand.lastPlay?.combo ?? null));

  const myTurn = match.phase === "playing" && hand.turn === mySeat;
  const tribute = hand.tribute;
  const mustTribute = match.phase === "tribute" && tribute?.givers.includes(mySeat) && !tribute.givenSeats.includes(mySeat);
  const myTransfer = tribute?.transfers.find((transfer) => transfer.to === mySeat);
  const mustReturn = match.phase === "return" && myTransfer && !tribute?.returns.some((transfer) => transfer.from === mySeat);
  const eligible = mustTribute
    ? new Set(tributeCandidates(hand.myCards, level).map((card) => card.id))
    : mustReturn ? new Set(returnCandidates(hand.myCards).map((card) => card.id)) : null;

  function toggle(cardId: string) {
    if (eligible) {
      if (!eligible.has(cardId)) return;
      setSelected((current) => (current.has(cardId) ? new Set() : new Set([cardId])));
      return;
    }
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function play(combo?: Combo) {
    onAction({ type: "play", cardIds: [...selected], ...(combo ? { combo } : {}) });
  }

  const name = (seat: Seat) => match.players[seat]?.name ?? "";
  const turnText = match.phase === "finished" ? "整场结束"
    : match.phase === "handOver" ? "本局结束"
    : match.phase === "tribute" ? "进贡中"
    : match.phase === "return" ? "还贡中"
    : myTurn ? (hand.lastPlay ? "轮到你出牌" : "轮到你领出")
    : `等待 ${name(hand.turn)}`;

  const selectionHint = selectedCards.length === 0 ? ""
    : readings.length === 0 ? "不是有效牌型"
    : legal.length === 0 ? "压不过上家"
    : legal.map((combo) => describeCombo(combo, level)).join(" / ");

  const tributeSummary = tribute && (tribute.resisted
    ? "抗贡：进贡方有两张大王，本局不进贡。"
    : [
      ...tribute.transfers.map((transfer) => `${name(transfer.from)} 进贡 ${cardName(transfer.card)} 给 ${name(transfer.to)}`),
      ...tribute.returns.map((transfer) => `${name(transfer.from)} 还 ${cardName(transfer.card)}`),
    ].join("；"));
  const handStarted = hand.actions.some(Boolean) || hand.finishOrder.length > 0;

  return (
    <div className="game-screen">
      <header className="game-topbar">
        {brand}
        <span className="room-code-chip" title="房间码">{room.code}</span>
        <span className="level-chip" title="本局打的级数">本局打 <b>{levelText(level)}</b></span>
        <span className="team-levels">
          <span><span className={`team-dot team-${myTeam}`} />我方 {levelText(match.teamLevels[myTeam]!)}</span>
          <span><span className={`team-dot team-${1 - myTeam}`} />对方 {levelText(match.teamLevels[1 - myTeam]!)}</span>
        </span>
        <span className={myTurn || mustTribute || mustReturn ? "turn-indicator my-turn" : "turn-indicator"}>
          <span className="turn-dot" />{turnText}
        </span>
        <span className="topbar-feedback" role="status">{error ? <span className="error-text">{error}</span> : notice}</span>
        <GameRules />
        {isHost && <button type="button" className="dissolve-button" onClick={onDissolve}>解散房间</button>}
        {connection}
      </header>

      <section className="felt" aria-label="牌桌">
        {(["top", "left", "right"] as Position[]).map((position) => {
          const seat = seatAt(mySeat, position);
          return (
            <div className={`felt-seat felt-${position}`} key={position}>
              <SeatPlate seat={seat} match={match} member={room.members.find((member) => member.id === match.players[seat]?.id)} position={position} />
              <div className="felt-action"><ActionDisplay action={hand.actions[seat] ?? null} level={level} /></div>
            </div>
          );
        })}
        <div className="felt-seat felt-bottom">
          <div className="felt-action"><ActionDisplay action={hand.actions[mySeat] ?? null} level={level} /></div>
        </div>
        {tributeSummary && !handStarted && <p className="tribute-note">{tributeSummary}</p>}
      </section>

      <section className={`my-area${myTurn || mustTribute || mustReturn ? " my-area-active" : ""}`} aria-label="你的手牌">
        <div className="my-bar">
          <SeatPlate seat={mySeat} match={match} member={room.members.find((member) => member.id === match.players[mySeat]?.id)} position="bottom" />
          <span className="selection-hint">{eligible ? (mustTribute ? "请选择一张最大的牌进贡" : "请选择一张 10 以下的牌还贡") : selectionHint}</span>
          <div className="my-actions">
            {mustTribute && (
              <button type="button" className="primary-button" disabled={busy || selected.size !== 1} onClick={() => onAction({ type: "tribute", cardId: [...selected][0]! })}>进贡</button>
            )}
            {mustReturn && (
              <button type="button" className="primary-button" disabled={busy || selected.size !== 1} onClick={() => onAction({ type: "returnTribute", cardId: [...selected][0]! })}>还贡</button>
            )}
            {match.phase === "playing" && (
              <>
                <button type="button" className="quiet-button" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>重选</button>
                <button type="button" className="quiet-button" disabled={!myTurn || busy || !hand.lastPlay} onClick={() => onAction({ type: "pass" })}>不出</button>
                {legal.length > 1 ? legal.map((combo) => (
                  <button type="button" className="primary-button" key={`${combo.type}-${combo.key}`} disabled={!myTurn || busy} onClick={() => play(combo)}>
                    出 {describeCombo(combo, level)}
                  </button>
                )) : (
                  <button type="button" className="primary-button" disabled={!myTurn || busy || legal.length !== 1} onClick={() => play()}>出牌</button>
                )}
              </>
            )}
          </div>
        </div>
        <HandRow cards={hand.myCards} level={level} selected={selected} eligible={eligible} onToggle={toggle} />
      </section>

      <div className="chat-area">{chat}</div>

      {((match.phase === "handOver" && match.lastResult) || match.phase === "finished") && (
        <div className="modal-backdrop">
          <section className="result-panel" role="dialog" aria-modal="true" aria-labelledby="result-title">
            <h2 id="result-title">
              {match.phase === "finished"
                ? (match.winnerTeam === myTeam ? "我们赢了整场！" : "对方赢下了整场")
                : (match.lastResult?.winnerTeam === myTeam ? `我方升 ${match.lastResult?.upgrade} 级` : `对方升 ${match.lastResult?.upgrade} 级`)}
            </h2>
            <ol className="result-order">
              {(match.lastResult?.finishOrder ?? []).map((seat, index) => (
                <li key={seat}>
                  <span className="result-place">{PLACE_NAMES[index]}</span>
                  <span className={`team-dot team-${seat % 2}`} />
                  {name(seat)}{seat === mySeat ? "（你）" : ""}
                </li>
              ))}
            </ol>
            {match.phase === "handOver" && match.lastResult && (
              <>
                <p className="result-levels">
                  我方打 {levelText(match.teamLevels[myTeam]!)} · 对方打 {levelText(match.teamLevels[1 - myTeam]!)}
                  {match.lastResult.aReset !== null && <><br />{match.lastResult.aReset === myTeam ? "我方" : "对方"}打 A 三次未过，退回 2。</>}
                  {match.lastResult.aFailed !== null && match.lastResult.aReset === null && <><br />{match.lastResult.aFailed === myTeam ? "我方" : "对方"}本局未能过 A。</>}
                </p>
                <div className="ready-row">
                  {match.players.map((player, seat) => (
                    <span className={match.ready[seat] ? "ready-chip ready" : "ready-chip"} key={player.id}>{player.name}{match.ready[seat] ? " ✓" : ""}</span>
                  ))}
                </div>
                <button type="button" className="primary-button" disabled={busy || match.ready[mySeat]} onClick={() => onAction({ type: "ready" })}>
                  {match.ready[mySeat] ? "等待其他玩家准备" : "准备下一局"}
                </button>
              </>
            )}
            {match.phase === "finished" && rematch && (
              <>
                <p className="result-levels">再来一场？{secondsLeft} 秒内未确认视为退出，退出的玩家会被移出房间。</p>
                <div className="ready-row">
                  {room.members.map((member) => (
                    <span className={accepted.has(member.id) ? "ready-chip ready" : "ready-chip"} key={member.id}>
                      {member.name}{accepted.has(member.id) ? " ✓" : ""}
                    </span>
                  ))}
                </div>
                <div className="result-actions">
                  <button type="button" className="quiet-button" onClick={() => onRematch(false)}>退出房间</button>
                  <button type="button" className="primary-button" disabled={accepted.has(myId)} onClick={() => onRematch(true)}>
                    {accepted.has(myId) ? "等待其他玩家" : "再来一场"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default Table;
