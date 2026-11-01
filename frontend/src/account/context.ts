import { createContext, use } from "react";
import type { User } from "../api/types";

export interface Account {
  /** null: khách (chưa đăng nhập) */
  user: User | null;
  /** /api/me đã trả lời (trước đó chưa biết là khách hay đã đăng nhập) */
  ready: boolean;
  /** Lần đầu vào game và là khách: mở sẵn hộp username như TETR.IO (chỉ một lần trên mỗi máy) */
  welcome: boolean;
  usernameExists: (username: string) => Promise<boolean>;
  login: (username: string, password: string) => Promise<void>;
  /** `captchaEl`: chỗ Turnstile vẽ ô tick nếu cần */
  register: (form: { username: string; password: string; email: string }, captchaEl: HTMLElement) => Promise<void>;
  logout: () => Promise<void>;
}

export const AccountContext = createContext<Account | null>(null);

export function useAccount(): Account {
  const ctx = use(AccountContext);
  if (!ctx) throw new Error("useAccount must be used inside <AccountProvider>");
  return ctx;
}
