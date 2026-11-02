// Video / voice with the PvP opponent over WebRTC. Pure TS: React reads `store`.
//
// Consent: each player opts in to camera and/or voice (RoomClient.setMedia); a kind of media only
// flows when BOTH opted in to it (the room also refuses to relay signaling otherwise). Until then
// each side sees the other's mascot. With TURN the connection is relay-only, so neither player
// learns the other's IP address.
//
// One peer connection per agreement: whenever what both agreed on changes, seat 0 builds a new one
// (new `sid`) and sends an offer; seat 1 answers. Signals of an older `sid` are ignored.
import { api } from "../api/client";
import { Store } from "../game/Store";
import type { RoomSnapshot, RtcSignal } from "./protocol";
import type { RoomClient } from "./RoomClient";

export interface RtcView {
  /** null: still asking the server; false: no TURN service, the toggles stay hidden */
  available: boolean | null;
  /** What I opted in to */
  cam: boolean;
  mic: boolean;
  /** Microphone permission denied / no mic */
  micError: boolean;
  /** Opponent's media (video and / or audio tracks), null when nothing flows */
  remote: MediaStream | null;
  link: "off" | "connecting" | "connected" | "failed";
}

// Small video: enough for a face in a corner tile, cheap on the TURN relay
const VIDEO_MAX_BITRATE = 350_000;
const VIDEO_MAX_FPS = 24;

interface Agreement {
  cam: boolean;
  mic: boolean;
}

function agreement(room: RoomSnapshot | null | undefined): Agreement {
  const me = room?.players.find((p) => p.seat === room.you);
  const opp = room?.players.find((p) => p.seat !== room.you && p.connected);
  return { cam: Boolean(me?.cam && opp?.cam), mic: Boolean(me?.mic && opp?.mic) };
}

export class RtcLink {
  readonly store = new Store<RtcView>({
    available: null,
    cam: false,
    mic: false,
    micError: false,
    remote: null,
    link: "off",
  });

  private pc: RTCPeerConnection | null = null;
  private sid = 0;
  private agreed = "";
  private ice: RTCConfiguration | null = null;
  private micStream: MediaStream | null = null;
  private pendingCands: RTCIceCandidateInit[] = [];
  private unsubscribe: (() => void) | null = null;
  private stopped = false;

  private readonly client: RoomClient;
  /** The game's camera stream (already open for hand tracking) */
  private readonly camera: () => MediaStream | null;

  constructor(client: RoomClient, camera: () => MediaStream | null) {
    this.client = client;
    this.camera = camera;
  }

  start(): void {
    this.stopped = false;
    this.client.onSignal = (d) => void this.onSignal(d);
    this.unsubscribe = this.client.store.subscribe(() => this.reconcile());
    if (this.store.get().available === null) {
      api
        .roomIce(this.client.code, this.client.ticket)
        .then((r) => {
          this.ice = { iceServers: r.ice_servers, iceTransportPolicy: r.relay ? "relay" : "all" };
          if (!this.stopped) this.store.update({ available: true });
          this.reconcile();
        })
        .catch(() => this.store.update({ available: false }));
    }
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.client.onSignal = null;
    this.close();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
  }

