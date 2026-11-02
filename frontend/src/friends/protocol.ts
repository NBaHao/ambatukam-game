// Lobby socket messages (/api/lobby/ws): keep in sync with backend/src/lobby_room.py and app/services/lobby.py
import type { PvpMode } from "../pvp/protocol";

export type LobbyServerMessage =
  | { t: "hello"; name: string; online: string[] }
  | { t: "online"; user: string; on: boolean }
  | { t: "invite"; from: string; code: string; mode: PvpMode; duration: number }
  | { t: "invited"; to: string; code: string }
  | { t: "declined"; by: string; code: string }
  | { t: "friends_changed" }
  | { t: "pong"; c: number; s: number }
  | { t: "hb" }
  | { t: "queued"; mode: PvpMode; duration: number }
  | {
      t: "matched";
      code: string;
      ticket: string;
      mode: PvpMode;
      duration: number;
      opponent: { name: string; registered: boolean };
    }
  | { t: "error"; code: string };

export type LobbyClientMessage =
  | { t: "hb" }
  | { t: "sync" }
  | { t: "invite"; to: string; code: string; mode: PvpMode; duration: number }
  | { t: "decline"; to: string; code: string }
  | { t: "nudge"; to: string }
  | { t: "queue"; mode: PvpMode; duration: number }
  | { t: "unqueue" };

/** The lobby closes a socket with this code when its ticket is bad */
export const LOBBY_CLOSE_REJECTED = 4000;
