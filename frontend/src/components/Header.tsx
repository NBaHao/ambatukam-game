import { useI18n } from "../i18n/context";
import { LANGS } from "../i18n/strings";

export function Header() {
  const { lang, setLang } = useI18n();
  return (
    <header className="top">
      <div className="logo">AMBATUKAM</div>
      <div className="lang">
        {LANGS.map((l) => (
          <button key={l} type="button" className={l === lang ? "active" : undefined} onClick={() => setLang(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </header>
  );
}
