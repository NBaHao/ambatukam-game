import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useAccount } from "./account/context";
import { api } from "./api/client";
import { AccountDialog } from "./components/AccountDialog";
import { ResetDialog } from "./components/ResetDialog";
import { Countdown } from "./components/Countdown";
import { GestureBar } from "./components/GestureBar";
import { Header } from "./components/Header";
import { Hud } from "./components/Hud";
import { Leaderboard } from "./components/Leaderboard";
import { PowerBar } from "./components/PowerBar";
import { Profile } from "./components/Profile";
import { ReadyScreen } from "./components/ReadyScreen";
import { ResultDialog, type FinishedRun } from "./components/ResultDialog";
import { StartScreen } from "./components/StartScreen";
import { FriendsDialog } from "./friends/FriendsDialog";
import { InviteToasts } from "./friends/InviteToasts";
import { ambatu, ambatukamFinish } from "./game/audio";
import { MODES, isTimed, type Duration, type Mode } from "./game/types";
import { useGameEngine } from "./hooks/useGameEngine";
import { useStore } from "./hooks/useStore";
import { summarize } from "./lib/scoring";
import { storage } from "./lib/storage";
import { loadTurnstile } from "./lib/turnstile";
import { navigate, roomPath, useRoute } from "./lib/route";
import { PvpBar } from "./pvp/PvpBar";
import { PvpLobby } from "./pvp/PvpLobby";
import { PvpMedia } from "./pvp/PvpMedia";
import { PvpResult } from "./pvp/PvpResult";
import type { PvpMode } from "./pvp/protocol";
import { usePvp } from "./pvp/usePvp";

// Chế độ debug chỉ có khi chạy local (vite dev): ?debug&auto=result|play&mode=…
const params = new URLSearchParams(location.search);
const DEBUG = import.meta.env.DEV && params.has("debug");
const DiagOverlay = lazy(() => import("./components/DiagOverlay").then((m) => ({ default: m.DiagOverlay })));

const isMode = (v: string | null): v is Mode => MODES.includes(v as Mode);

