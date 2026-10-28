import { useEffect, useState, type RefObject } from "react";
import { GameEngine } from "../game/GameEngine";

/** Một engine cho cả vòng đời component, gắn vào <video> + <canvas> khi mount */
export function useGameEngine(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options?: { debug?: boolean },
): GameEngine {
  const [engine] = useState(() => new GameEngine(options));
  useEffect(() => {
    engine.mount(videoRef.current!, canvasRef.current!);
    return () => engine.unmount();
  }, [engine, videoRef, canvasRef]);
  return engine;
}
