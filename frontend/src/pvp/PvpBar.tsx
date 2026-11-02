import { useState } from "react";
import type { GameEngine, Phase } from "../game/GameEngine";
import { useStore } from "../hooks/useStore";
import { useI18n, type Translate } from "../i18n/context";
import { Rich } from "../i18n/Rich";
import type { TextKey } from "../i18n/strings";
import { roomPath } from "../lib/route";
import { modeName } from "../lib/share";
import type { RoomView } from "./RoomClient";
import type { PvpSession } from "./PvpSession";
import "./Pvp.css";

const ERRORS: Record<string, TextKey> = {
  room_not_found: "pvpErrNotFound",
  room_full: "pvpErrFull",
  replaced: "pvpErrReplaced",
};

const roomError = (view: RoomView): TextKey | null =>
  view.status === "closed" ? (ERRORS[view.error ?? ""] ?? "pvpErrConnect") : null;

function opponentLine(t: Translate, view: RoomView): string {
  const room = view.room!;
  const opp = room.players.find((p) => p.seat !== room.you);
  if (!opp) return t("pvpWaitJoin");
  if (!opp.connected) return t("pvpOppLeft", opp.name);
  return t(opp.ready || room.match ? "pvpOppReady" : "pvpOppSetting", opp.name);
}

function InviteLink({ code }: { code: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const url = new URL(roomPath(code), location.origin).toString();
  const copy = () => {
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const share = () => void navigator.share?.({ title: "Ambatukam", text: t("pvpShareText"), url }).catch(() => {});
  return (
    <div className="pvp-invite">
      <p>{t("pvpInvite")}</p>
      <div className="pvp-link">
        <input readOnly value={url} aria-label={t("pvpInvite")} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" onClick={copy}>
          {t(copied ? "pvpCopied" : "pvpCopy")}
        </button>
        {"share" in navigator && (
          <button type="button" onClick={share}>
            {t("pvpShare")}
          </button>
        )}
      </div>
    </div>
  );
}

interface Props {
  session: PvpSession;
  engine: GameEngine;
  phase: Phase;
  onLeave: () => void;
}

/** Room status over the camera: invite link, opponent state, live score while playing */
export function PvpBar({ session, engine, phase, onLeave }: Props) {
  const { t } = useI18n();
  const view = useStore(session.client.store);
  const error = roomError(view);
  const room = view.room;

  if (error) {
    return (
      <div className="screen pvp-error">
        <div className="card" role="alert">
          <p className="hint">{t(error)}</p>
          <button type="button" className="btn primary" onClick={onLeave}>
            {t("back")}
          </button>
        </div>
      </div>
    );
  }
  if (!room) {
    return (
      <div className="pvp-bar" role="status">
        <p>{t("pvpConnecting")}</p>
      </div>
    );
  }
  return <RoomBar view={view} engine={engine} phase={phase} onLeave={onLeave} />;
}

function RoomBar({ view, engine, phase, onLeave }: { view: RoomView; engine: GameEngine; phase: Phase; onLeave: () => void }) {
  const { t } = useI18n();
  const { count } = useStore(engine.hud);
  const room = view.room!;
  if (phase === "result") return null; // the result dialog takes over

  const me = room.players.find((p) => p.seat === room.you);
  const opp = room.players.find((p) => p.seat !== room.you);
  const live = phase === "playing" || phase === "countdown";

  return (
    <div className={live ? "pvp-bar live" : "pvp-bar"} role="status">
      {live && opp ? (
        <div className="pvp-score">
          <span className="pvp-me">
            <small>{t("pvpYou")}</small> <b>{count}</b>
          </span>
          <span className="pvp-vs">{t("pvpVs")}</span>
          <span className="pvp-opp">
            <b>{view.opponentCount}</b> <small>{opp.name}</small>
          </span>
        </div>
      ) : (
        <>
          <p className="pvp-room">
            {t("pvpRoomLine", modeName(t, room.mode), room.duration)}
            {opp && me && ` · ${t("pvpWins", me.wins, opp.wins)}`}
          </p>
          {view.status === "reconnecting" ? (
            <p>{t("pvpReconnecting")}</p>
          ) : (
            <p>
              <Rich text={opponentLine(t, view)} />
            </p>
          )}
          {!opp && <InviteLink code={room.code} />}
          <button type="button" className="link" onClick={onLeave}>
            {t("pvpLeave")}
          </button>
        </>
      )}
    </div>
  );
}
