import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  botCommand,
  type AckResponse,
  type ClientToServerEvents,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type Seat,
  type ServerToClientEvents,
} from "@guandan/game";

// 人机立刻行动、每一步 300 ms 超时，测试才跑得快（服务端在导入时读这两个变量）。
process.env.BOT_DELAY_SCALE = "0";
process.env.TURN_MS = "300";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const clients = new Set<TestSocket>();
const latest = new Map<TestSocket, LobbyRoomSnapshot>();
let serverUrl = "";
let httpServer: typeof import("../src/index.js").httpServer;
let serverIo: typeof import("../src/index.js").io;
let nameSeq = 0;

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.add(client);
    client.on("room:updated", (room) => latest.set(client, room));
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function nick(prefix: string): string {
  nameSeq += 1;
  return `${prefix}${nameSeq}`;
}

function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

async function create(client: TestSocket, name: string): Promise<LobbyRoomSnapshot> {
  const response = await call<LobbyRoomSnapshot>((ack) => client.emit("room:create", { name }, ack));
  if (!response.ok) throw new Error(response.error);
  latest.set(client, response.data);
  return response.data;
}

async function join(client: TestSocket, name: string, code: string): Promise<AckResponse<LobbyRoomSnapshot>> {
  const response = await call<LobbyRoomSnapshot>((ack) => client.emit("room:join", { name, code }, ack));
  if (response.ok) latest.set(client, response.data);
  return response;
}

const addBot = (client: TestSocket, seat: Seat) => call<void>((ack) => client.emit("room:add-bot", seat, ack));

/** 空座位全部加人机。 */
async function fillWithBots(host: TestSocket, humanCount = 1): Promise<void> {
  const room = await updateWhere(host, (snapshot) => snapshot.members.length >= humanCount);
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    if (room.members.some((member) => member.seat === seat)) continue;
    expect((await addBot(host, seat)).ok).toBe(true);
  }
  await updateWhere(host, (snapshot) => snapshot.members.length === 4);
}
const start = (client: TestSocket) => call<LobbyRoomSnapshot>((ack) => client.emit("room:start", ack));

function lobby(client: TestSocket): Promise<PublicRoomSummary[]> {
  return new Promise((resolve) => client.emit("lobby:get", (response) => resolve(response.ok ? response.data : [])));
}

function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean, timeoutMs = 20_000): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => {
    const current = latest.get(client);
    if (current && test(current)) {
      resolve(current);
      return;
    }
    const timer = setTimeout(() => {
      client.off("room:updated", handler);
      reject(new Error("等不到想要的房间状态"));
    }, timeoutMs);
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      clearTimeout(timer);
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}

function seatOf(room: LobbyRoomSnapshot, client: TestSocket): Seat {
  return room.match!.players.findIndex((player) => player.id === client.id) as Seat;
}

/** 真人：轮到自己时按人机的打法自动行动；返回停止函数。 */
function autoplay(client: TestSocket): () => void {
  let sentFor = "";
  const handler = (room: LobbyRoomSnapshot) => {
    const match = room.match;
    if (!match || match.phase === "finished" || match.mySeat === null) return;
    const action = botCommand(match, match.players[match.mySeat]!.id);
    const key = `${match.hand.number}:${match.phase}:${match.hand.played.length}:${match.hand.passes}:${match.hand.turn}:${match.ready.join()}:${match.hand.tribute?.givenSeats.length}:${match.hand.tribute?.returns.length}`;
    if (!action || sentFor === key) return;
    sentFor = key;
    client.emit("game:action", action, () => {});
  };
  client.on("room:updated", handler);
  const current = latest.get(client);
  if (current) handler(current);
  return () => client.off("room:updated", handler);
}

