import { createHmac } from "node:crypto";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import type {
  AckResponse,
  ClientToServerEvents,
  LobbyRoomSnapshot,
  MatchAction,
  PublicRoomSummary,
  Seat,
  ServerToClientEvents,
} from "@guandan/game";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const clients = new Set<TestSocket>();
let serverUrl = "";
let httpServer: typeof import("../src/index.js").httpServer;
let serverIo: typeof import("../src/index.js").io;
let testHooks: typeof import("../src/index.js").testHooks;
const rematchMs = 300;
const adminToken = "test-admin-token";
const previousRematchMs = process.env.REMATCH_TIMEOUT_MS;
const previousAdminToken = process.env.ADMIN_TOKEN;
const abandonMs = 300;
const previousAbandonMs = process.env.ROOM_ABANDON_MS;

function connectClient(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.add(client);
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const create = (client: TestSocket, name: string) =>
  new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => client.emit("room:create", { name }, resolve));
const join = (client: TestSocket, name: string, code: string) =>
  new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => client.emit("room:join", { name, code }, resolve));
const sit = (client: TestSocket, seat: Seat) =>
  new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => client.emit("room:sit", seat, resolve));
const start = (client: TestSocket) =>
  new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => client.emit("room:start", resolve));
const act = (client: TestSocket, action: MatchAction) =>
  new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => client.emit("game:action", action, resolve));

