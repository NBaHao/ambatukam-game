import { DURATIONS, MODES, isTimed, type Duration, type Mode } from "../game/types";
import { useI18n } from "../i18n/context";
import type { TextKey } from "../i18n/strings";
import { storage } from "../lib/storage";
import { SegmentedControl } from "./SegmentedControl";
import "./StartScreen.css";

const MODE_TEXT: Record<Mode, { name: TextKey; desc: TextKey; sub: TextKey }> = {
  single: { name: "modeSingle", desc: "modeSingleDesc", sub: "subSingle" },
  double: { name: "modeDouble", desc: "modeDoubleDesc", sub: "subDouble" },
  random: { name: "modeRandom", desc: "modeRandomDesc", sub: "subRandom" },
};

interface Props {
  mode: Mode;
  duration: Duration;
  onModeChange: (mode: Mode) => void;
  onDurationChange: (duration: Duration) => void;
  onStart: () => void;
  onOpenBoard: () => void;
}

export function StartScreen({ mode, duration, onModeChange, onDurationChange, onStart, onOpenBoard }: Props) {
  const { t } = useI18n();
  const best = storage.getBest(mode, duration);
  const bestLine = !best ? "" : isTimed(mode) ? t("bestLine", best, duration) : t("bestLineRandom", best);

  return (
    <div className="screen screen-start">
      <h1>{t("title")}</h1>
      <div className="modes">
        {MODES.map((m) => (
          <button key={m} type="button" className={m === mode ? "active" : undefined} onClick={() => onModeChange(m)}>
            <b>{t(MODE_TEXT[m].name)}</b>
            <span>{t(MODE_TEXT[m].desc)}</span>
          </button>
        ))}
        {(["modeRank", "modePvp"] as const).map((k) => (
          <button key={k} type="button" disabled>
            <b>{t(k)}</b>
            <span>{t("soon")}</span>
          </button>
        ))}
      </div>
      <p className="sub">{t(MODE_TEXT[mode].sub)}</p>
      <SegmentedControl
        label="Duration"
        options={DURATIONS.map((d) => ({ value: d, label: `${d}s` }))}
        value={duration}
        onChange={onDurationChange}
        ghost={!isTimed(mode)}
      />
      <button type="button" className="btn primary" onClick={onStart}>
        {t("start")}
      </button>
      <button type="button" className="link" onClick={onOpenBoard}>
        {t("board")}
      </button>
      <p className="best best-line">{bestLine}</p>
      <p className="fine">{t("fine")}</p>
    </div>
  );
}
