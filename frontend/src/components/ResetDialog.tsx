import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAccount } from "../account/context";
import { ApiError } from "../api/client";
import { PASSWORD_MAX, PASSWORD_MIN } from "../api/types";
import { useI18n } from "../i18n/context";
import { Rich } from "../i18n/Rich";
import { navigate } from "../lib/route";
import "./AccountDialog.css";

/** /reset/<token>: the link from the password reset email. New password ×2 → logged in. */
export function ResetDialog({ token }: { token: string }) {
  const { t } = useI18n();
  const account = useAccount();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const dlg = dialogRef.current!;
    if (!dlg.open) dlg.showModal();
    dlg.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    // Closing (✕, Esc, Play) leaves the link: the token is spent or useless now
    const leave = () => navigate("/", { replace: true });
    dlg.addEventListener("close", leave);
    return () => dlg.removeEventListener("close", leave);
  }, []);

  const close = () => dialogRef.current?.close();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < PASSWORD_MIN) return setError(t("accErrShort", PASSWORD_MIN));
    if (password !== password2) return setError(t("accErrMatch"));
    setBusy(true);
    setError("");
    try {
      await account.completeReset(token, password);
      setDone(true);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setError(t(code === "bad_reset" ? "resetBad" : code === "rate_limited" ? "accErrLimit" : "accErrNet"));
    } finally {
      setBusy(false);
    }
  };

  const pw = (value: string, set: (v: string) => void, label: string, focus = false) => (
    <input
      data-autofocus={focus || undefined}
      type="password"
      value={value}
      onChange={(e) => set(e.target.value)}
      placeholder={label}
      aria-label={label}
      autoComplete="new-password"
      maxLength={PASSWORD_MAX}
      required
    />
  );

  return (
    <dialog ref={dialogRef} className="account" aria-labelledby="reset-title">
      <button type="button" className="res-close" aria-label={t("close")} onClick={close}>
        ✕
      </button>
      {!done ? (
        <form onSubmit={(e) => void submit(e)}>
          <h2 id="reset-title">{t("resetTitle")}</h2>
          {pw(password, setPassword, t("accPassword"), true)}
          {pw(password2, setPassword2, t("accPassword2"))}
          <p className="acc-hint">{t("resetHint")}</p>
          <button className="btn primary" disabled={busy}>
            {t("resetSave")}
          </button>
        </form>
      ) : (
        <div className="acc-step">
          <h2 id="reset-title">{t("resetTitle")}</h2>
          <p className="acc-hint acc-sent" role="status">
            <ResetDone />
          </p>
          <button type="button" className="btn primary" onClick={close} data-autofocus>
            {t("resetPlay")}
          </button>
        </div>
      )}
      <p className="acc-error" role="alert">
        {error}
      </p>
    </dialog>
  );
}

/** Reads the account after the reset logged it in */
function ResetDone() {
  const { t } = useI18n();
  const { user } = useAccount();
  return <Rich text={t("resetDone", user?.username ?? "")} />;
}
