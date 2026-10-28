#!/usr/bin/env bash
# Deploy production: áp các migration D1 còn thiếu, xong mới đưa code Worker mới lên.
# Workers Builds (deploy command) và `make deploy` đều gọi file này, nên thêm migration mới
# (backend/migrations/000N_*.sql) là tự chạy, không phải sửa lệnh trên Cloudflare.
# Migration lỗi thì dừng luôn, code cũ vẫn chạy trên schema cũ.
set -euo pipefail
cd "$(dirname "$0")/.."

export CI=true # wrangler không hỏi xác nhận trước khi áp migration
uv run pywrangler d1 migrations apply ambatukam-leaderboard --remote
uv run pywrangler deploy
