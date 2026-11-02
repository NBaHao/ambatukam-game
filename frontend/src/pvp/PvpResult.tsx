import { useEffect, useRef } from "react";
import { Celebration } from "../components/Celebration";
import { Mascot } from "../components/Mascot";
import { celebrate, stopCelebration } from "../game/audio";
import type { GameEngine } from "../game/GameEngine";
import { useStore } from "../hooks/useStore";
import { useI18n } from "../i18n/context";
import { Rich } from "../i18n/Rich";
import type { TextKey } from "../i18n/strings";
import { profilePath } from "../lib/route";
import { modeName } from "../lib/share";
import type { PlayerStatus } from "./protocol";
import type { PvpSession } from "./PvpSession";
import "../components/ResultDialog.css";
import "./Pvp.css";

interface Props {
  session: PvpSession;
  open: boolean;
  /** Your strokes are shown from the engine until the server's result arrives */
  engine: GameEngine;
  onLeave: () => void;
}

const STATUS: Partial<Record<PlayerStatus, TextKey>> = { rejected: "pvpRejected", forfeit: "pvpForfeit" };

/** End of a PvP round: the server's verdict, both counts, rematch */
export function PvpResult({ session, engine, open, onLeave }: Props) {
  const { t } = useI18n();
  const { count } = useStore(engine.hud);
  const view = useStore(session.client.store);
  const room = view.room;
  const result = view.result && view.result.round === session.finalRound ? view.result : null;
  const mine = result?.players.find((p) => p.seat === room?.you);
  const opp = room?.players.find((p) => p.seat !== room.you);
  const me = room?.players.find((p) => p.seat === room.you);
  const won = mine?.result === "win";
  const party = open && won;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dlg = dialogRef.current!;
    if (open && !dlg.open) {
      dlg.showModal();
      againRef.current?.focus();
    } else if (!open && dlg.open) dlg.close();
  }, [open]);
  useEffect(() => {
    const dlg = dialogRef.current!;
    return () => {
      if (dlg.open) dlg.close();
    };
  }, []);

  useEffect(() => {
    if (!party) return;
    void celebrate();
    return stopCelebration;
  }, [party]);

  const title: TextKey | null = !mine ? null : mine.result === "win" ? "pvpWin" : mine.result === "loss" ? "pvpLoss" : "pvpDraw";
  const oppReady = opp?.connected && opp.ready;

  return (
    <dialog
      ref={dialogRef}
      className="result pvp-result"
      aria-labelledby="pvp-res-title"
      // No Esc: the round only ends through Rematch or Leave
      onCancel={(e) => e.preventDefault()}
    >
      <Celebration active={party} />
      {room && <p className="res-mode">{t("pvpRoomLine", modeName(t, room.mode), room.duration)}</p>}
      <Mascot mood={!mine ? "almost" : won ? "kam" : "tired"} className="res-mascot" />
      <h2 id="pvp-res-title">{title ? t(title) : t("pvpWaitResult", opp?.name ?? "…")}</h2>
      <ul className="pvp-players">
        {(result?.players ?? []).map((p) => {
          const status = STATUS[p.status];
          return (
            <li key={p.seat} className={[p.seat === room?.you && "me", p.result === "win" && "win"].filter(Boolean).join(" ")}>
              <span className="pvp-pname">
                {p.seat === room?.you ? (
                  `${p.name} (${t("pvpYou")})`
                ) : room?.players.find((x) => x.seat === p.seat)?.registered ? (
                  // New tab: following the link here would leave the room
                  <a href={profilePath(p.name)} target="_blank" rel="noopener" title={t("profView", p.name)}>
                    {p.name}
                  </a>
                ) : (
                  p.name
                )}
              </span>
              <span className="pvp-pnum">{p.strokes}</span>
              {status && <span className="pvp-pstatus">{t(status)}</span>}
            </li>
          );
        })}
        {!result && (
          <li className="me">
            <span className="pvp-pname">{t("pvpYou")}</span>
            <span className="pvp-pnum">{count}</span>
          </li>
        )}
      </ul>
      {me && opp && <p className="res-meta">{t("pvpWins", me.wins, opp.wins)}</p>}
      {opp && (
        <p className="res-meta">
          <Rich text={!opp.connected ? t("pvpOppLeft", opp.name) : oppReady ? t("pvpOppReady", opp.name) : ""} />
        </p>
      )}
      <div className="row">
        <button ref={againRef} type="button" className="btn primary" disabled={!result} onClick={() => session.rematch()}>
          {t("pvpRematch")}
        </button>
        <button type="button" className="btn" onClick={onLeave}>
          {t("pvpLeave")}
        </button>
      </div>
    </dialog>
  );
}
