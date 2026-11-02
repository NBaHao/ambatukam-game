// PvP room connection: one WebSocket to the room's Durable Object (/api/rooms/{code}/ws).
// Pure TS like the engine: React reads `store` through useStore. Reconnects on network drops
// with the same ticket (valid for hours); the server keeps the seat while the match runs.
import { config } from "../config";
import { Store } from "../game/Store";
import { ClockSync } from "./clock";
import {
  CLOSE_REJECTED,
  CLOSE_REPLACED,
  type ClientMessage,
  type FinalRun,
  type RoomSnapshot,
  type RoundResult,
  type RtcSignal,
  type ServerMessage,
} from "./protocol";

export type RoomStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface RoomView {
  status: RoomStatus;
  /** Why the room closed: room_not_found, room_full, bad_ticket, replaced, network */
  error: string | null;
  room: RoomSnapshot | null;
  /** Opponent's live stroke count in the running match */
  opponentCount: number;
  /** Result of the latest round, as it arrived */
  result: RoundResult | null;
}

const PING_EVERY_MS = 15_000;
const SYNC_PINGS = 5;
const MAX_RETRIES = 8;

export function roomSocketUrl(code: string, ticket: string): string {
  const base = new URL(config.apiBaseUrl || location.origin, location.href);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `/api/rooms/${code}/ws`;
  base.search = new URLSearchParams({ ticket }).toString();
  return base.toString();
}

export class RoomClient {
  readonly store = new Store<RoomView>({
    status: "connecting",
    error: null,
    room: null,
    opponentCount: 0,
    result: null,
  });
  readonly clock = new ClockSync();

  private ws: WebSocket | null = null;
  private retries = 0;
  private stopped = false;
  private timers: number[] = [];
  private pingTimer = 0;

  readonly code: string;
  readonly ticket: string;
  /** Video / voice I want to share; sent again whenever the room's copy differs (it resets on reconnect) */
  private media = { cam: false, mic: false };
  /** WebRTC signaling from the opponent (RtcLink) */
  onSignal: ((d: RtcSignal) => void) | null = null;

  constructor(code: string, ticket: string) {
    this.code = code;
    this.ticket = ticket;
  }

  /** Connect (again after close()): reconnects by itself until close() */
  open(): void {
    this.stopped = false;
    this.retries = 0;
    this.store.update({ status: "connecting", error: null });
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(roomSocketUrl(this.code, this.ticket));
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.store.update({ status: "open", error: null });
      for (let i = 0; i < SYNC_PINGS; i++) this.later(() => this.ping(), i * 150);
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.ping(), PING_EVERY_MS);
    };
    ws.onmessage = (e) => {
      if (this.ws === ws && typeof e.data === "string") this.onMessage(JSON.parse(e.data) as ServerMessage);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      this.ws = null;
      if (this.stopped || e.code === CLOSE_REJECTED || e.code === CLOSE_REPLACED) {
        this.store.update({
          status: "closed",
          error: this.store.get().error ?? (e.code === CLOSE_REPLACED ? "replaced" : null),
        });
        return;
      }
      if (this.retries >= MAX_RETRIES) {
        this.store.update({ status: "closed", error: "network" });
        return;
      }
      this.store.update({ status: "reconnecting" });
      const delay = Math.min(8000, 500 * 2 ** this.retries++);
      this.later(() => this.connect(), delay);
    };
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case "state": {
        const { t: _, ...room } = msg;
        const prev = this.store.get().room;
        const newMatch = room.match && room.match.round !== prev?.match?.round;
        this.store.update({ room, ...(newMatch ? { opponentCount: 0, result: null } : {}) });
        const me = room.players.find((p) => p.seat === room.you);
        if (me && (me.cam !== this.media.cam || me.mic !== this.media.mic)) this.send({ t: "media", ...this.media });
        break;
      }
      case "progress":
        if (msg.seat !== this.store.get().room?.you) this.store.update({ opponentCount: msg.n });
        break;
      case "result": {
        const { t: _, ...result } = msg;
        this.store.update({ result });
        break;
      }
      case "signal":
        this.onSignal?.(msg.d);
        break;
      case "pong":
        this.clock.add(msg.c, Date.now(), msg.s);
        break;
      case "error":
        this.store.update({ error: msg.code });
        break;
    }
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private ping(): void {
    this.send({ t: "ping", c: Date.now() });
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  setReady(ready: boolean): void {
    this.send({ t: "ready", v: ready });
  }

  progress(n: number): void {
    this.send({ t: "progress", n });
  }

  final(run: FinalRun): void {
    this.send({ t: "final", ...run });
  }

  setMedia(cam: boolean, mic: boolean): void {
    this.media = { cam, mic };
    this.send({ t: "media", cam, mic });
  }

  signal(d: RtcSignal): void {
    this.send({ t: "signal", d });
  }

  /** GO of the running match in local Date.now() time, or null */
  goAtLocal(): number | null {
    const m = this.store.get().room?.match;
    return m ? this.clock.toLocal(m.at) : null;
  }

  close(): void {
    this.stopped = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    clearInterval(this.pingTimer);
    this.ws?.close(1000, "leave");
    this.ws = null;
    this.store.update({ status: "closed" });
  }
}