describe("人机", () => {
  beforeAll(async () => {
    const serverModule = await import("../src/index.js");
    httpServer = serverModule.httpServer;
    serverIo = serverModule.io;
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, resolve);
    });
    serverUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => serverIo.close(() => resolve()));
  });

  it("只有房主能加人机、只能加在空座位；房主能移出人机；首页列表标出人机", async () => {
    const host = await connect();
    const hostName = nick("房主");
    const { code } = await create(host, hostName);
    const guest = await connect();
    expect((await join(guest, nick("客人"), code)).ok).toBe(true);

    expect((await addBot(guest, 2)).ok).toBe(false);
    expect((await addBot(host, 0)).ok).toBe(false);
    expect((await addBot(host, 2)).ok).toBe(true);
    expect((await addBot(host, 3)).ok).toBe(true);
    const room = await updateWhere(host, (snapshot) => snapshot.members.length === 4);
    const bot = room.members.find((member) => member.seat === 2)!;
    expect(bot).toMatchObject({ name: "咕噜一号", isHost: false, connected: true, bot: true });
    expect(room.members.find((member) => member.seat === 3)?.name).toBe("咕噜二号");

    const summary = (await lobby(host)).find((candidate) => candidate.players.some((player) => player.name === hostName))!;
    expect(summary.players.find((player) => player.name === "咕噜一号")?.bot).toBe(true);

    expect((await call<void>((ack) => host.emit("room:kick", bot.id, ack))).ok).toBe(true);
    await updateWhere(host, (snapshot) => snapshot.members.length === 3 && !snapshot.members.some((member) => member.seat === 2));
  });

  it("一个人加满人机就能开局，人机把整场打完（过 A）；人机自动同意再来一场", async () => {
    const host = await connect();
    await create(host, nick("独行"));
    await fillWithBots(host);
    const names = (await updateWhere(host, () => true)).members.filter((member) => member.bot).map((member) => member.name);
    expect(names.sort()).toEqual(["咕噜一号", "咕噜三号", "咕噜二号"].sort());

    expect((await start(host)).ok).toBe(true);
    const stop = autoplay(host);
    const finished = await updateWhere(host, (snapshot) => snapshot.match?.phase === "finished", 120_000);
    stop();
    expect(finished.match!.winnerTeam === 0 || finished.match!.winnerTeam === 1).toBe(true);
    expect(finished.match!.hand.number).toBeGreaterThan(1);
    const bots = finished.members.filter((member) => member.bot).map((member) => member.id);
    expect(finished.rematch?.acceptedIds.sort()).toEqual(bots.sort());

    expect((await call<void>((ack) => host.emit("room:rematch", true, ack))).ok).toBe(true);
    const again = await updateWhere(host, (snapshot) => snapshot.match !== undefined && snapshot.match.phase !== "finished" && !snapshot.rematch);
    expect(again.match!.players).toHaveLength(4);
    expect(again.match!.teamLevels).toEqual([2, 2]);
  }, 150_000);

  it("等待中最后一个真人离开，只剩人机的房间直接关掉", async () => {
    const host = await connect();
    const hostName = nick("房主");
    await create(host, hostName);
    expect((await addBot(host, 1)).ok).toBe(true);
    expect((await lobby(host)).some((candidate) => candidate.players.some((player) => player.name === hostName))).toBe(true);
    expect((await call<void>((ack) => host.emit("room:leave", ack))).ok).toBe(true);
    const rooms = await lobby(host);
    expect(rooms.some((candidate) => candidate.players.some((player) => player.name === hostName))).toBe(false);
  });

  it("连续超时两次转托管，由人机代打（没有倒计时）；取消托管后交还", async () => {
    const idle = await connect();
    const active = await connect();
    const { code } = await create(idle, nick("发呆"));
    expect((await join(active, nick("认真"), code)).ok).toBe(true);
    await fillWithBots(idle, 2);
    expect((await start(idle)).ok).toBe(true);
    const stop = autoplay(active);

    const isAuto = (snapshot: LobbyRoomSnapshot) => snapshot.members.find((member) => member.id === idle.id)?.auto === true;
    const autoRoom = await updateWhere(idle, isAuto);
    const idleSeat = seatOf(autoRoom, idle);

    // 托管后轮到他时没有倒计时，人机替他走
    const hisTurn = await updateWhere(idle, (snapshot) => isAuto(snapshot) && snapshot.match?.phase === "playing" && snapshot.match.hand.turn === idleSeat);
    expect(hisTurn.turnRemainingMs).toBeUndefined();
    const before = hisTurn.match!.hand.cardCounts[idleSeat];
    await updateWhere(idle, (snapshot) => snapshot.match?.phase !== "playing" || snapshot.match.hand.turn !== idleSeat || snapshot.match.hand.cardCounts[idleSeat] !== before);

    expect((await call<void>((ack) => idle.emit("room:auto", false, ack))).ok).toBe(true);
    const back = await updateWhere(idle, (snapshot) => !isAuto(snapshot));
    expect(back.members.find((member) => member.id === idle.id)?.auto).toBeUndefined();
    stop();
  }, 60_000);

  it("掉线的人轮到时由人机代打（不算超时、不转托管），用原昵称回来后交还", async () => {
    const leaver = await connect();
    const stayer = await connect();
    const leaverName = nick("掉线");
    const { code } = await create(leaver, leaverName);
    expect((await join(stayer, nick("留下"), code)).ok).toBe(true);
    await fillWithBots(leaver, 2);
    const started = await start(leaver);
    if (!started.ok) throw new Error(started.error);
    const leaverSeat = seatOf(started.data, leaver);
    const stop = autoplay(stayer);
    leaver.disconnect();

    const played = await updateWhere(stayer, (snapshot) => (snapshot.match?.hand.cardCounts[leaverSeat] ?? 27) < 27 || (snapshot.match?.hand.number ?? 1) > 1);
    const offline = played.members.find((member) => member.name === leaverName)!;
    expect(offline).toMatchObject({ connected: false });
    expect(offline.auto).toBeUndefined();

    const back = await connect();
    const rejoined = await join(back, leaverName, code);
    expect(rejoined.ok).toBe(true);
    if (!rejoined.ok) return;
    expect(rejoined.data.members.find((member) => member.id === back.id)).toMatchObject({ seat: leaverSeat, connected: true });
    expect(rejoined.data.match?.mySeat).toBe(leaverSeat);
    stop();
  }, 60_000);

  it("对局里每一步都有出路：一家真人一直不动，靠超时和托管也能打完一局", async () => {
    const idle = await connect();
    await create(idle, nick("挂机"));
    await fillWithBots(idle);
    expect((await start(idle)).ok).toBe(true);
    const done = await updateWhere(idle, (snapshot) => snapshot.match?.phase === "handOver" || snapshot.match?.phase === "finished" || (snapshot.match?.hand.number ?? 1) > 1, 60_000);
    expect(done.match).toBeDefined();
  }, 90_000);
});
