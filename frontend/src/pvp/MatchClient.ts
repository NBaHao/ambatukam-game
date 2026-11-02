// Random opponent: a lobby socket of its own (guests can search too) that waits in the queue for one
// board until the lobby pairs it, then hands over the new room's ticket. Pure TS: React reads `store`.
import { api } from "../api/client";
import { lobbySocketUrl } from "../friends/FriendsHub";
import type { LobbyServerMessage } from "../friends/protocol";
import { Store } from "../game/Store";
import { playerId } from "../lib/storage";
import type { PvpMode } from "./protocol";

export interface MatchView {
  status: "idle" | "searching" | "error";
  /** Search start (Date.now()), for the elapsed time */
  since: number;
}

export interface Match {
  code: string;
  ticket: string;
}

const HEARTBEAT_MS = 30_000;

export class MatchClient {
  readonly store = new Store<MatchView>({ status: "idle", since: 0 });
  private ws: WebSocket | null = null;
  private gen = 0;
  private timers: number[] = [];

  /** Search until matched or cancel(); the ticket request throws on name problems (name_taken…) */
  async find(name: string, mode: PvpMode, duration: number, onMatched: (m: Match) => void): Promise<void> {
    this.cancel();
    const gen = this.gen;
    const ticket = await api.lobbyTicket({ pid: playerId(), name });
    if (gen !== this.gen) return;
    this.store.update({ status: "searching", since: Date.now() });
    this.connect(gen, ticket, mode, duration, onMatched, 0);
  }

  private connect(
    gen: number,
    ticket: string,
    mode: PvpMode,
    duration: number,
    onMatched: (m: Match) => void,
    retries: number,
  ): void {
    if (gen !== this.gen) return;
    const ws = new WebSocket(lobbySocketUrl(ticket));
    this.ws = ws;
    let beat = 0;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "queue", mode, duration }));
      beat = window.setInterval(() => ws.send(JSON.stringify({ t: "hb" })), HEARTBEAT_MS);
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws || typeof e.data !== "string") return;
      const msg = JSON.parse(e.data) as LobbyServerMessage;
      if (msg.t === "matched") {
        this.cancel();
        onMatched({ code: msg.code, ticket: msg.ticket });
      } else if (msg.t === "error" && msg.code === "slow_down") {
        this.later(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: "queue", mode, duration })), 1200);
      }
    };
    ws.onclose = () => {
      clearInterval(beat);
      if (this.ws !== ws) return;
      this.ws = null;
      if (retries >= 6) return this.store.update({ status: "error" });
      // Lost the connection: back into the queue (at the end of it)
      this.later(() => this.connect(gen, ticket, mode, duration, onMatched, retries + 1), 1000 * 2 ** retries);
    };
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  cancel(): void {
    this.gen++;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    const ws = this.ws;
    this.ws = null;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "unqueue" }));
    ws?.close(1000, "cancel");
    this.store.update({ status: "idle", since: 0 });
  }
}
