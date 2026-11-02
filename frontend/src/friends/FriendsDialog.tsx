import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAccount } from "../account/context";
import { ApiError } from "../api/client";
import { USERNAME_RE } from "../api/types";
import { ProfileLink } from "../components/Profile";
import { useI18n } from "../i18n/context";
import { Rich } from "../i18n/Rich";
import type { TextKey } from "../i18n/strings";
import { useFriends } from "./context";
import "./Friends.css";

interface Props {
  open: boolean;
  onClose: () => void;
  onLogin: () => void;
  /** Open the PvP host lobby to challenge this friend */
  onChallenge: (username: string) => void;
}

const ERRORS: Record<string, TextKey> = {
  user_not_found: "frErrNotFound",
  cannot_friend_self: "frErrSelf",
  too_many_friends: "frErrMany",
  too_many_requests: "frErrRequests",
  rate_limited: "accErrLimit",
};

/** Friends: add by username, answer requests, see who's online and challenge them */
export function FriendsDialog({ open, onClose, onLogin, onChallenge }: Props) {
  const { t } = useI18n();
  const { user } = useAccount();
  const [hub, view] = useFriends();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current!;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
    if (open) void hub.refresh();
  }, [open, hub]);

  useEffect(() => {
    const dlg = dialogRef.current!;
    dlg.addEventListener("close", onClose);
    return () => dlg.removeEventListener("close", onClose);
  }, [onClose]);

  const run = async (who: string, action: () => Promise<string | null>) => {
    setBusy(who);
    try {
      const text = await action();
      setMsg(text ? { text, error: false } : null);
    } catch (err) {
      const key = err instanceof ApiError ? ERRORS[err.code] : undefined;
      setMsg({ text: t(key ?? "accErrNet"), error: true });
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const who = name.trim().toLowerCase();
    if (!USERNAME_RE.test(who)) return setMsg({ text: t("frErrNotFound"), error: true });
    void run(who, async () => {
      const rel = await hub.add(who);
      setName("");
      return t(rel === "friends" ? "frNowFriends" : "frSentTo", who);
    });
  };

  const list = view.list;
  const online = new Set(view.online);
  const friends = [...(list?.friends ?? [])].sort(
    (a, b) => Number(online.has(b.username)) - Number(online.has(a.username)),
  );
  const close = () => dialogRef.current?.close();
  const nameLink = (u: string) => (
    <span className="fr-name" onClick={close}>
      <ProfileLink username={u}>{u}</ProfileLink>
    </span>
  );

  return (
    <dialog ref={dialogRef} className="account friends" aria-labelledby="fr-title">
      <button type="button" className="res-close" aria-label={t("close")} onClick={close}>
        ✕
      </button>
      <h2 id="fr-title">{t("friends")}</h2>

      {!user ? (
        <div className="acc-step">
          <p className="acc-hint">{t("frLoginHint")}</p>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              close();
              onLogin();
            }}
          >
            {t("accLogin")}
          </button>
        </div>
      ) : (
        <>
          <form className="fr-add" onSubmit={add}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("frAddPh")}
              aria-label={t("frAddPh")}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              maxLength={16}
            />
            <button className="btn" disabled={!name.trim() || busy !== null}>
              {t("frAdd")}
            </button>
          </form>
          <p className={msg?.error ? "acc-error" : "fr-msg"} role="status" aria-live="polite">
            {msg && <Rich text={msg.text} />}
          </p>

          {list && list.incoming.length > 0 && (
            <section className="fr-sec">
              <h3>{t("frRequests")}</h3>
              <ul className="fr-list">
                {list.incoming.map((r) => (
                  <li key={r.username}>
                    {nameLink(r.username)}
                    <button
                      type="button"
                      className="btn primary sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(r.username, async () => (await hub.add(r.username), t("frNowFriends", r.username)))
                      }
                    >
                      {t("frAccept")}
                    </button>
                    <button
                      type="button"
                      className="link"
                      disabled={busy !== null}
                      onClick={() => void run(r.username, async () => (await hub.remove(r.username), null))}
                    >
                      {t("frDecline")}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="fr-sec">
            {!list ? (
              <p className="acc-hint">{t("boardLoading")}</p>
            ) : friends.length === 0 ? (
              <p className="acc-hint">{t("frNone")}</p>
            ) : (
              <ul className="fr-list">
                {friends.map((f) => {
                  const on = online.has(f.username);
                  return (
                    <li key={f.username}>
                      <i className={on ? "fr-dot on" : "fr-dot"} title={t(on ? "frOnline" : "frOffline")} />
                      {nameLink(f.username)}
                      {on && (
                        <button
                          type="button"
                          className="btn primary sm"
                          onClick={() => {
                            close();
                            onChallenge(f.username);
                          }}
                        >
                          {t("frChallenge")}
                        </button>
                      )}
                      <button
                        type="button"
                        className="link"
                        disabled={busy !== null}
                        onClick={() =>
                          confirm === f.username
                            ? void run(f.username, async () => (await hub.remove(f.username), null))
                            : setConfirm(f.username)
                        }
                      >
                        {t(confirm === f.username ? "frRemoveSure" : "frRemove")}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {list && list.outgoing.length > 0 && (
            <section className="fr-sec">
              <h3>{t("frOutgoing")}</h3>
              <ul className="fr-list">
                {list.outgoing.map((r) => (
                  <li key={r.username}>
                    {nameLink(r.username)}
                    <button
                      type="button"
                      className="link"
                      disabled={busy !== null}
                      onClick={() => void run(r.username, async () => (await hub.remove(r.username), null))}
                    >
                      {t("frCancel")}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </dialog>
  );
}
