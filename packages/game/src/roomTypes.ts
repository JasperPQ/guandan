import type { Combo } from "./combos.js";
import type { MatchAction, Seat } from "./match.js";
import type { MatchView } from "./view.js";

export interface LobbyMember {
	id: string;
	name: string;
	isHost: boolean;
	connected: boolean;
	seat: Seat | null;
}

export interface RoomChatMessage {
	id: string;
	senderId: string;
	name: string;
	message: string;
	createdAt: string;
	/** 观战的人发的。 */
	spectator?: boolean;
}

/** 房主在房间里随时可以改的「谁能进来」设置。 */
export interface RoomAccess {
	/** 允许观战：有房间码、或者从首页列表都能进来看。 */
	readonly allowSpectators: boolean;
	/** 观战的人能看到所有人的手牌（上帝视角）；关掉时只看公开信息。 */
	readonly spectatorsSeeAll: boolean;
	/** 公开房间：不认识的人也能从首页列表直接加入空座位。 */
	readonly open: boolean;
}

export const DEFAULT_ROOM_ACCESS: RoomAccess = { allowSpectators: true, spectatorsSeeAll: false, open: false };

/** 观战的人：不占座位，不能操作、投票或进语音，可以聊天。 */
export interface Spectator {
	readonly id: string;
	readonly name: string;
}

export interface LobbyRoomSnapshot {
	/** 从首页列表进来观战的人看不到房间码（空字符串）。 */
	code: string;
	spectators: Spectator[];
	access: RoomAccess;
	status: "waiting" | "playing";
	members: LobbyMember[];
	chat: RoomChatMessage[];
	match?: MatchView;
	/** 整场结束后的「是否继续」投票；remainingMs 为发送时剩余的毫秒数。 */
	rematch?: RematchState;
	/** 当前在语音里的成员。 */
	voice: VoiceParticipant[];
}

export interface VoiceParticipant {
	id: string;
	muted: boolean;
}

/** 传给浏览器 RTCPeerConnection 的 STUN/TURN 配置。 */
export interface IceServerConfig {
	urls: string | string[];
	username?: string;
	credential?: string;
}

/** 语音连接协商消息，由服务器在同一房间的两位成员之间转发。 */
export type VoiceSignal =
	| { description: { type: "offer" | "answer"; sdp: string } }
	| { candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } };

export interface RematchState {
	remainingMs: number;
	acceptedIds: string[];
}

/** 入口页「在线牌桌」：不含房间码。 */
export interface PublicRoomSummary {
	id: string;
	status: "waiting" | "playing" | "finished";
	open: boolean;
	allowSpectators: boolean;
	spectators: number;
	players: { name: string; connected: boolean; seat: Seat | null }[];
	teamLevels?: [number, number];
	handNumber?: number;
}

/** 用房间码加入，或者从首页列表按房间的公开 id 加入；spectate 为 true 时进来观战。 */
export interface JoinRoomPayload {
	readonly name: string;
	readonly code?: string;
	readonly roomId?: string;
	readonly spectate?: boolean;
}

export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: string };
export type RoomAck<T> = (response: AckResponse<T>) => void;

export interface ClientToServerEvents {
	"room:create": (payload: { name: string }, ack: RoomAck<LobbyRoomSnapshot>) => void;
	"room:join": (payload: JoinRoomPayload, ack: RoomAck<LobbyRoomSnapshot>) => void;
	/** 换座位；观战的人点空座位就坐下（邀请制房间要有房间码进来的才行）。 */
	"room:sit": (seat: Seat, ack: RoomAck<LobbyRoomSnapshot>) => void;
	/** 等待中：玩家（房主除外）改成观战。 */
	"room:stand": (ack: RoomAck<void>) => void;
	"room:access": (access: Partial<RoomAccess>, ack: RoomAck<void>) => void;
	"room:start": (ack: RoomAck<LobbyRoomSnapshot>) => void;
	"room:leave": (ack: RoomAck<void>) => void;
	"room:chat": (payload: { message: string }, ack: RoomAck<void>) => void;
	"game:action": (action: MatchAction, ack: RoomAck<LobbyRoomSnapshot>) => void;
	"lobby:get": (ack: RoomAck<PublicRoomSummary[]>) => void;
	"room:rematch": (accept: boolean, ack: RoomAck<void>) => void;
	"room:kick": (memberId: string, ack: RoomAck<void>) => void;
	"room:dissolve": (ack: RoomAck<void>) => void;
	"admin:verify": (token: string, ack: RoomAck<void>) => void;
	"admin:dissolve": (payload: { roomId: string; token: string }, ack: RoomAck<void>) => void;
	/** 游戏中心挤掉某次登录（同一账号登录的设备超出上限）时调用：断开属于这次登录的所有连接，回执是断开的连接数。 */
	"admin:kick-session": (payload: { sessionId: string; token: string }, ack: RoomAck<number>) => void;
	"voice:join": (payload: { muted: boolean }, ack: RoomAck<IceServerConfig[]>) => void;
	"voice:mute": (muted: boolean, ack: RoomAck<void>) => void;
	"voice:leave": (ack: RoomAck<void>) => void;
	"voice:signal": (payload: { to: string; data: VoiceSignal }) => void;
}

export interface ServerToClientEvents {
	"room:updated": (room: LobbyRoomSnapshot) => void;
	/** 这次登录被同一账号的新登录挤掉了；收到后连接会被断开，网页回大厅看提示。 */
	"session:kicked": () => void;
	"lobby:updated": (rooms: PublicRoomSummary[]) => void;
	/** 被移出房间或房间被解散。 */
	"room:closed": (payload: { reason: string }) => void;
	"voice:signal": (payload: { from: string; data: VoiceSignal }) => void;
}

export type { Combo };