function initialMode(): Mode {
  const fromUrl = import.meta.env.DEV ? params.get("mode") : null;
  if (isMode(fromUrl)) return fromUrl;
  const saved = storage.getMode();
  return isMode(saved) ? saved : "single";
}

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useGameEngine(videoRef, canvasRef, { debug: DEBUG });
  const ui = useStore(engine.ui);

  const [mode, setMode] = useState(initialMode);
  const [duration, setDuration] = useState<Duration>(20);
  const [view, setView] = useState<"game" | "board">("game");
  const [finished, setFinished] = useState<FinishedRun | null>(null);
  const [typing, setTyping] = useState(false);
  const account = useAccount();
  const [accountOpen, setAccountOpen] = useState(false);
  // Each open mounts a fresh dialog (new key): it starts on the right step, no flash of the last one
  const [accountKey, setAccountKey] = useState(0);
  const openAccount = useCallback(() => {
    setAccountKey((k) => k + 1);
    setAccountOpen(true);
  }, []);
  // Lần đầu vào game (khách): hỏi username như TETR.IO, để trống là chơi khách
  const [welcomeDone, setWelcomeDone] = useState(false);
  const sessionRef = useRef<Promise<string | null>>(Promise.resolve(null));

  // PvP: /c/<code> opens a room; the start screen's PvP button opens the host lobby
  const route = useRoute();
  // Only on the home page: someone opening a challenge or profile link came for that, not to sign up
  const showAccount = accountOpen || (account.welcome && !welcomeDone && !DEBUG && route.name === "home");
  const pvp = usePvp(engine);
  const pvpRef = useRef(pvp.session);
  useEffect(() => {
    pvpRef.current = pvp.session;
  }, [pvp.session]);
  // Host lobby open, maybe to challenge a friend; that friend is invited once the room exists
  const [hostLobby, setHostLobby] = useState<{ invite?: string } | null>(null);
  const [autoInvite, setAutoInvite] = useState<string | undefined>();
  const lobby = pvp.entered ? null : route.name === "room" ? "join" : hostLobby ? "host" : null;
  const [friendsOpen, setFriendsOpen] = useState(false);
  const closeFriends = useCallback(() => setFriendsOpen(false), []);
  const { leave: leavePvp } = pvp;
  // Back button (or any route change) out of the room: leave it
  useEffect(() => {
    if (route.name !== "room") leavePvp();
  }, [route.name, leavePvp]);
  const exitPvp = useCallback(() => {
    leavePvp();
    setHostLobby(null);
    setAutoInvite(undefined);
    navigate("/");
  }, [leavePvp]);
  const challenge = useCallback(
    (username: string) => {
      if (pvpRef.current) leavePvp();
      engine.goIdle();
      setView("game");
      setHostLobby({ invite: username });
      navigate("/");
    },
    [engine, leavePvp],
  );
  // Accepted a friend's invite: straight into their room
  const joinInvite = useCallback(
    (code: string, ticket: string) => {
      setHostLobby(null);
      setAutoInvite(undefined);
      setView("game");
      navigate(roomPath(code));
      pvp.open(code, ticket);
    },
    [pvp],
  );

  useEffect(() => {
    engine.setHandlers({
      onSet: () => pvpRef.current?.onSet(),
      onPlayStart: (cfg) => {
        if (pvpRef.current) return; // PvP results go to the room, not the leaderboard
        // Server ghi lại lúc bắt đầu ván; lỗi mạng thì vẫn chơi, chỉ không gửi được điểm
        sessionRef.current = api
          .createSession({ mode: cfg.mode, duration: isTimed(cfg.mode) ? cfg.duration : 0 })
          .catch(() => null);
        loadTurnstile().catch(() => {});
      },
      onFinish: (run) => {
        if (pvpRef.current) return pvpRef.current.onFinish(run);
        const prevBest = storage.getBest(run.mode, run.duration);
        if (run.score > prevBest) storage.setBest(run.mode, run.duration, run.score);
        const summary = summarize(run, prevBest);
        const session = sessionRef.current;
        setFinished((prev) => ({ id: (prev?.id ?? 0) + 1, run, summary, session }));
        if (summary.tier >= 3) void ambatukamFinish();
        else if (summary.tier === 2) void ambatu();
      },
    });
  }, [engine]);

  // Đang xem bảng xếp hạng / gõ tên / mở hộp tài khoản thì không bắt cử chỉ xòe tay
  useEffect(() => {
    engine.setGesturesEnabled(
      view === "game" && route.name !== "profile" && route.name !== "reset" && !typing && !showAccount && !friendsOpen && !lobby,
    );
  }, [engine, view, route.name, typing, showAccount, friendsOpen, lobby]);

  useEffect(() => {
    if (!DEBUG) return;
    void import("./game/debug").then((m) => m.installDebug(engine, params, { setMode, setDuration }));
  }, [engine]);

  const changeMode = (m: Mode) => {
    setMode(m);
    storage.setMode(m);
  };
  const closeAccount = useCallback(() => {
    setAccountOpen(false);
    setWelcomeDone(true);
  }, []);
  const goHome = useCallback(() => {
    engine.goIdle();
    setView("game");
  }, [engine]);

  const { phase } = ui;
  const showGesture =
    ui.gesture && (phase === "ready" || phase === "anchor" || phase === "waiting" || phase === "countdown");
  const roomMode = pvp.session?.client.store.get().room?.mode;
  const camera = useCallback(() => {
    const stream = videoRef.current?.srcObject;
    return stream instanceof MediaStream ? stream : null;
  }, []);
  const camStyle = ui.aspect ? ({ "--cam-aspect": ui.aspect } as CSSProperties) : undefined;

  return (
    <>
      <Header onAccount={openAccount} onFriends={() => setFriendsOpen(true)} />
      <main className="stage">
        <section className={pvp.entered ? "cam-wrap pvp" : "cam-wrap"} style={camStyle}>
          <video ref={videoRef} className="cam-video" playsInline muted />
          <canvas ref={canvasRef} className="cam-overlay" />

          {route.name === "profile" ? (
            <Profile key={route.username} username={route.username} onBack={() => navigate("/")} />
          ) : view === "board" ? (
            <Leaderboard
              initialMode={finished && phase === "result" ? finished.run.mode : mode}
              initialDuration={finished && phase === "result" ? finished.run.duration : duration}
              onBack={() => setView("game")}
            />
          ) : (
            <>
              {showGesture && <GestureBar gesture={ui.gesture!} progress={ui.gestureProgress} />}
              {lobby && (
                <PvpLobby
                  key={lobby + (route.name === "room" ? route.code : "")}
                  kind={lobby}
                  code={route.name === "room" ? route.code : undefined}
                  inviteTo={lobby === "host" ? hostLobby?.invite : undefined}
                  initialMode={mode === "double" ? "double" : "single"}
                  initialDuration={duration}
                  onOpen={(code, ticket) => {
                    setAutoInvite(lobby === "host" ? hostLobby?.invite : undefined);
                    setHostLobby(null);
                    pvp.open(code, ticket);
                  }}
                  onCancel={exitPvp}
                  onLogin={openAccount}
                  onTypingChange={setTyping}
                />
              )}
              {pvp.session && (
                <PvpMedia
                  key={pvp.session.id}
                  session={pvp.session}
                  camera={camera}
                  controls={phase !== "countdown" && phase !== "playing"}
                />
              )}
              {pvp.session && (
                <PvpBar session={pvp.session} engine={engine} phase={phase} autoInvite={autoInvite} onLeave={exitPvp} />
              )}
              {phase === "idle" && !lobby && !pvp.entered && (
                <StartScreen
                  mode={mode}
                  duration={duration}
                  onModeChange={changeMode}
                  onDurationChange={setDuration}
                  onStart={() => void engine.begin({ mode, duration })}
                  onOpenBoard={() => setView("board")}
                  onPvp={() => setHostLobby({})}
                />
              )}
              {phase === "ready" && <ReadyScreen boot={ui.boot} />}
              {phase === "countdown" && <Countdown text={ui.countdown} />}
              {phase === "playing" && <Hud engine={engine} />}
            </>
          )}
        </section>
        <PowerBar engine={engine} mode={(roomMode as PvpMode | undefined) ?? mode} />
      </main>

      {finished && (
        <ResultDialog
          key={finished.id}
          finished={finished}
          open={phase === "result" && view === "game" && !pvp.entered}
          replayProgress={ui.replayProgress}
          onAgain={() => engine.replay()}
          onClose={goHome}
          onOpenBoard={() => setView("board")}
          onLogin={openAccount}
          onTypingChange={setTyping}
          forceCelebrate={DEBUG && params.get("auto") === "top10"}
        />
      )}

      {pvp.session && (
        <PvpResult session={pvp.session} engine={engine} open={phase === "result" && view === "game"} onLeave={exitPvp} />
      )}

      <AccountDialog key={accountKey} open={showAccount} onClose={closeAccount} />
      {route.name === "reset" && <ResetDialog key={route.token} token={route.token} />}
      <FriendsDialog open={friendsOpen} onClose={closeFriends} onLogin={openAccount} onChallenge={challenge} />
      {phase !== "countdown" && phase !== "playing" && <InviteToasts onJoin={joinInvite} />}

      {DEBUG && (
        <Suspense>
          <DiagOverlay engine={engine} />
        </Suspense>
      )}
    </>
  );
}
