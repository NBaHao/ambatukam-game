import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { User } from "../api/types";
import { playerId, storage } from "../lib/storage";
import { getCaptchaToken } from "../lib/turnstile";
import { AccountContext, type Account } from "./context";

export function AccountProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [welcome, setWelcome] = useState(false);

  const setUser = useCallback((next: User | null) => {
    // Điểm gửi từ máy này đi theo mã người chơi của tài khoản
    if (next) {
      storage.setPid(next.pid);
      storage.setName(next.username);
    }
    setUserState(next);
  }, []);

  useEffect(() => {
    api
      .me()
      .then((res) => {
        setUser(res.user);
        if (!res.user && !storage.getWelcomed()) setWelcome(true);
        storage.setWelcomed();
      })
      .catch(() => {}) // mất mạng: coi như khách, vẫn chơi được
      .finally(() => setReady(true));
  }, [setUser]);

  const login = useCallback(
    async (username: string, password: string) => setUser((await api.login({ username, password })).user),
    [setUser],
  );

  const register = useCallback<Account["register"]>(
    async (form, captchaEl) => {
      const captcha = await getCaptchaToken(captchaEl);
      const res = await api.register({
        username: form.username,
        password: form.password,
        email: form.email || undefined,
        pid: playerId(),
        captcha,
      });
      setUser(res.user);
    },
    [setUser],
  );

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    storage.resetPid();
    storage.setName("");
    setUserState(null);
  }, []);

  const requestReset = useCallback<Account["requestReset"]>(async (username, lang, captchaEl) => {
    const captcha = await getCaptchaToken(captchaEl);
    await api.resetRequest({ username, captcha, lang });
  }, []);

  const completeReset = useCallback<Account["completeReset"]>(
    async (token, password) => setUser((await api.resetComplete({ token, password })).user),
    [setUser],
  );

  const changeEmail = useCallback<Account["changeEmail"]>(
    async (email, password) => setUser((await api.changeEmail({ email, password })).user),
    [setUser],
  );

  const value = useMemo<Account>(
    () => ({
      user,
      ready,
      welcome,
      usernameExists: api.usernameExists,
      login,
      register,
      logout,
      requestReset,
      completeReset,
      changeEmail,
    }),
    [user, ready, welcome, login, register, logout, requestReset, completeReset, changeEmail],
  );
  return <AccountContext value={value}>{children}</AccountContext>;
}
