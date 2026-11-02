// PvP room socket messages: keep in sync with backend/src/pvp_room.py and app/services/room.py
import type { Mode } from "../game/types";

export type PvpMode = Exclude<Mode, "random">;

export interface RoomPlayer {
  seat: number;
  name: string;
  registered: boolean;
  ready: boolean;
  connected: boolean;
  wins: number;
}

export type PlayerStatus = "ok" | "rejected" | "forfeit";
export type PlayerResult = "win" | "loss" | "draw";

export interface RoundResult {
  round: number;
  /** Winning seat, null for a draw */
  winner: number | null;
  players: { seat: number; name: string; strokes: number; status: PlayerStatus; result: PlayerResult }[];
}

export interface RoomSnapshot {
  code: string;
  mode: PvpMode;
  duration: number;
  round: number;
  /** Your seat */
  you: number;
  players: RoomPlayer[];
  /** Running match: `at` is GO in server time (ms) */
  match: { round: number; at: number } | null;
  last: RoundResult | null;
}

export type ServerMessage =
  | ({ t: "state" } & RoomSnapshot)
  | { t: "progress"; seat: number; n: number }
  | ({ t: "result" } & RoundResult)
  | { t: "pong"; c: number; s: number }
  | { t: "error"; code: string };

export interface FinalRun {
  strokes: number;
  bins: number[];
  fps: number;
  grip: number;
  split?: number[];
}

export type ClientMessage =
  | { t: "ping"; c: number }
  | { t: "ready"; v: boolean }
  | { t: "progress"; n: number }
  | ({ t: "final" } & FinalRun);

/** Close codes from the server (see pvp_room.py) */
export const CLOSE_REJECTED = 4000;
export const CLOSE_REPLACED = 4001;
