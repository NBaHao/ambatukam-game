import { useState, type FormEvent } from "react";
import { useAccount } from "../account/context";
import { ApiError, api } from "../api/client";
import { SegmentedControl } from "../components/SegmentedControl";
import { initAudio } from "../game/audio";
import { DURATIONS, type Duration } from "../game/types";
import { useI18n } from "../i18n/context";
import type { TextKey } from "../i18n/strings";
import { navigate, roomPath } from "../lib/route";
import { playerId, storage } from "../lib/storage";
import type { PvpMode } from "./protocol";
import "./Pvp.css";

interface Props {
  /** host: pick mode and create a link; join: opened a challenge link */
  kind: "host" | "join";
  code?: string;
  initialMode: PvpMode;
  initialDuration: Duration;
  onOpen: (code: string, ticket: string) => void;
  onCancel: () => void;
  onLogin: () => void;
  onTypingChange: (typing: boolean) => void;
}

const guestName = () => storage.getName() || `Guest-${Math.floor(1000 + Math.random() * 9000)}`;

function errorKey(err: unknown): TextKey {
  if (err instanceof ApiError) {
    if (err.code === "name_taken") return "submitNameTaken";
    if (err.code === "login_required") return "pvpLoginRequired";
    if (err.code === "rate_limited") return "accErrLimit";
    if (err.code === "invalid_request") return "accErrName";
  }
  return "pvpErrConnect";
}

/** Before entering a room: create a challenge (host) or accept one (join) */
export function PvpLobby({ kind, code, initialMode, initialDuration, onOpen, onCancel, onLogin, onTypingChange }: Props) {
  const { t } = useI18n();
  const { user } = useAccount();
  const [mode, setMode] = useState<PvpMode>(initialMode);
  const [duration, setDuration] = useState<Duration>(initialDuration);
  const [typedName, setName] = useState(guestName);
  const name = user?.username ?? typedName.trim();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TextKey | null>(null);

  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (!name || busy) return;
    void initAudio(); // inside the click: unlocks Web Audio for the countdown
    setBusy(true);
    setError(null);
    try {
      const body = { pid: playerId(), name };
      const res = kind === "host" ? await api.createRoom({ ...body, mode, duration }) : await api.joinRoom(code!, body);
      if (!user) storage.setName(name);
      if (kind === "host") navigate(roomPath(res.code));
      onOpen(res.code, res.ticket);
    } catch (err) {
      setError(errorKey(err));
      setBusy(false);
    }
  };

  const needsLogin = error === "submitNameTaken" || error === "pvpLoginRequired";

  return (
    <form className="screen pvp-lobby" onSubmit={(e) => void go(e)}>
      <h2>{t(kind === "host" ? "pvpTitle" : "pvpChallenged")}</h2>
      <p className="sub">{t("pvpDesc")}</p>
      {kind === "host" && (
        <>
          <SegmentedControl
            label="Mode"
            options={[
              { value: "single" as const, label: t("modeSingle") },
              { value: "double" as const, label: t("modeDouble") },
            ]}
            value={mode}
            onChange={setMode}
          />
          <SegmentedControl
            label="Duration"
            options={DURATIONS.map((d) => ({ value: d, label: `${d}s` }))}
            value={duration}
            onChange={setDuration}
          />
          <p className="fine">{t("pvpModeNote")}</p>
        </>
      )}
      <label className="pvp-name">
        <span>{t("pvpNameLabel")}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          readOnly={Boolean(user)}
          maxLength={20}
          autoComplete="nickname"
          spellCheck={false}
          onFocus={() => onTypingChange(true)}
          onBlur={() => onTypingChange(false)}
        />
      </label>
      <button className="btn primary" disabled={busy || !name}>
        {t(kind === "host" ? "pvpCreate" : "pvpJoin")}
      </button>
      <p className="submit-msg" role="status" aria-live="polite">
        {error ? t(error) : ""}
      </p>
      <div className="row links">
        {needsLogin && !user && (
          <button type="button" className="link" onClick={onLogin}>
            {t("accLogin")}
          </button>
        )}
        <button type="button" className="link" onClick={onCancel}>
          {t("back")}
        </button>
      </div>
    </form>
  );
}
