import { useState } from "react";
import { useAccount } from "../account/context";
import { api } from "../api/client";
import { initAudio } from "../game/audio";
import { useI18n } from "../i18n/context";
import { Rich } from "../i18n/Rich";
import { playerId } from "../lib/storage";
import { modeName } from "../lib/share";
import { useFriends } from "./context";
import type { Invite } from "./FriendsHub";
import "./Friends.css";

interface Props {
  /** Joined: enter the room with this ticket */
  onJoin: (code: string, ticket: string) => void;
}

/** PvP invites from friends: accept joins the room right away, decline tells them */
export function InviteToasts({ onJoin }: Props) {
  const { t } = useI18n();
  const { user } = useAccount();
  const [hub, view] = useFriends();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (!user || view.invites.length === 0) return null;

  const accept = async (inv: Invite) => {
    void initAudio(); // inside the click: unlocks Web Audio for the countdown
    setBusy(inv.code);
    setFailed(null);
    try {
      const res = await api.joinRoom(inv.code, { pid: playerId(), name: user.username });
      hub.dismiss(inv.code);
      onJoin(res.code, res.ticket);
    } catch {
      setFailed(inv.code);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="invites" aria-live="polite">
      {view.invites.map((inv) => (
        <div className="invite" key={inv.code} role="alert">
          <p>
            <Rich text={t("invFrom", inv.from)} />
          </p>
          <small>{t("pvpRoomLine", modeName(t, inv.mode), inv.duration)}</small>
          {failed === inv.code && <span className="err">{t("invFailed")}</span>}
          <div className="row">
            <button type="button" className="btn primary sm" disabled={busy !== null} onClick={() => void accept(inv)}>
              {t("frAccept")}
            </button>
            <button type="button" className="link" onClick={() => hub.decline(inv)}>
              {t("frDecline")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
