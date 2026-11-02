// Friends of the logged-in account: the list (REST) and the lobby socket (/api/lobby/ws) that says
// which friends are online and carries PvP invites. Pure TS like RoomClient: React reads `store`.
// Keeps reconnecting while logged in; every connection gets a fresh ticket.
import { ApiError, api } from "../api/client";
import type { FriendsResponse, Relation } from "../api/types";
import { config } from "../config";
import { Store } from "../game/Store";
import { playerId } from "../lib/storage";
import type { PvpMode } from "../pvp/protocol";
import type { LobbyClientMessage, LobbyServerMessage } from "./protocol";

export interface Invite {
  from: string;
  code: string;
  mode: PvpMode;
  duration: number;
}

/** An invite I sent from a room: pending until the lobby acks it */
export interface SentInvite {
  to: string;
  code: string;
  state: "pending" | "sent" | "declined" | "failed";
  error?: string;
}

export interface FriendsView {
  status: "off" | "connecting" | "open" | "reconnecting";
  list: FriendsResponse | null;
  /** Friends online right now, A to Z */
  online: string[];
  invites: Invite[];
  sent: SentInvite[];
}

const HEARTBEAT_MS = 30_000;
const INVITE_TTL_MS = 90_000;
const MAX_INVITES = 4;

const OFF: FriendsView = { status: "off", list: null, online: [], invites: [], sent: [] };

export function lobbySocketUrl(ticket: string): string {
  const base = new URL(config.apiBaseUrl || location.origin, location.href);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/api/lobby/ws";
  base.search = new URLSearchParams({ ticket }).toString();
  return base.toString();
}

export class FriendsHub {
  readonly store = new Store<FriendsView>(OFF);

  private username: string | null = null;
  private ws: WebSocket | null = null;
  /** Bumped on every start/stop: late callbacks of an old session do nothing */
  private gen = 0;
  private retries = 0;
  private timers: number[] = [];
  private beat = 0;

  start(username: string): void {
    if (this.username === username) return;
    this.stop();
    this.username = username;
    this.store.update({ status: "connecting" });
    void this.refresh();
    void this.connect(this.gen);
  }

  stop(): void {
    this.gen++;
    this.username = null;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    clearInterval(this.beat);
    this.ws?.close(1000, "logout");
    this.ws = null;
    this.retries = 0;
    this.store.update(OFF);
  }

  /** Reload the friend list (after changes, or when the other side says it changed) */
  async refresh(): Promise<void> {
    const gen = this.gen;
    try {
      const list = await api.friends();
      if (gen === this.gen) this.store.update({ list });
    } catch {
      // keep the old list; the next change or reconnect loads it again
    }
  }

  private async connect(gen: number): Promise<void> {
    if (gen !== this.gen || !this.username) return;
    let ticket: string;
    try {
      ticket = await api.lobbyTicket({ pid: playerId(), name: this.username });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return this.stop(); // logged out elsewhere
      return this.retry(gen);
    }
    if (gen !== this.gen) return;
    const ws = new WebSocket(lobbySocketUrl(ticket));
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retries = 0;
      this.store.update({ status: "open" });
      clearInterval(this.beat);
      this.beat = window.setInterval(() => this.send({ t: "hb" }), HEARTBEAT_MS);
    };
    ws.onmessage = (e) => {
      if (this.ws === ws && typeof e.data === "string") this.onMessage(JSON.parse(e.data) as LobbyServerMessage);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearInterval(this.beat);
      this.store.update({ online: [] });
      this.retry(gen);
    };
  }

  private retry(gen: number): void {
    if (gen !== this.gen) return;
    this.store.update({ status: "reconnecting" });
    const delay = Math.min(30_000, 1000 * 2 ** this.retries++);
    this.later(() => void this.connect(gen), delay);
  }

  private onMessage(msg: LobbyServerMessage): void {
    const view = this.store.get();
    switch (msg.t) {
      case "hello":
        this.store.update({ online: [...msg.online].sort() });
        break;
      case "online": {
        const rest = view.online.filter((u) => u !== msg.user);
        this.store.update({ online: msg.on ? [...rest, msg.user].sort() : rest });
        break;
      }
      case "invite": {
        const { t: _, ...inv } = msg;
        const others = view.invites.filter((i) => i.code !== inv.code && i.from !== inv.from);
        this.store.update({ invites: [...others, inv].slice(-MAX_INVITES) });
        this.later(() => this.dismiss(inv.code), INVITE_TTL_MS);
        break;
      }
      case "invited":
        this.markSent((s) => s.to === msg.to && s.code === msg.code, { state: "sent" });
        break;
      case "declined":
        this.markSent((s) => s.to === msg.by && s.code === msg.code, { state: "declined" });
        break;
      case "friends_changed":
        void this.refresh().then(() => this.send({ t: "sync" }));
        break;
      case "error":
        // The only lobby errors answer an invite: it failed
        this.markSent((s) => s.state === "pending", { state: "failed", error: msg.code });
        break;
    }
  }

  private markSent(match: (s: SentInvite) => boolean, patch: Partial<SentInvite>): void {
    const sent = this.store.get().sent;
    const i = sent.findLastIndex(match);
    if (i < 0) return;
    this.store.update({ sent: sent.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  }

  private send(msg: LobbyClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  // ---------- actions ----------

  /** Invite an online friend to my room */
  invite(to: string, code: string, mode: PvpMode, duration: number): void {
    const others = this.store.get().sent.filter((s) => !(s.to === to && s.code === code));
    const ok = this.send({ t: "invite", to, code, mode, duration });
    const entry: SentInvite = ok ? { to, code, state: "pending" } : { to, code, state: "failed", error: "network" };
    this.store.update({ sent: [...others, entry].slice(-20) });
  }

  decline(inv: Invite): void {
    this.send({ t: "decline", to: inv.from, code: inv.code });
    this.dismiss(inv.code);
  }

  dismiss(code: string): void {
    this.store.update({ invites: this.store.get().invites.filter((i) => i.code !== code) });
  }

  /** Send a request / accept one. Tells the other side so their list updates too */
  async add(username: string): Promise<Relation> {
    const rel = await api.addFriend(username);
    await this.changed(username);
    return rel;
  }

  /** Unfriend, cancel or decline */
  async remove(username: string): Promise<void> {
    await api.removeFriend(username);
    await this.changed(username);
  }

  private async changed(username: string): Promise<void> {
    await this.refresh();
    this.send({ t: "nudge", to: username });
    this.send({ t: "sync" }); // a new friend may already be online
  }
}
