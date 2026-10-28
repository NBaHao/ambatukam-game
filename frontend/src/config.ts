// Cấu hình build-time từ biến môi trường Vite (frontend/.env.*). Thiếu biến bắt buộc thì báo lỗi ngay khi tải trang.
function required(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  if (!value) throw new Error(`Missing ${name}: set it in frontend/.env.${import.meta.env.MODE} (see .env.example)`);
  return value;
}

export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "",
  turnstileSiteKey: required("VITE_TURNSTILE_SITE_KEY"),
} as const;
