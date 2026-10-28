import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { LeaderboardResponse } from "../api/types";
import { DURATIONS, MODES, isTimed, type Duration, type Mode } from "../game/types";
import { useI18n } from "../i18n/context";
import { formatBoardScore } from "../lib/scoring";
import { modeName } from "../lib/share";
import { playerId } from "../lib/storage";
import { SegmentedControl } from "./SegmentedControl";
import "./Leaderboard.css";

interface Props {
  initialMode: Mode;
  initialDuration: Duration;
  onBack: () => void;
}

type Loaded = { key: string; data: LeaderboardResponse | "error" };

export function Leaderboard({ initialMode, initialDuration, onBack }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState(initialMode);
  const [duration, setDuration] = useState(initialDuration);
  const d = isTimed(mode) ? duration : 0;
  const key = `${mode}:${d}`;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    api
      .leaderboard({ mode, duration: d, pid: playerId() }, ctl.signal)
      .then((data) => setLoaded({ key, data }))
      .catch(() => {
        if (!ctl.signal.aborted) setLoaded({ key, data: "error" });
      });
    return () => ctl.abort();
  }, [mode, d, key]);

  // Kết quả của tab cũ coi như đang tải
  const data = loaded?.key === key ? loaded.data : null;
  const score = (s: number) => formatBoardScore(s, mode, d);
  const entries = data && data !== "error" ? data.entries : [];
  const me = data && data !== "error" && data.me && !entries.some((e) => e.me) ? data.me : null;

  return (
    <div className="screen screen-board">
      <h2>{t("board")}</h2>
      <SegmentedControl
        label={t("board")}
        options={MODES.map((m) => ({ value: m, label: modeName(t, m) }))}
        value={mode}
        onChange={setMode}
      />
      <SegmentedControl
        label="Duration"
        options={DURATIONS.map((v) => ({ value: v, label: `${v}s` }))}
        value={duration}
        onChange={setDuration}
        ghost={!isTimed(mode)}
      />
      <ol className="board" aria-busy={!data}>
        {entries.length ? (
          entries.map((e, i) => (
            <li key={`${i}-${e.name}`} className={e.me ? "me" : undefined}>
              <span className="rk">{i + 1}</span>
              <span className="nm">{e.name}</span>
              <span className="sc">{score(e.score)}</span>
              <span className="ct">{t("strokesN", e.strokes)}</span>
            </li>
          ))
        ) : (
          <li className="note">{t(!data ? "boardLoading" : data === "error" ? "boardErr" : "boardEmpty")}</li>
        )}
      </ol>
      <p className="best">{me ? t("boardMe", me.rank, me.total, score(me.score)) : ""}</p>
      <button type="button" className="btn" onClick={onBack}>
        {t("back")}
      </button>
    </div>
  );
}
