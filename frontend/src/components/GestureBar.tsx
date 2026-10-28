import type { GestureKey } from "../game/GameEngine";
import { useI18n } from "../i18n/context";
import { Rich } from "../i18n/Rich";
import "./GestureBar.css";

export function GestureBar({ gesture, progress }: { gesture: GestureKey; progress: number }) {
  const { t } = useI18n();
  return (
    <div className="gesture" role="status">
      <div>
        <Rich text={t(gesture)} />
      </div>
      <div className="gbar">
        <div className="gbar-fill" style={{ width: `${(progress * 100).toFixed(0)}%` }} />
      </div>
    </div>
  );
}
