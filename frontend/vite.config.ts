/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Khoá thử của Turnstile (1x…, 2x…, 3x…): luôn qua hoặc luôn trượt, không được lên production
const TEST_SITE_KEY = /^[123]x0{20}[A-Z]{2}$/;

/** Báo lỗi ngay lúc build thay vì deploy ra một trang hỏng */
function checkBuildEnv(mode: string, env: Record<string, string>): void {
  const key = env.VITE_TURNSTILE_SITE_KEY;
  if (!key) {
    throw new Error(
      "VITE_TURNSTILE_SITE_KEY is not set. Local: cp .env.example .env.development; " +
        "Cloudflare: Settings → Build → Variables and secrets.",
    );
  }
  if (mode === "production" && TEST_SITE_KEY.test(key)) {
    throw new Error("VITE_TURNSTILE_SITE_KEY is a Turnstile test key; production needs the real sitekey.");
  }
}

export default defineConfig(({ command, mode }) => {
  // Đọc cả biến shell lẫn file .env*. Biến không có tiền tố VITE_ chỉ dùng ở đây, không lọt vào bundle.
  const env = loadEnv(mode, process.cwd(), "");
  if (command === "build") checkBuildEnv(mode, env);
  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Chạy local: /api chuyển sang Worker FastAPI (`make dev-api`, cổng 8787)
      proxy: { "/api": env.API_DEV_URL || "http://localhost:8787" },
    },
    test: {
      include: ["src/**/*.test.ts"],
    },
  };
});
