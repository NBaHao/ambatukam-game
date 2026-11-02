import { useEffect, useState, type ReactNode } from "react";
import { ApiError, api } from "../api/client";
import type { Profile as ProfileData, ProfileMatch } from "../api/types";
import { useI18n, type Translate } from "../i18n/context";
import type { TextKey } from "../i18n/strings";
import { navigate, profilePath } from "../lib/route";
import { formatBoardScore } from "../lib/scoring";
import { modeName } from "../lib/share";
import "./Profile.css";

type Loaded = { username: string; data: ProfileData | "missing" | "error" };

const RESULT: Record<ProfileMatch["result"], TextKey> = { win: "profWin", loss: "profLoss", draw: "profDraw" };
const STATUS: Partial<Record<string, TextKey>> = { rejected: "pvpRejected", forfeit: "pvpForfeit" };

/** Link to another profile inside the app (no page reload) */
export function ProfileLink({ username, children }: { username: string; children: ReactNode }) {
  const href = profilePath(username);
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // new tab: let the browser do it
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

function MatchRow({ m, t, lang }: { m: ProfileMatch; t: Translate; lang: string }) {
  const opp = m.opponent;
  const mine = STATUS[m.status];
  const theirs = opp && STATUS[opp.status];
  const note = mine ? t(mine) : theirs ? `${opp.name} ${t(theirs)}` : "";
  return (
    <li className={`r-${m.result}`}>
      <span className="pm-res">{t(RESULT[m.result])}</span>
      <span className="pm-opp">
        {t("pvpVs")}{" "}
        {opp?.username ? <ProfileLink username={opp.username}>{opp.name}</ProfileLink> : (opp?.name ?? "?")}
        <small>
          {t("pvpRoomLine", modeName(t, m.mode), m.duration)}
          {note && ` · ${note}`}
        </small>
      </span>
      <span className="pm-score">
        {m.strokes}–{opp?.strokes ?? 0}
      </span>
      <span className="pm-date">{new Date(m.ended_at).toLocaleDateString(lang)}</span>
    </li>
  );
}

/** /u/<username>: an account's best scores, PvP record and recent matches */
export function Profile({ username, onBack }: { username: string; onBack: () => void }) {
  const { t, lang } = useI18n();
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    api
      .profile(username, ctl.signal)
      .then((data) => setLoaded({ username, data }))
      .catch((err: unknown) => {
        if (ctl.signal.aborted) return;
        const missing = err instanceof ApiError && (err.code === "user_not_found" || err.status === 422);
        setLoaded({ username, data: missing ? "missing" : "error" });
      });
    return () => ctl.abort();
  }, [username]);

  const data = loaded?.username === username ? loaded.data : null;
  const p = data && typeof data === "object" ? data : null;

  return (
    <div className="screen screen-profile">
      <h2>
        {p?.username ?? username}
        {p && (
          <i className="reg" title={t("boardRegistered")} aria-label={t("boardRegistered")}>
            ✓
          </i>
        )}
      </h2>
      {!p ? (
        <p className="hint" role="status">
          {t(!data ? "boardLoading" : data === "missing" ? "profNotFound" : "boardErr")}
        </p>
      ) : (
        <>
          <p className="best">{t("accSince", new Date(p.joined_at).toLocaleDateString(lang))}</p>

          <section className="prof-sec">
            <h3>{t("profBest")}</h3>
            {p.records.length ? (
              <ul className="prof-records">
                {p.records.map((r) => (
                  <li key={`${r.mode}-${r.duration}`}>
                    <span className="pr-mode">
                      {modeName(t, r.mode)}
                      {r.mode !== "random" && ` · ${r.duration}s`}
                    </span>
                    <span className="pr-score">{formatBoardScore(r.score, r.mode, r.duration)}</span>
                    <span className="pr-rank">{t("profRank", r.rank, r.total)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">{t("profNoRecords")}</p>
            )}
          </section>

          <section className="prof-sec">
            <h3>{t("profPvp")}</h3>
            {p.pvp.played ? (
              <>
                <p className="prof-pvp">{t("profPvpLine", p.pvp.wins, p.pvp.losses, p.pvp.draws)}</p>
                <h4>{t("profMatches")}</h4>
                <ul className="prof-matches">
                  {p.matches.map((m) => (
                    <MatchRow key={m.id} m={m} t={t} lang={lang} />
                  ))}
                </ul>
              </>
            ) : (
              <p className="hint">{t("profNoMatches")}</p>
            )}
          </section>
        </>
      )}
      <button type="button" className="btn" onClick={onBack}>
        {t("back")}
      </button>
    </div>
  );
}