function unwrap<T>(response: AckResponse<T>): T {
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

/** 建一个坐满 4 人的房间并开局，返回按座位排列的客户端。 */
async function startedTable(prefix: string) {
  const host = await connectClient();
  const code = unwrap(await create(host, `${prefix}0`)).code;
  const others = [await connectClient(), await connectClient(), await connectClient()];
  for (const [index, client] of others.entries()) unwrap(await join(client, `${prefix}${index + 1}`, code));
  const bySeat = [host, ...others];
  const latest: LobbyRoomSnapshot[] = [];
  bySeat.forEach((client, seat) => client.on("room:updated", (room) => { latest[seat] = room; }));
  const started = unwrap(await start(host));
  await delay(50);
  return { code, bySeat, started, latest };
}

describe("Guandan room server", () => {
  beforeAll(async () => {
    process.env.ROOM_ABANDON_MS = String(abandonMs);
    process.env.REMATCH_TIMEOUT_MS = String(rematchMs);
    process.env.ADMIN_TOKEN = adminToken;
    process.env.TURN_HOST = "turn.example.com";
    process.env.TURN_SECRET = "turn-secret";
    const serverModule = await import("../src/index.js");
    httpServer = serverModule.httpServer;
    serverIo = serverModule.io;
    testHooks = serverModule.testHooks;
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, resolve);
    });
    serverUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => serverIo.close(() => resolve()));
    if (previousAbandonMs === undefined) delete process.env.ROOM_ABANDON_MS;
    else process.env.ROOM_ABANDON_MS = previousAbandonMs;
    if (previousRematchMs === undefined) delete process.env.REMATCH_TIMEOUT_MS;
    else process.env.REMATCH_TIMEOUT_MS = previousRematchMs;
    if (previousAdminToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previousAdminToken;
    delete process.env.TURN_HOST;
    delete process.env.TURN_SECRET;
  });

  it("seats players, lets them swap seats, and starts only when all four seats are filled", async () => {
    const host = await connectClient();
    const created = unwrap(await create(host, "Seat Host"));
    expect(created.members[0]).toMatchObject({ seat: 0, isHost: true });
    const guests = [await connectClient(), await connectClient()];
    unwrap(await join(guests[0]!, "Seat One", created.code));
    const second = unwrap(await join(guests[1]!, "Seat Two", created.code));
    expect(second.members.map((member) => member.seat)).toEqual([0, 1, 2]);

    expect((await sit(guests[1]!, 0)).ok).toBe(false);
    const moved = unwrap(await sit(guests[1]!, 3));
    expect(moved.members.find((member) => member.name === "Seat Two")?.seat).toBe(3);
    const notFull = await start(host);
    expect(notFull.ok).toBe(false);

    const fourth = await connectClient();
    const joined = unwrap(await join(fourth, "Seat Three", created.code));
    expect(joined.members.find((member) => member.name === "Seat Three")?.seat).toBe(2);
    expect((await join(await connectClient(), "Too Many", created.code)).ok).toBe(false);
    expect((await start(guests[0]!)).ok).toBe(false);
    const started = unwrap(await start(host));
    expect(started.status).toBe("playing");
    expect(started.match?.players.map((player) => player.name)).toEqual(["Seat Host", "Seat One", "Seat Three", "Seat Two"]);
  });

  it("deals each player only their own hand and accepts plays in turn", async () => {
    const { bySeat, started, latest } = await startedTable("Deal");
    const match = started.match!;
    expect(match.mySeat).toBe(0);
    expect(match.hand.myCards).toHaveLength(27);
    expect(match.hand.cardCounts).toEqual([27, 27, 27, 27]);
    const allCards = latest.flatMap((room) => room.match!.hand.myCards.map((card) => card.id));
    expect(new Set(allCards).size).toBe(108);

    const turn = match.hand.turn;
    const leader = bySeat[turn]!;
    const waiting = bySeat[(turn + 1) % 4]!;
    expect((await act(waiting, { type: "pass" })).ok).toBe(false);
    expect((await act(leader, { type: "pass" })).ok).toBe(false);

    const firstCard = latest[turn]!.match!.hand.myCards[0]!;
    const update = new Promise<LobbyRoomSnapshot>((resolve) => waiting.once("room:updated", resolve));
    const played = unwrap(await act(leader, { type: "play", cardIds: [firstCard.id] }));
    expect(played.match?.hand.cardCounts[turn]).toBe(26);
    const seenByOthers = await update;
    expect(seenByOthers.match?.hand.lastPlay?.cards[0]?.id).toBe(firstCard.id);
    expect(seenByOthers.match?.hand.turn).toBe((turn + 1) % 4);
  });

  it("pushes the online-tables list only to visitors on the home page, at most once per second", async () => {
    const visitor = await connectClient();
    const visitorLists: PublicRoomSummary[][] = [];
    const visitorTimes: number[] = [];
    visitor.on("lobby:updated", (list) => {
      visitorLists.push(list);
      visitorTimes.push(Date.now());
    });
    const host = await connectClient();
    const code = unwrap(await create(host, "Burst Host")).code;
    let hostUpdates = 0;
    host.on("lobby:updated", () => { hostUpdates += 1; });
    for (const name of ["Burst One", "Burst Two", "Burst Three"]) {
      const response = await join(await connectClient(), name, code);
      expect(response.ok).toBe(true);
    }
    await delay(1_500);
    expect(hostUpdates).toBe(0);
    expect(visitorLists.length).toBeGreaterThanOrEqual(1);
    expect(visitorLists.length).toBeLessThanOrEqual(2);
    if (visitorTimes.length === 2) expect(visitorTimes[1]! - visitorTimes[0]!).toBeGreaterThanOrEqual(950);
    const latest = visitorLists[visitorLists.length - 1]!;
    expect(latest.find((room) => room.players.some((player) => player.name === "Burst Host"))?.players).toHaveLength(4);
  });

  it("returns a disconnected player to their seat and closes a table abandoned by everyone", async () => {
    const { code, bySeat } = await startedTable("Back");
    bySeat[2]!.disconnect();
    await delay(50);
    expect((await join(await connectClient(), "Stranger", code)).ok).toBe(false);
    const returning = await connectClient();
    const rejoined = unwrap(await join(returning, "Back2", code));
    expect(rejoined.match?.mySeat).toBe(2);
    expect(rejoined.match?.hand.myCards).toHaveLength(27);

    for (const client of [bySeat[0]!, bySeat[1]!, bySeat[3]!, returning]) client.disconnect();
    await delay(abandonMs * 2);
    const visitor = await connectClient();
    const lobby = await new Promise<AckResponse<PublicRoomSummary[]>>((resolve) => visitor.emit("lobby:get", resolve));
    expect(lobby.ok && lobby.data.some((room) => room.players.some((player) => player.name === "Back0"))).toBe(false);
    expect((await join(visitor, "Back0", code)).ok).toBe(false);
  });

  describe("room lifecycle", () => {
    const emitAck = <T,>(client: TestSocket, event: string, ...args: unknown[]) =>
      new Promise<AckResponse<T>>((resolve) => (client.emit as (...rest: unknown[]) => void)(event, ...args, resolve));
    const closedReason = (client: TestSocket) => new Promise<string>((resolve) => client.once("room:closed", ({ reason }) => resolve(reason)));
    const waitFor = (client: TestSocket, check: (room: LobbyRoomSnapshot) => boolean) =>
      new Promise<LobbyRoomSnapshot>((resolve) => {
        const handler = (room: LobbyRoomSnapshot) => {
          if (!check(room)) return;
          client.off("room:updated", handler);
          resolve(room);
        };
        client.on("room:updated", handler);
      });

    it("starts a new match when all four agree to continue", async () => {
      const { code, bySeat } = await startedTable("Again");
      testHooks.finishMatch(code);
      const restarted = waitFor(bySeat[0]!, (room) => !room.rematch && room.match?.phase === "playing");
      for (const client of bySeat) expect((await emitAck(client, "room:rematch", true)).ok).toBe(true);
      const room = await restarted;
      expect(room.match?.teamLevels).toEqual([2, 2]);
      expect(room.match?.hand.myCards).toHaveLength(27);
    });

    it("removes decliners and non-responders, keeping the others seated in the lobby", async () => {
      const { code, bySeat } = await startedTable("Vote");
      testHooks.finishMatch(code);
      const declined = closedReason(bySeat[1]!);
      const backInLobby = waitFor(bySeat[0]!, (room) => room.status === "waiting");
      await emitAck(bySeat[0]!, "room:rematch", true);
      await emitAck(bySeat[1]!, "room:rematch", false);
      expect(await declined).toContain("不继续");
      const lobby = await backInLobby;
      expect(lobby.match).toBeUndefined();
      expect(lobby.members.map((member) => [member.name, member.seat])).toEqual([["Vote0", 0], ["Vote2", 2], ["Vote3", 3]]);

      const { code: slowCode, bySeat: slowTable } = await startedTable("Slow");
      testHooks.finishMatch(slowCode);
      const timedOut = closedReason(slowTable[3]!);
      for (const client of slowTable.slice(0, 3)) await emitAck(client, "room:rematch", true);
      expect(await timedOut).toContain("1 分钟");
    });

    it("lets the host kick in the lobby and dissolve the room, and lets an admin dissolve any table", async () => {
      const host = await connectClient();
      const created = unwrap(await create(host, "Boss"));
      const guest = await connectClient();
      const guestRoom = unwrap(await join(guest, "Kick Me", created.code));
      const guestId = guestRoom.members.find((member) => member.name === "Kick Me")!.id;
      expect((await emitAck(guest, "room:kick", created.members[0]!.id)).ok).toBe(false);
      const kicked = closedReason(guest);
      expect((await emitAck(host, "room:kick", guestId)).ok).toBe(true);
      expect(await kicked).toContain("房主");
      expect((await emitAck(host, "room:dissolve")).ok).toBe(true);
      expect((await join(await connectClient(), "Later", created.code)).ok).toBe(false);

      const { code, bySeat } = await startedTable("Admin");
      expect((await emitAck(bySeat[0]!, "room:kick", bySeat[1]!.id)).ok).toBe(false);
      const visitor = await connectClient();
      const lobby = unwrap(await new Promise<AckResponse<PublicRoomSummary[]>>((resolve) => visitor.emit("lobby:get", resolve)));
      const target = lobby.find((room) => room.players.some((player) => player.name === "Admin0"))!;
      expect((await emitAck(visitor, "admin:dissolve", { roomId: target.id, token: "nope" })).ok).toBe(false);
      const closed = closedReason(bySeat[2]!);
      expect((await emitAck(await connectClient(), "admin:dissolve", { roomId: target.id, token: adminToken })).ok).toBe(true);
      expect(await closed).toContain("管理员");
      expect((await join(await connectClient(), "Admin0", code)).ok).toBe(false);
    });
  });

  describe("voice", () => {
    type IceServers = import("@guandan/game").IceServerConfig[];
    const joinVoice = (client: TestSocket, muted = false) =>
      new Promise<AckResponse<IceServers>>((resolve) => client.emit("voice:join", { muted }, resolve));
    const latestRoom = (client: TestSocket) => new Promise<LobbyRoomSnapshot>((resolve) => client.once("room:updated", resolve));

    it("hands out short-lived TURN credentials and relays signals only between voice members of one room", async () => {
      const host = await connectClient();
      const created = unwrap(await create(host, "Voice Host"));
      const guest = await connectClient();
      unwrap(await join(guest, "Voice Guest", created.code));
      const outsider = await connectClient();
      unwrap(await create(outsider, "Outsider"));

      const joined = await joinVoice(host);
      if (!joined.ok) throw new Error(joined.error);
      const turn = joined.data.find((server) => server.username)!;
      expect(turn.urls).toContain("turn:turn.example.com:3478?transport=udp");
      const [expiry, memberId] = turn.username!.split(":");
      expect(memberId).toBe(host.id);
      expect(Number(expiry)).toBeGreaterThan(Date.now() / 1000);
      expect(turn.credential).toBe(createHmac("sha1", "turn-secret").update(turn.username!).digest("base64"));

      const received: unknown[] = [];
      guest.on("voice:signal", (payload) => received.push(payload));
      const offer = { description: { type: "offer" as const, sdp: "v=0" } };
      host.emit("voice:signal", { to: guest.id!, data: offer });
      await delay(80);
      expect(received).toHaveLength(0);

      const guestView = latestRoom(guest);
      await joinVoice(guest, true);
      expect((await guestView).voice).toEqual([{ id: host.id, muted: false }, { id: guest.id, muted: true }]);
      host.emit("voice:signal", { to: guest.id!, data: offer });
      outsider.emit("voice:signal", { to: guest.id!, data: offer });
      host.emit("voice:signal", { to: guest.id!, data: { description: { type: "bogus", sdp: 1 } } as never });
      await delay(80);
      expect(received).toEqual([{ from: host.id, data: offer }]);

      const afterLeave = latestRoom(host);
      await new Promise((resolve) => guest.emit("voice:leave", resolve));
      expect((await afterLeave).voice.map((entry) => entry.id)).toEqual([host.id]);
      const afterDisconnect = latestRoom(guest);
      host.disconnect();
      expect((await afterDisconnect).voice).toEqual([]);
    });
  });
});
