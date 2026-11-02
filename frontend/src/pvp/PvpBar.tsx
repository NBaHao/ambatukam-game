import { useState } from "react";
import type { GameEngine, Phase } from "../game/GameEngine";
import { useStore } from "../hooks/useStore";
import { useI18n, type Translate } from "../i18n/context";
import { Rich } from "../i18n/Rich";
import type { TextKey } from "../i18n/strings";
import { RoomInvites } from "../friends/RoomInvites";
import { inviteUrl } from "../lib/route";
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
  const { t, lang } = useI18n();
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(code, lang);
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

interface CamProps {
  session: PvpSession;
  engine: GameEngine;
  phase: Phase;
  onLeave: () => void;
}

/** Over the camera: a room error, or the live score chip while counting down / playing */
export function PvpBar({ session, engine, phase, onLeave }: CamProps) {
  const { t } = useI18n();
  const view = useStore(session.client.store);
  const error = roomError(view);

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
  const room = view.room;
  const opp = room?.players.find((p) => p.seat !== room.you);
  if (!opp || (phase !== "playing" && phase !== "countdown")) return null;
  return <LiveScore engine={engine} opponent={opp.name} opponentCount={view.opponentCount} />;
}

function LiveScore({ engine, opponent, opponentCount }: { engine: GameEngine; opponent: string; opponentCount: number }) {
  const { t } = useI18n();
  const { count } = useStore(engine.hud);
  return (
    <div className="pvp-bar live" role="status">
      <div className="pvp-score">
        <span className="pvp-me">
          <small>{t("pvpYou")}</small> <b>{count}</b>
        </span>
        <span className="pvp-vs">{t("pvpVs")}</span>
        <span className="pvp-opp">
          <b>{opponentCount}</b> <small>{opponent}</small>
        </span>
      </div>
    </div>
  );
}

interface CardProps {
  session: PvpSession;
  phase: Phase;
  autoInvite?: string;
  onLeave: () => void;
}

/**
 * Room status while setting up: invite link, opponent state, leave. Sits in the stage grid, so it can
 * overlay the bottom of the camera on wide screens and drop below it on phones (see Pvp.css)
 */
export function PvpRoomCard({ session, phase, autoInvite, onLeave }: CardProps) {
  const { t } = useI18n();
  const view = useStore(session.client.store);
  const room = view.room;
  // Errors take over the camera; the score chip and the result dialog replace this card
  if (roomError(view) || phase === "playing" || phase === "countdown" || phase === "result") return null;
  if (!room) {
    return (
      <div className="pvp-card" role="status">
        <p>{t("pvpConnecting")}</p>
      </div>
    );
  }

  const me = room.players.find((p) => p.seat === room.you);
  const opp = room.players.find((p) => p.seat !== room.you);
  return (
    <div className="pvp-card" role="status">
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
      {!opp && <RoomInvites code={room.code} mode={room.mode} duration={room.duration} autoInvite={autoInvite} />}
      <button type="button" className="link" onClick={onLeave}>
        {t("pvpLeave")}
      </button>
    </div>
  );
}
