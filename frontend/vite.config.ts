/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Biến không có tiền tố VITE_ chỉ dùng ở đây, không lọt vào bundle.
  // API_DEV_URL đặt trong .env.development.local hoặc biến môi trường shell.
  const env = loadEnv(mode, process.cwd(), "");
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
