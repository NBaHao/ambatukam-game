// Ties the game engine to a PvP room:
//   hands set (engine "waiting")  → ready
//   server starts the match        → engine counts down to the shared GO
//   playing                        → live stroke count every 250 ms
//   engine finishes                → final run (the server decides the winner)
import { initAudio } from "../game/audio";
import type { GameEngine, Phase } from "../game/GameEngine";
import type { RunResult } from "../game/types";
import type { RoomClient, RoomView } from "./RoomClient";

const PROGRESS_EVERY_MS = 250;

/** Local Date.now() time → performance.now() time (what the engine schedules with) */
const toPerf = (localMs: number) => performance.now() + (localMs - Date.now());

let sessions = 0;

export class PvpSession {
  /** Unique per session: React keys for things that live as long as the session */
  readonly id = ++sessions;
  private unsubs: (() => void)[] = [];
  private progressTimer = 0;
  private startedRound = 0;
  private begun = false;
  private ready = false;
  /** Round whose result we already sent */
  finalRound = 0;

  private readonly engine: GameEngine;
  readonly client: RoomClient;

  constructor(engine: GameEngine, client: RoomClient) {
    this.engine = engine;
    this.client = client;
  }

  /** Connect and drive the engine. Can run again after dispose() (StrictMode re-runs effects). */
  start(): void {
    this.begun = false;
    this.startedRound = 0;
    this.ready = false;
    this.engine.setStartGate(true);
    this.unsubs.push(this.client.store.subscribe(() => this.onRoom(this.client.store.get())));
    let phase = this.engine.phase;
    this.unsubs.push(
      this.engine.ui.subscribe(() => {
        const next = this.engine.phase;
        if (next !== phase) this.onPhase(phase, (phase = next));
      }),
    );
    this.client.open();
  }

  private onRoom(view: RoomView): void {
    const room = view.room;
    if (!room) return;
    // First snapshot: the room's mode decides the camera setup (single = 1 hand, double = 2)
    if (!this.begun) {
      this.begun = true;
      void this.engine.begin({ mode: room.mode, duration: room.duration as 10 | 20 | 30 });
    }
    const m = room.match;
    if (m && m.round !== this.startedRound && this.engine.phase === "waiting") {
      this.startedRound = m.round;
      this.ready = false;
      this.engine.startCountdownAt(toPerf(this.client.clock.toLocal(m.at)));
    }
  }

  private onPhase(prev: Phase, next: Phase): void {
    if (next === "playing") {
      clearInterval(this.progressTimer);
      this.progressTimer = window.setInterval(() => this.client.progress(this.engine.run.count), PROGRESS_EVERY_MS);
    } else if (prev === "playing") {
      clearInterval(this.progressTimer);
    }
    // Left the waiting state without a match (went back home…): not ready any more
    if (prev === "waiting" && next !== "countdown" && this.ready) {
      this.ready = false;
      this.client.setReady(false);
    }
  }

  /** Engine: hands are set */
  onSet(): void {
    this.ready = true;
    this.client.setReady(true);
    // The match may already be scheduled (opponent was ready first and our ready raced it)
    this.onRoom(this.client.store.get());
  }

  /** Engine: the run is over */
  onFinish(run: RunResult): void {
    clearInterval(this.progressTimer);
    this.finalRound = this.startedRound;
    this.client.progress(run.count);
    this.client.final({
      strokes: run.count,
      bins: run.bins,
      fps: run.fps,
      grip: run.grip,
      ...(run.mode === "double" ? { split: run.split } : {}),
    });
  }

  /** Rematch from the result screen: set the hands again, then ready */
  rematch(): void {
    void initAudio();
    this.engine.replay();
  }

  dispose(): void {
    clearInterval(this.progressTimer);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.client.close();
    this.engine.setStartGate(false);
  }
}
