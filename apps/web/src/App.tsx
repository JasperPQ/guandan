import { useEffect, useMemo, useState, type FormEvent } from "react";
import { rankLabel, type AckResponse, type LobbyRoomSnapshot, type MatchAction, type PublicRoomSummary, type Seat } from "@guandan/game";
import AdminBar, { adminEntryEnabled, useAdminToken } from "./AdminBar.js";
import GameRules from "./GameRules.js";
import RoomChat from "./RoomChat.js";
import Table from "./Table.js";
import { socket } from "./socket.js";
import { useVoice } from "./voice.js";

type EntryMode = "create" | "join";
const validRoomCode = /^[A-HJ-NP-Z2-9]{6}$/;

// 线上游戏中心在站点根路径；本地开发时跑在 5175 端口。
const CENTER_URL = import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:5175/` : "/";

function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
}

function Brand() {
  return (
    <a className="brand" href={import.meta.env.BASE_URL} aria-label="掼蛋首页">
      <span className="brand-mark" aria-hidden="true">♠</span>
      <span className="brand-name">掼蛋</span>
    </a>
  );
}

function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <div className={connected ? "connection-status online" : "connection-status"}>
      <span className="connection-dot" />
      {connected ? "已连接" : "连接中…"}
    </div>
  );
}

const SEAT_POSITIONS = ["seat-pos-bottom", "seat-pos-right", "seat-pos-top", "seat-pos-left"];

function WaitingRoom({ room, busy, onSit, onStart, onLeave, onCopy, onKick, onDissolve }: {
  room: LobbyRoomSnapshot;
  busy: boolean;
  onSit: (seat: Seat) => void;
  onStart: () => void;
  onLeave: () => void;
  onCopy: () => void;
  onKick: (memberId: string) => void;
  onDissolve: () => void;
}) {
  const me = room.members.find((member) => member.id === socket.id);
  const seatedCount = room.members.filter((member) => member.seat !== null).length;
  return (
    <section className="waiting">
      <div className="waiting-head">
        <div>
          <div className="eyebrow">等待大厅</div>
          <h1>选好座位，对家就是队友。</h1>
        </div>
        <button type="button" className="room-code-button" onClick={onCopy} title="点击复制房间码">
          <span>房间码</span><strong>{room.code}</strong>
        </button>
      </div>
      <div className="seat-table">
        <div className="seat-table-felt">
          <span className="seat-table-note">A 队：座位 1、3 · B 队：座位 2、4</span>
        </div>
        {([0, 1, 2, 3] as Seat[]).map((seat) => {
          const member = room.members.find((candidate) => candidate.seat === seat);
          const mine = member?.id === socket.id;
          return (
            <div className={`seat-slot ${SEAT_POSITIONS[seat]}`} key={seat}>
              <button
                type="button"
                className={`seat-choice${member ? " taken" : ""}${mine ? " mine" : ""}`}
                disabled={busy || Boolean(member)}
                onClick={() => onSit(seat)}
              >
                <span className={`team-dot team-${seat % 2}`} />
                <small>座位 {seat + 1} · {seat % 2 === 0 ? "A" : "B"} 队</small>
                <strong>{member ? member.name : "空位"}</strong>
                <em>{mine ? "你" : member?.isHost ? "房主" : member ? "" : "点击入座"}</em>
              </button>
              {me?.isHost && member && !mine && (
                <button type="button" className="kick-button" onClick={() => onKick(member.id)} title={`把 ${member.name} 移出房间`}>移出</button>
              )}
            </div>
          );
        })}
      </div>
      <div className="waiting-actions">
        <button type="button" className="quiet-button" onClick={onLeave} disabled={busy}>离开房间</button>
        {me?.isHost && <button type="button" className="quiet-button danger" onClick={onDissolve} disabled={busy}>解散房间</button>}
        {me?.isHost ? (
          <button type="button" className="primary-button" onClick={onStart} disabled={busy || seatedCount < 4}>
            {seatedCount < 4 ? `等待坐满（${seatedCount}/4）` : "开始对局"}
          </button>
        ) : <span className="waiting-hint">等待房主开始（{seatedCount}/4）</span>}
      </div>
    </section>
  );
}

function OnlineTables({ rooms, connected }: { rooms: PublicRoomSummary[]; connected: boolean }) {
  const admin = useAdminToken();

  function dissolve(room: PublicRoomSummary) {
    const names = room.players.map((player) => player.name).join("、");
    if (!window.confirm(`确定解散这个牌桌吗？（${names}）所有玩家都会被移出。`)) return;
    admin.setError("");
    socket.emit("admin:dissolve", { roomId: room.id, token: admin.token }, (response) => {
      if (!response.ok) admin.setError(response.error);
    });
  }

  return (
    <>
      {adminEntryEnabled && (
        <AdminBar token={admin.token} error={admin.error} connected={connected} onLogin={admin.login} onLogout={admin.logout} />
      )}
      {rooms.length === 0 ? <p className="empty-note">现在还没有牌桌，创建一个吧。</p> : (
    <div className="online-grid">
      {rooms.map((room) => (
        <article className="online-table" key={room.id}>
          <header>
            <span className={`status-chip ${room.status}`}>{room.status === "waiting" ? "等待中" : room.status === "playing" ? `第 ${room.handNumber} 局` : "已结束"}</span>
            {room.teamLevels && <span className="online-levels">A 队打 {rankLabel(room.teamLevels[0])} · B 队打 {rankLabel(room.teamLevels[1])}</span>}
          </header>
          <ul>
            {[...room.players].sort((left, right) => (left.seat ?? 9) - (right.seat ?? 9)).map((player) => (
              <li key={player.name} className={player.connected ? "" : "offline"}>
                {player.seat !== null && <span className={`team-dot team-${player.seat % 2}`} />}
                {player.name}{player.connected ? "" : "（离线）"}
              </li>
            ))}
          </ul>
          {admin.token && <button className="admin-dissolve" type="button" onClick={() => dissolve(room)}>解散牌桌</button>}
        </article>
      ))}
    </div>
      )}
    </>
  );
}

function App() {
  const [mode, setMode] = useState<EntryMode>("create");
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<LobbyRoomSnapshot | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lobbyRooms, setLobbyRooms] = useState<PublicRoomSummary[]>([]);
  const voice = useVoice(room);

  // 在房间里时服务端不推送在线牌桌列表；回到首页时主动拉一次最新的。
  useEffect(() => {
    if (room || !socket.connected) return;
    socket.emit("lobby:get", (response) => {
      if (response.ok) setLobbyRooms(response.data);
    });
  }, [room === null]);

  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      socket.emit("lobby:get", (response) => {
        if (response.ok) setLobbyRooms(response.data);
      });
    };
    const handleDisconnect = () => setConnected(false);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:updated", setRoom);
    socket.on("lobby:updated", setLobbyRooms);
    const handleClosed = ({ reason }: { reason: string }) => {
      setRoom(null);
      setBusy(false);
      setError("");
      setNotice(reason);
    };
    socket.on("room:closed", handleClosed);
    socket.connect();
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("room:updated", setRoom);
      socket.off("lobby:updated", setLobbyRooms);
      socket.off("room:closed", handleClosed);
      socket.disconnect();
    };
  }, []);

  const canSubmit = useMemo(() => {
    if (!connected || busy || name.trim().length < 2 || name.trim().length > 18) return false;
    return mode === "create" || validRoomCode.test(roomCode);
  }, [busy, connected, mode, name, roomCode]);

  /** 发出请求并统一处理忙碌状态和错误提示。 */
  function request<T>(send: (ack: (response: AckResponse<T>) => void) => void, onSuccess: (data: T) => void) {
    setBusy(true);
    setError("");
    setNotice("");
    send((response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      onSuccess(response.data);
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nickname = name.trim();
    const done = (snapshot: LobbyRoomSnapshot) => {
      setRoom(snapshot);
      setNotice(snapshot.status === "playing" ? "已回到对局。" : mode === "create" ? "房间已创建，把房间码发给朋友吧。" : "已加入房间。");
    };
    if (mode === "create") request<LobbyRoomSnapshot>((ack) => socket.emit("room:create", { name: nickname }, ack), done);
    else request<LobbyRoomSnapshot>((ack) => socket.emit("room:join", { name: nickname, code: roomCode }, ack), done);
  }

  function sendAction(action: MatchAction) {
    request<LobbyRoomSnapshot>((ack) => socket.emit("game:action", action, ack), setRoom);
  }

  function leaveRoom() {
    request<void>((ack) => socket.emit("room:leave", ack), () => setRoom(null));
  }

  /** 房间管理类操作：只关心成败，界面更新由服务端广播。 */
  function roomCommand(send: (ack: (response: AckResponse<void>) => void) => void) {
    setError("");
    send((response) => {
      if (!response.ok) setError(response.error);
    });
  }

  const kickMember = (memberId: string) => roomCommand((ack) => socket.emit("room:kick", memberId, ack));
  const voteRematch = (accept: boolean) => roomCommand((ack) => socket.emit("room:rematch", accept, ack));
  function dissolveRoom() {
    if (!window.confirm("确定解散房间吗？所有玩家都会被移出，当前对局也会结束。")) return;
    roomCommand((ack) => socket.emit("room:dissolve", ack));
  }

  async function copyRoomCode() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setNotice("房间码已复制。");
    } catch {
      setNotice("请手动复制房间码。");
    }
  }

  if (room?.status === "playing" && room.match) {
    return (
      <main className="game-shell">
        <Table
          room={room}
          busy={busy}
          error={error}
          notice={notice}
          brand={<Brand />}
          connection={<ConnectionStatus connected={connected} />}
          chat={<RoomChat room={room} voice={voice} />}
          onAction={sendAction}
          onRematch={voteRematch}
          onDissolve={dissolveRoom}
        />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Brand />
        <div className="topbar-right">
          {!room && <a className="center-link" href={CENTER_URL}>← 游戏中心</a>}
          <ConnectionStatus connected={connected} />
        </div>
      </header>
      <GameRules />

      {room ? (
        <>
          <WaitingRoom
            room={room}
            busy={busy}
            onSit={(seat) => request<LobbyRoomSnapshot>((ack) => socket.emit("room:sit", seat, ack), setRoom)}
            onStart={() => request<LobbyRoomSnapshot>((ack) => socket.emit("room:start", ack), setRoom)}
            onLeave={leaveRoom}
            onCopy={copyRoomCode}
            onKick={kickMember}
            onDissolve={dissolveRoom}
          />
          {error && <p className="feedback error-text" role="alert">{error}</p>}
          {notice && <p className="feedback" role="status">{notice}</p>}
          <div className="waiting-chat"><RoomChat room={room} voice={voice} /></div>
        </>
      ) : (
        <>
          <section className="welcome">
            <div className="welcome-copy">
              <div className="eyebrow">在线对战 · 4 人两队</div>
              <h1>掼蛋</h1>
              <p>创建一张牌桌，或输入房间码加入朋友的对局。两副牌、逢人配、从 2 打到 A。</p>
            </div>
            <section className="entry-card" aria-label="进入牌桌">
              <div className="mode-switch" role="tablist">
                <button type="button" role="tab" aria-selected={mode === "create"} className={mode === "create" ? "mode-tab active" : "mode-tab"} onClick={() => { setMode("create"); setError(""); }}>创建房间</button>
                <button type="button" role="tab" aria-selected={mode === "join"} className={mode === "join" ? "mode-tab active" : "mode-tab"} onClick={() => { setMode("join"); setError(""); }}>加入房间</button>
              </div>
              <form className="entry-form" onSubmit={handleSubmit}>
                <label className="field-label" htmlFor="player-name">你的昵称</label>
                <input id="player-name" className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="输入 2–18 个字符" maxLength={18} autoComplete="nickname" required />
                {mode === "join" && (
                  <>
                    <label className="field-label" htmlFor="room-code">房间码</label>
                    <input id="room-code" className="text-input room-code-input" value={roomCode} onChange={(event) => setRoomCode(normalizeRoomCode(event.target.value))} placeholder="例如：7KQ2TX" autoComplete="off" maxLength={6} required />
                    <p className="field-hint">对局中掉线了？用原昵称和房间码即可回到座位。</p>
                  </>
                )}
                {error && <p className="feedback error-text" role="alert">{error}</p>}
                {notice && <p className="feedback" role="status">{notice}</p>}
                <button className="primary-button" type="submit" disabled={!canSubmit}>{mode === "create" ? "创建房间" : "加入房间"}</button>
              </form>
            </section>
          </section>
          <section className="online-section">
            <h2>在线牌桌</h2>
            <OnlineTables rooms={lobbyRooms} connected={connected} />
          </section>
        </>
      )}
    </main>
  );
}

export default App;
