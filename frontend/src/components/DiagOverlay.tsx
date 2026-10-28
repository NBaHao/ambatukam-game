import type { GameEngine } from "../game/GameEngine";
import { useStore } from "../hooks/useStore";

/** Dòng chẩn đoán (delegate, fps, số tay) khi mở trang với ?debug */
export function DiagOverlay({ engine }: { engine: GameEngine }) {
  const { text } = useStore(engine.diagText);
  return <pre className="diag">{text}</pre>;
}
