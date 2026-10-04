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
}

export interface LobbyRoomSnapshot {
	code: string;
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
	players: { name: string; connected: boolean; seat: Seat | null }[];
	teamLevels?: [number, number];
	handNumber?: number;
}

export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: string };
export type RoomAck<T> = (response: AckResponse<T>) => void;

export interface ClientToServerEvents {
	"room:create": (payload: { name: string }, ack: RoomAck<LobbyRoomSnapshot>) => void;
	"room:join": (payload: { name: string; code: string }, ack: RoomAck<LobbyRoomSnapshot>) => void;
	"room:sit": (seat: Seat, ack: RoomAck<LobbyRoomSnapshot>) => void;
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
	"voice:join": (payload: { muted: boolean }, ack: RoomAck<IceServerConfig[]>) => void;
	"voice:mute": (muted: boolean, ack: RoomAck<void>) => void;
	"voice:leave": (ack: RoomAck<void>) => void;
	"voice:signal": (payload: { to: string; data: VoiceSignal }) => void;
}

export interface ServerToClientEvents {
	"room:updated": (room: LobbyRoomSnapshot) => void;
	"lobby:updated": (rooms: PublicRoomSummary[]) => void;
	/** 被移出房间或房间被解散。 */
	"room:closed": (payload: { reason: string }) => void;
	"voice:signal": (payload: { from: string; data: VoiceSignal }) => void;
}

export type { Combo };
