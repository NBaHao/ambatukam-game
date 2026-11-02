import { useEffect, useState, type FormEvent } from "react";
import { useAccount } from "../account/context";
import { ApiError, api } from "../api/client";
import { SegmentedControl } from "../components/SegmentedControl";
import { initAudio } from "../game/audio";
import { DURATIONS, type Duration } from "../game/types";
import { useI18n } from "../i18n/context";
import { Rich } from "../i18n/Rich";
import type { TextKey } from "../i18n/strings";
import { navigate, roomPath } from "../lib/route";
import { playerId, storage } from "../lib/storage";
import { useStore } from "../hooks/useStore";
import { MatchClient } from "./MatchClient";
import type { PvpMode } from "./protocol";
import "./Pvp.css";

interface Props {
  /** host: pick mode and create a link; join: opened a challenge link */
  kind: "host" | "join";
  code?: string;
  /** host: the friend being challenged (App sends the invite once the room exists) */
  inviteTo?: string;
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
export function PvpLobby(props: Props) {
  const { kind, code, inviteTo, initialMode, initialDuration, onOpen, onCancel, onLogin, onTypingChange } = props;
  const { t } = useI18n();
  const { user } = useAccount();
  const [mode, setMode] = useState<PvpMode>(initialMode);
  const [duration, setDuration] = useState<Duration>(initialDuration);
  const [typedName, setName] = useState(guestName);
  const name = user?.username ?? typedName.trim();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TextKey | null>(null);
  const [matcher] = useState(() => new MatchClient());
  const search = useStore(matcher.store);
  const [now, setNow] = useState(() => Date.now());
  const searching = search.status === "searching";
  useEffect(() => () => matcher.cancel(), [matcher]);
  useEffect(() => {
    if (!searching) return;
    const iv = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(iv);
  }, [searching]);

  /** Random opponent: wait in the lobby queue, then enter the room it made for both */
  const find = async () => {
    if (!name || busy) return;
    void initAudio();
    setBusy(true);
    setError(null);
    try {
      await matcher.find(name, mode, duration, ({ code, ticket }) => {
        navigate(roomPath(code));
        onOpen(code, ticket);
      });
      if (!user) storage.setName(name);
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  };

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

  if (searching) {
    const sec = Math.max(0, Math.floor((now - search.since) / 1000));
    const clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    return (
      <div className="screen pvp-lobby" role="status">
        <h2>{t("pvpTitle")}</h2>
        <p className="pvp-searching">{t("pvpSearching", clock)}</p>
        <p className="pvp-room">{t("pvpRoomLine", t(mode === "single" ? "modeSingle" : "modeDouble"), duration)}</p>
        <p className="fine">{t("pvpSearchHint")}</p>
        <button type="button" className="btn" onClick={() => matcher.cancel()}>
          {t("frCancel")}
        </button>
      </div>
    );
  }

  return (
    <form className="screen pvp-lobby" onSubmit={(e) => void go(e)}>
      <h2>{t(kind === "host" ? "pvpTitle" : "pvpChallenged")}</h2>
      <p className="sub">{inviteTo ? <Rich text={t("frChallengeHint", inviteTo)} /> : t("pvpDesc")}</p>
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
      {kind === "host" && !inviteTo && (
        <button type="button" className="btn" disabled={busy || !name} onClick={() => void find()}>
          {t("pvpFind")}
        </button>
      )}
      <p className="submit-msg" role="status" aria-live="polite">
        {error ? t(error) : search.status === "error" ? t("pvpSearchErr") : ""}
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
