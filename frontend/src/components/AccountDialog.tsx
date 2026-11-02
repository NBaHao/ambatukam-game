import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAccount } from "../account/context";
import { ApiError } from "../api/client";
import { PASSWORD_MAX, PASSWORD_MIN, RESERVED_PREFIX, USERNAME_RE } from "../api/types";
import { useI18n, type Translate } from "../i18n/context";
import { Rich } from "../i18n/Rich";
import { navigate, profilePath } from "../lib/route";
import { CaptchaError } from "../lib/turnstile";
import "./AccountDialog.css";

/**
 * Tài khoản kiểu TETR.IO: một ô username.
 * Trống → khách. Tên đã có → nhập mật khẩu. Tên chưa có → "tạo tài khoản?" → email (tuỳ chọn) + mật khẩu ×2.
 */
type Step = "name" | "login" | "join" | "register" | "me";
/** "I forgot" sends at once: sending → sent (resend after a countdown) / failed (retry), or "none" (no email service) */
type Forgot = "off" | "sending" | "sent" | "failed" | "none";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface Props {
  open: boolean;
  onClose: () => void;
}

function usernameError(name: string) {
  if (!USERNAME_RE.test(name)) return "accErrName" as const;
  if (name.startsWith(RESERVED_PREFIX)) return "accErrReserved" as const;
  return null;
}

