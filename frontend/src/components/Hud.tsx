import { useEffect, useRef } from "react";
import type { GameEngine } from "../game/GameEngine";
import { useStore } from "../hooks/useStore";
import { useI18n } from "../i18n/context";
import "./Hud.css";

/** Đồng hồ, cảnh báo và số nhát khi đang chơi */
export function Hud({ engine }: { engine: GameEngine }) {
  const { t } = useI18n();
  const { time, count, split, status } = useStore(engine.hud);
  const countRef = useRef<HTMLDivElement>(null);

  // Nảy nhẹ mỗi nhát
  useEffect(() => {
    if (count > 0) {
      countRef.current?.animate([{ transform: "scale(1)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }], {
        duration: 120,
        easing: "ease-out",
      });
    }
  }, [count]);

  return (
    <div className="hud">
      <div className="hud-timer">{time.toFixed(1)}</div>
      {status && <div className="hud-status">{t(status)}</div>}
      <div className="hud-count" ref={countRef}>
        <span>{count}</span>
        <small>{t("strokes")}</small>
        {split && <span className="hud-split">{`${split[0]} + ${split[1]}`}</span>}
      </div>
    </div>
  );
}
