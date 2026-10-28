// Cloudflare Turnstile chống bot khi gửi điểm.
// Chạy ngầm, thường không hiện gì. Chỉ khi Cloudflare nghi ngờ mới hiện ô tick trong popup kết quả.
import { config } from "../config";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  execute(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export class CaptchaError extends Error {
  constructor() {
    super("captcha");
    this.name = "CaptchaError";
  }
}

let scriptLoad: Promise<TurnstileApi> | null = null;

/** Tải script một lần (gọi sẵn lúc bắt đầu ván để lúc gửi điểm khỏi chờ) */
export function loadTurnstile(): Promise<TurnstileApi> {
  scriptLoad ??= new Promise<TurnstileApi>((resolve, reject) => {
    const el = Object.assign(document.createElement("script"), { src: SCRIPT_URL, async: true });
    el.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new CaptchaError()));
    el.onerror = () => {
      scriptLoad = null;
      el.remove();
      reject(new CaptchaError());
    };
    document.head.append(el);
  });
  return scriptLoad;
}

let widget: { id: string; container: HTMLElement } | null = null;
let pending: { resolve: (token: string) => void; reject: (err: Error) => void } | null = null;

function settle(token: string | null): void {
  const p = pending;
  pending = null;
  if (token) p?.resolve(token);
  else p?.reject(new CaptchaError());
}

/** Lấy một mã xác minh mới. Mỗi mã chỉ dùng được một lần nên mỗi lần gửi điểm gọi lại. */
export async function getCaptchaToken(container: HTMLElement): Promise<string> {
  const ts = await loadTurnstile();
  settle(null); // huỷ lần xác minh trước nếu còn treo
  const token = new Promise<string>((resolve, reject) => {
    pending = { resolve, reject };
  });
  if (widget?.container !== container) {
    if (widget) ts.remove(widget.id);
    const id = ts.render(container, {
      sitekey: config.turnstileSiteKey,
      action: "submit",
      appearance: "interaction-only",
      execution: "execute",
      callback: (t: string) => settle(t),
      "error-callback": () => {
        settle(null);
        return true;
      },
      "timeout-callback": () => settle(null),
    });
    widget = { id, container };
  } else {
    ts.reset(widget.id);
  }
  ts.execute(widget.id);
  return token;
}