/** 95 → "1:35" */
function clockText(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function errorText(t: Translate, err: unknown): string {
  if (err instanceof CaptchaError) return t("submitCaptcha");
  if (err instanceof ApiError) {
    if (err.code === "bad_login") return t("accErrLogin");
    if (err.code === "username_taken") return t("accErrTaken");
    if (err.code === "rate_limited") return t("accErrLimit");
    if (err.code === "captcha") return t("submitCaptcha");
    if (err.code === "email_failed") return t("accErrMail");
    if (err.code === "reset_unavailable") return t("accForgotHelp");
    if (err.code === "bad_reset") return t("resetBad");
  }
  return t("accErrNet");
}

export function AccountDialog({ open, onClose }: Props) {
  const { t, lang } = useI18n();
  const account = useAccount();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const captchaRef = useRef<HTMLDivElement>(null);

  // Remounted on every open (key in App), so the first step comes straight from the login state
  const [step, setStep] = useState<Step>(() => (account.user ? "me" : "name"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState<Forgot>("off");
  const [resendAt, setResendAt] = useState(0); // ms timestamp when "resend" unlocks
  const [resendLeft, setResendLeft] = useState(0); // whole seconds still to wait
  const [emailEdit, setEmailEdit] = useState(false);
  const [notice, setNotice] = useState("");

  const go = (next: Step) => {
    setStep(next);
    setError("");
    setNotice("");
    setForgot("off");
    setEmailEdit(false);
    setPassword("");
    setPassword2("");
  };

  useEffect(() => {
    const dlg = dialogRef.current!;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  // On open and on every step change, focus the step's field (or main button).
  // Not autoFocus: React focuses while the dialog is still closed, then showModal() moves focus to ✕.
  useEffect(() => {
    const dlg = dialogRef.current!;
    if (dlg.open) dlg.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [open, step]);

  useEffect(() => {
    const dlg = dialogRef.current!;
    dlg.addEventListener("close", onClose);
    return () => dlg.removeEventListener("close", onClose);
  }, [onClose]);

  const close = () => dialogRef.current?.close();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  const onName = (e: FormEvent) => {
    e.preventDefault();
    const name = username.trim().toLowerCase();
    if (!name) return close(); // để trống: chơi với tư cách khách
    const bad = usernameError(name);
    if (bad) return setError(t(bad));
    void run(async () => {
      const exists = await account.usernameExists(name);
      setUsername(name);
      go(exists ? "login" : "join");
    });
  };

  const onLogin = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await account.login(username, password);
      close();
    });
  };

  const onRegister = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < PASSWORD_MIN) return setError(t("accErrShort", PASSWORD_MIN));
    if (password !== password2) return setError(t("accErrMatch"));
    const mail = email.trim();
    if (mail && !EMAIL_RE.test(mail)) return setError(t("accErrEmail"));
    void run(async () => {
      await account.register({ username, password, email: mail }, captchaRef.current!);
      close();
    });
  };

  // "I forgot" and "resend" both just switch to "sending": the effect below sends once the captcha box
  // is on screen (Turnstile needs it, in case it asks for a click).
  const sendReset = () => {
    if (busy || forgot === "sending" || forgot === "none") return;
    setForgot("sending");
  };

  const requestReset = account.requestReset;
  const sendingRef = useRef(false); // one request per "sending", even if the effect runs twice
  const doSend = useCallback(async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setBusy(true);
    setError("");
    try {
      const wait = await requestReset(username, lang, captchaRef.current!);
      setResendAt(Date.now() + wait * 1000);
      setResendLeft(wait);
      setForgot("sent");
    } catch (err) {
      const none = err instanceof ApiError && err.code === "reset_unavailable";
      setForgot(none ? "none" : "failed");
      if (!none) setError(errorText(t, err));
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  }, [requestReset, username, lang, t]);

  useEffect(() => {
    if (forgot === "sending") void doSend();
  }, [forgot, doSend]);

  // Countdown until another email can go out
  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
      setResendLeft(left);
      if (left === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [resendAt]);

  const editEmail = () => {
    setEmailEdit(true);
    setEmail(account.user?.email ?? "");
    setPassword("");
    setError("");
    setNotice("");
  };

  const onEmail = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const remove = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("name") === "remove";
    const mail = remove ? "" : email.trim();
    if (mail && !EMAIL_RE.test(mail)) return setError(t("accErrEmail"));
    void run(async () => {
      await account.changeEmail(mail || null, password);
      setEmailEdit(false);
      setPassword("");
      setNotice(t("accEmailSaved"));
    });
  };

  const back = (
    <button type="button" className="link" onClick={() => go("name")} disabled={busy}>
      {t("back")}
    </button>
  );
  const pw = (value: string, set: (v: string) => void, label: string, autoComplete: string, focus = false) => (
    <input
      data-autofocus={focus || undefined}
      type="password"
      value={value}
      onChange={(e) => set(e.target.value)}
      placeholder={label}
      aria-label={label}
      autoComplete={autoComplete}
      maxLength={PASSWORD_MAX}
      required
    />
  );

  return (
    <dialog ref={dialogRef} className="account" aria-labelledby="acc-title">
      <button type="button" className="res-close" aria-label={t("close")} onClick={close}>
        ✕
      </button>

      {step === "name" && (
        <form onSubmit={onName}>
          <h2 id="acc-title">{t("accTitle")}</h2>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("accNamePh")}
            aria-label={t("accNamePh")}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={16}
            data-autofocus
          />
          <p className="acc-hint">{t("accNameHint")}</p>
          <button className="btn primary" disabled={busy}>
            {username.trim() ? t("accNext") : t("accStay")}
          </button>
        </form>
      )}

      {step === "login" && (
        <form onSubmit={onLogin}>
          <h2 id="acc-title">
            <Rich text={t("accWelcome", username)} />
          </h2>
          {/* ô username ẩn để trình quản lý mật khẩu lưu đúng tài khoản */}
          <input type="text" value={username} autoComplete="username" readOnly hidden />
          {pw(password, setPassword, t("accPassword"), "current-password", true)}
          <button className="btn primary" disabled={busy}>
            {t("accLogin")}
          </button>
          <div className="row">
            {back}
            {forgot === "off" && (
              <button type="button" className="link" onClick={sendReset} disabled={busy}>
                {t("accForgot")}
              </button>
            )}
          </div>
          {forgot === "none" && <p className="acc-hint">{t("accForgotHelp")}</p>}
          {forgot === "sending" && (
            <div className="acc-forgot">
              <p className="acc-hint" role="status">
                {t("accForgotSending")}
              </p>
              <div ref={captchaRef} className="turnstile" />
            </div>
          )}
          {(forgot === "sent" || forgot === "failed") && (
            <div className="acc-forgot">
              {forgot === "sent" && (
                <p className="acc-hint acc-sent" role="status">
                  <Rich text={t("accForgotSent", username)} />
                </p>
              )}
              <button type="button" className="btn" onClick={sendReset} disabled={busy || resendLeft > 0}>
                {resendLeft > 0 ? t("accResendIn", clockText(resendLeft)) : t("accResend")}
              </button>
            </div>
          )}
        </form>
      )}

      {step === "join" && (
        <div className="acc-step">
          <h2 id="acc-title">
            <Rich text={t("accJoin", username)} />
          </h2>
          <p className="acc-hint">{t("accJoinWhy")}</p>
          <button type="button" className="btn primary" onClick={() => go("register")} data-autofocus>
            {t("accRegister")}
          </button>
          <button type="button" className="btn" onClick={close}>
            {t("accStay")}
          </button>
          {back}
        </div>
      )}

      {step === "register" && (
        <form onSubmit={onRegister}>
          <h2 id="acc-title">{username}</h2>
          <input type="text" value={username} autoComplete="username" readOnly hidden />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("accEmail")}
            aria-label={t("accEmail")}
            autoComplete="email"
            maxLength={254}
            data-autofocus
          />
          {pw(password, setPassword, t("accPassword"), "new-password")}
          {pw(password2, setPassword2, t("accPassword2"), "new-password")}
          <div ref={captchaRef} className="turnstile" />
          <button className="btn primary" disabled={busy}>
            {t("accRegister")}
          </button>
          <div className="row">
            <button type="button" className="link" onClick={() => go("join")} disabled={busy}>
              {t("back")}
            </button>
          </div>
        </form>
      )}

      {step === "me" && account.user && (
        <div className="acc-step">
          <h2 id="acc-title">{account.user.username}</h2>
          <p className="acc-hint">
            {t("accSince", new Date(account.user.created_at).toLocaleDateString(lang))}
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              close();
              navigate(profilePath(account.user!.username));
            }}
          >
            {t("profMine")}
          </button>
          <button type="button" className="btn" data-autofocus disabled={busy} onClick={() => void run(async () => {
            await account.logout();
            go("name");
          })}>
            {t("accLogout")}
          </button>
          {emailEdit ? (
            <form className="acc-email" onSubmit={onEmail}>
              <input type="text" value={account.user.username} autoComplete="username" readOnly hidden />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("accEmailPh")}
                aria-label={t("accEmailPh")}
                autoComplete="email"
                maxLength={254}
                required
              />
              {pw(password, setPassword, t("accPasswordNow"), "current-password")}
              <button className="btn primary" disabled={busy}>
                {t("accSave")}
              </button>
              <div className="row">
                <button type="button" className="link" onClick={() => setEmailEdit(false)} disabled={busy}>
                  {t("back")}
                </button>
                {account.user.email && (
                  <button name="remove" formNoValidate className="link" disabled={busy || !password}>
                    {t("accEmailRemove")}
                  </button>
                )}
              </div>
            </form>
          ) : (
            <div className="acc-email">
              <p className="acc-hint">
                {account.user.email ? <Rich text={t("accEmailIs", account.user.email)} /> : t("accEmailNone")}
              </p>
              <button type="button" className="link" onClick={editEmail}>
                {t(account.user.email ? "accEmailChange" : "accEmailAdd")}
              </button>
            </div>
          )}
          {notice && (
            <p className="acc-hint acc-sent" role="status">
              {notice}
            </p>
          )}
        </div>
      )}

      <p className="acc-error" role="alert">
        {error}
      </p>
    </dialog>
  );
}
