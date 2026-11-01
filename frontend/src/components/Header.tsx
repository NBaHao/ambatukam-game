import { useAccount } from "../account/context";
import { useI18n } from "../i18n/context";
import { LANGS } from "../i18n/strings";

export function Header({ onAccount }: { onAccount: () => void }) {
  const { lang, setLang, t } = useI18n();
  const { user, ready } = useAccount();
  return (
    <header className="top">
      <div className="logo">AMBATUKAM</div>
      <div className="top-right">
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
