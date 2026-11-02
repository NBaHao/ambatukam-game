import { useEffect, useRef, useState } from "react";
import { Mascot } from "../components/Mascot";
import { useStore } from "../hooks/useStore";
import { useI18n } from "../i18n/context";
import { Rich } from "../i18n/Rich";
import type { PvpSession } from "./PvpSession";
import { RtcLink } from "./RtcLink";

interface Props {
  session: PvpSession;
  /** The game's camera stream (sent only if both players turn the camera on) */
  camera: () => MediaStream | null;
  /** Show the opt-in toggles (not while counting down or playing) */
  controls: boolean;
}

/** Opponent tile (their camera, or a mascot) with the camera / voice opt-ins */
export function PvpMedia({ session, camera, controls }: Props) {
  const { t } = useI18n();
  const [rtc] = useState(() => new RtcLink(session.client, camera));
  const view = useStore(rtc.store);
  const room = useStore(session.client.store).room;
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    rtc.start();
    return () => rtc.stop();
  }, [rtc]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = view.remote;
    if (view.remote) void v.play().catch(() => {});
  }, [view.remote]);

  const opp = room?.players.find((p) => p.seat !== room.you && p.connected);
  if (!view.available || !room || !opp) return null;
  const seeing = Boolean(view.remote?.getVideoTracks().length) && view.cam && opp.cam;
  const both = (view.cam && opp.cam) || (view.mic && opp.mic);

  return (
    <div className="pvp-media">
      <div className={seeing ? "pvp-tile live" : (opp.cam && !view.cam) || (opp.mic && !view.mic) ? "pvp-tile asking" : "pvp-tile"}>
        <video ref={videoRef} playsInline autoPlay aria-label={opp.name} />
        {!seeing && <Mascot mood="idle" className="pvp-tile-mascot" />}
        <span className="pvp-tile-name">
          {opp.name}
          {opp.mic && view.mic && " 🎙"}
        </span>
        {both && view.link !== "connected" && (
          <span className="pvp-tile-state">{t(view.link === "failed" ? "rtcFailed" : "rtcConnecting")}</span>
        )}
      </div>
      {controls && (
        <div className="pvp-media-ctl">
          <label>
            <input type="checkbox" checked={view.cam} onChange={(e) => void rtc.setMedia(e.target.checked, view.mic)} />
            <span className="ico" aria-hidden="true">
              📷
            </span>
            <span className="txt">{t("rtcCam")}</span>
          </label>
          <label>
            <input type="checkbox" checked={view.mic} onChange={(e) => void rtc.setMedia(view.cam, e.target.checked)} />
            <span className="ico" aria-hidden="true">
              🎙
            </span>
            <span className="txt">{t("rtcMic")}</span>
          </label>
          {view.micError && <p className="err">{t("rtcMicError")}</p>}
          {opp.cam && !view.cam && (
            <p className="ask">
              <Rich text={t("rtcWantsCam", opp.name)} />
            </p>
          )}
          {opp.mic && !view.mic && (
            <p className="ask">
              <Rich text={t("rtcWantsMic", opp.name)} />
            </p>
          )}
          <p className="fine">{t("rtcHint")}</p>
        </div>
      )}
    </div>
  );
}