  /** Opt in / out. Turning the mic on asks for permission (call it from a click) */
  async setMedia(cam: boolean, mic: boolean): Promise<void> {
    let micError = false;
    if (mic && !this.micStream) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
      } catch {
        mic = false;
        micError = true;
      }
    }
    if (!mic && this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.stopped) return;
    this.store.update({ cam, mic, micError });
    this.client.setMedia(cam, mic);
  }

  private reconcile(): void {
    if (this.stopped || !this.ice) return;
    const room = this.client.store.get().room;
    const a = agreement(room);
    const key = `${a.cam}${a.mic}${Boolean(this.camera())}`;
    if (key === this.agreed) return;
    this.agreed = key;
    this.close();
    if ((!a.cam && !a.mic) || !room) return;
    if (room.you === 0) void this.offer(a);
    else this.store.update({ link: "connecting" }); // seat 1 waits for the offer
  }

  private close(): void {
    this.pc?.close();
    this.pc = null;
    this.pendingCands = [];
    this.store.update({ remote: null, link: "off" });
  }

  /** A peer connection sending what was agreed (and what I still opt in to) */
  private build(sid: number, kinds: Agreement): RTCPeerConnection {
    const pc = new RTCPeerConnection(this.ice ?? undefined);
    this.pc = pc;
    this.sid = sid;
    const mine = this.store.get();
    const cam = this.camera()?.getVideoTracks()[0];
    if (kinds.cam && mine.cam && cam) {
      const sender = pc.addTrack(cam);
      const params = sender.getParameters();
      params.encodings = [{ maxBitrate: VIDEO_MAX_BITRATE, maxFramerate: VIDEO_MAX_FPS }];
      void sender.setParameters(params).catch(() => {});
    } else if (kinds.cam) pc.addTransceiver("video", { direction: "recvonly" });
    const mic = this.micStream?.getAudioTracks()[0];
    if (kinds.mic && mine.mic && mic) pc.addTrack(mic);
    else if (kinds.mic) pc.addTransceiver("audio", { direction: "recvonly" });

    pc.onicecandidate = (e) => {
      if (e.candidate && this.pc === pc) this.client.signal({ sid, type: "cand", cand: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      if (this.pc !== pc) return;
      const tracks = [...(this.store.get().remote?.getTracks() ?? []), e.track];
      this.store.update({ remote: new MediaStream(tracks) });
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      const s = pc.connectionState;
      this.store.update({ link: s === "connected" ? "connected" : s === "failed" ? "failed" : "connecting" });
      // Seat 0 tries again with a fresh connection after a failure
      if (s === "failed" && this.client.store.get().room?.you === 0) {
        window.setTimeout(() => {
          if (this.pc !== pc || this.stopped) return;
          this.agreed = "";
          this.reconcile();
        }, 3000);
      }
    };
    this.store.update({ link: "connecting", remote: null });
    return pc;
  }

  private async offer(kinds: Agreement): Promise<void> {
    const pc = this.build(this.sid + 1, kinds);
    const sid = this.sid;
    try {
      await pc.setLocalDescription(await pc.createOffer());
      if (this.pc !== pc) return;
      this.client.signal({ sid, type: "offer", sdp: pc.localDescription!.sdp, ...kinds });
    } catch {
      if (this.pc === pc) this.store.update({ link: "failed" });
    }
  }

  private async onSignal(d: RtcSignal): Promise<void> {
    if (this.stopped || !this.ice) return;
    try {
      if (d.type === "offer") {
        // A new connection from seat 0: drop the old one
        this.pc?.close();
        this.pendingCands = [];
        const pc = this.build(d.sid, { cam: d.cam, mic: d.mic });
        await pc.setRemoteDescription({ type: "offer", sdp: d.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        if (this.pc !== pc) return;
        this.client.signal({ sid: d.sid, type: "answer", sdp: pc.localDescription!.sdp });
        await this.flushCands(pc);
      } else if (d.type === "answer") {
        const pc = this.pc;
        if (!pc || d.sid !== this.sid || pc.signalingState !== "have-local-offer") return;
        await pc.setRemoteDescription({ type: "answer", sdp: d.sdp });
        await this.flushCands(pc);
      } else if (d.sid === this.sid && this.pc) {
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(d.cand);
        else this.pendingCands.push(d.cand);
      }
    } catch {
      this.store.update({ link: "failed" });
    }
  }

  private async flushCands(pc: RTCPeerConnection): Promise<void> {
    const cands = this.pendingCands;
    this.pendingCands = [];
    for (const c of cands) await pc.addIceCandidate(c).catch(() => {});
  }
}
