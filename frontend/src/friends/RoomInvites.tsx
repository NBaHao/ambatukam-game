import { useEffect } from "react";
import { useAccount } from "../account/context";
import { useI18n } from "../i18n/context";
import type { TextKey } from "../i18n/strings";
import type { PvpMode } from "../pvp/protocol";
import { useFriends } from "./context";
import type { SentInvite } from "./FriendsHub";
import "./Friends.css";

const FAILED: Record<string, TextKey> = { not_online: "pvpInviteOffline", slow_down: "pvpInviteSlow" };

function stateText(s: SentInvite): TextKey {
  if (s.state === "pending") return "pvpInvitePending";
  if (s.state === "sent") return "pvpInvited";
  if (s.state === "declined") return "pvpDeclined";
  return FAILED[s.error ?? ""] ?? "pvpInviteFailed";
}

/** In a room waiting for an opponent: invite a friend who's online */
interface Props {
  code: string;
  mode: PvpMode;
  duration: number;
  /** Invite this friend as soon as the room exists (challenged from the friends list) */
  autoInvite?: string;
}

export function RoomInvites({ code, mode, duration, autoInvite }: Props) {
  const { t } = useI18n();
  const { user } = useAccount();
  const [hub, view] = useFriends();
  const connected = view.status === "open";
  useEffect(() => {
    if (!autoInvite || !connected) return;
    if (hub.store.get().sent.some((s) => s.to === autoInvite && s.code === code)) return;
    hub.invite(autoInvite, code, mode, duration);
  }, [hub, autoInvite, connected, code, mode, duration]);
  if (!user || view.online.length === 0) return null;
  const sent = new Map(view.sent.filter((s) => s.code === code).map((s) => [s.to, s]));
  return (
    <div className="pvp-invite">
      <p>{t("pvpInviteFriends")}</p>
      <ul className="pvp-friends">
        {view.online.map((u) => {
          const s = sent.get(u);
          const again = !s || s.state === "failed" || s.state === "declined";
          return (
            <li key={u}>
              <i className="fr-dot on" />
              {u}
              {s && <span className="st">{t(stateText(s))}</span>}
              {again && (
                <button type="button" onClick={() => hub.invite(u, code, mode, duration)}>
                  {t("pvpInviteBtn")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
