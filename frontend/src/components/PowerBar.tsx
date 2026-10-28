import type { CSSProperties } from "react";
import type { GameEngine } from "../game/GameEngine";
import type { Mode } from "../game/types";
import { useStore } from "../hooks/useStore";
import { useI18n } from "../i18n/context";
import "./PowerBar.css";

export function PowerBar({ engine, mode }: { engine: GameEngine; mode: Mode }) {
  const { t } = useI18n();
  const { powerPct, powerValue, heat, maxed, low, marker } = useStore(engine.hud);
  const cls = ["power-bar", maxed && "maxed", low && "low"].filter(Boolean).join(" ");
  return (
    <aside className="power">
      <div className="power-label">{t(mode === "random" ? "heat" : "power")}</div>
      <div className={cls}>
        <div className="power-fill" style={{ "--pct": `${(powerPct * 100).toFixed(1)}%` } as CSSProperties} />
        <div
          className={marker === null ? "power-hand" : "power-hand on"}
          style={marker === null ? undefined : { top: `calc(${(marker * 100).toFixed(1)}% - 1px)` }}
        />
      </div>
      <div className="power-value">
        <span>{heat ? powerValue : powerValue.toFixed(1)}</span>
        <small>{heat ? "%" : t("perSec")}</small>
      </div>
    </aside>
  );
}
