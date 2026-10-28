import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "./api/client";
import { Countdown } from "./components/Countdown";
import { GestureBar } from "./components/GestureBar";
import { Header } from "./components/Header";
import { Hud } from "./components/Hud";
import { Leaderboard } from "./components/Leaderboard";
import { PowerBar } from "./components/PowerBar";
import { ReadyScreen } from "./components/ReadyScreen";
import { ResultDialog, type FinishedRun } from "./components/ResultDialog";
import { StartScreen } from "./components/StartScreen";
import { ambatu, ambatukamFinish } from "./game/audio";
import { MODES, isTimed, type Duration, type Mode } from "./game/types";
import { useGameEngine } from "./hooks/useGameEngine";
import { useStore } from "./hooks/useStore";
import { summarize } from "./lib/scoring";
import { storage } from "./lib/storage";
import { loadTurnstile } from "./lib/turnstile";

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
  const sessionRef = useRef<Promise<string | null>>(Promise.resolve(null));

  useEffect(() => {
    engine.setHandlers({
      onPlayStart: (cfg) => {
        // Server ghi lại lúc bắt đầu ván; lỗi mạng thì vẫn chơi, chỉ không gửi được điểm
        sessionRef.current = api
          .createSession({ mode: cfg.mode, duration: isTimed(cfg.mode) ? cfg.duration : 0 })
          .catch(() => null);
        loadTurnstile().catch(() => {});
      },
      onFinish: (run) => {
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

  // Đang xem bảng xếp hạng / gõ tên thì không bắt cử chỉ xòe tay
  useEffect(() => {
    engine.setGesturesEnabled(view === "game" && !typing);
  }, [engine, view, typing]);

  useEffect(() => {
    if (!DEBUG) return;
    void import("./game/debug").then((m) => m.installDebug(engine, params, { setMode, setDuration }));
  }, [engine]);

  const changeMode = (m: Mode) => {
    setMode(m);
    storage.setMode(m);
  };
  const goHome = useCallback(() => {
    engine.goIdle();
    setView("game");
  }, [engine]);

  const { phase } = ui;
  const showGesture = ui.gesture && (phase === "ready" || phase === "anchor" || phase === "countdown");
  const camStyle = ui.aspect ? ({ "--cam-aspect": ui.aspect } as CSSProperties) : undefined;

  return (
    <>
      <Header />
      <main className="stage">
        <section className="cam-wrap" style={camStyle}>
          <video ref={videoRef} className="cam-video" playsInline muted />
          <canvas ref={canvasRef} className="cam-overlay" />

          {view === "board" ? (
            <Leaderboard
              initialMode={finished && phase === "result" ? finished.run.mode : mode}
              initialDuration={finished && phase === "result" ? finished.run.duration : duration}
              onBack={() => setView("game")}
            />
          ) : (
            <>
              {showGesture && <GestureBar gesture={ui.gesture!} progress={ui.gestureProgress} />}
              {phase === "idle" && (
                <StartScreen
                  mode={mode}
                  duration={duration}
                  onModeChange={changeMode}
                  onDurationChange={setDuration}
                  onStart={() => void engine.begin({ mode, duration })}
                  onOpenBoard={() => setView("board")}
                />
              )}
              {phase === "ready" && <ReadyScreen boot={ui.boot} />}
              {phase === "countdown" && <Countdown text={ui.countdown} />}
              {phase === "playing" && <Hud engine={engine} />}
            </>
          )}
        </section>
        <PowerBar engine={engine} mode={mode} />
      </main>

      {finished && (
        <ResultDialog
          key={finished.id}
          finished={finished}
          open={phase === "result" && view === "game"}
          replayProgress={ui.replayProgress}
          onAgain={() => engine.replay()}
          onClose={goHome}
          onOpenBoard={() => setView("board")}
          onTypingChange={setTyping}
          forceCelebrate={DEBUG && params.get("auto") === "top10"}
        />
      )}

      {DEBUG && (
        <Suspense>
          <DiagOverlay engine={engine} />
        </Suspense>
      )}
    </>
  );
}
