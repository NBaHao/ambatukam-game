import { useAccount } from "../account/context";
import { useFriends } from "../friends/context";
import { useI18n } from "../i18n/context";
import { LANGS } from "../i18n/strings";

export function Header({ onAccount, onFriends }: { onAccount: () => void; onFriends: () => void }) {
  const { lang, setLang, t } = useI18n();
  const { user, ready } = useAccount();
  const [, friends] = useFriends();
  const news = friends.list?.incoming.length ?? 0;
  return (
    <header className="top">
      <div className="logo">AMBATUKAM</div>
      <div className="top-right">
        {user && (
          <button type="button" className="acct acct-friends" onClick={onFriends}>
            {t("friends")}
            {friends.online.length > 0 && ` · ${friends.online.length}`}
            {news > 0 && (
              <i className="acct-badge" aria-label={t("frBadge", news)}>
                {news}
              </i>
            )}
          </button>
        )}
        {ready && (
          <button type="button" className={user ? "acct in" : "acct"} onClick={onAccount}>
            {user ? user.username : t("accLogin")}
          </button>
        )}
        <div className="lang">
          {LANGS.map((l) => (
            <button key={l} type="button" className={l === lang ? "active" : undefined} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
