# Lệnh hay dùng. Chạy từ thư mục gốc repo. Cần Node 22+, uv ≥ 0.13.4 (pywrangler đòi).
.PHONY: install dev-api dev-web test lint build migrate-local migrate-remote deploy

# Cài phụ thuộc và tạo file env local từ file mẫu (không ghi đè file đã có)
install:
	npm ci --prefix frontend
	cd backend && uv sync
	test -f frontend/.env.development || cp frontend/.env.example frontend/.env.development
	test -f backend/.dev.vars || cp backend/.dev.vars.example backend/.dev.vars

# API + file tĩnh trên http://localhost:8787 (Worker thật, D1 local). Cần backend/.dev.vars.
dev-api:
	mkdir -p frontend/dist
	cd backend && uv run pywrangler dev

# Giao diện trên http://localhost:5173, /api chuyển sang dev-api
dev-web:
	npm run dev --prefix frontend

test:
	npm test --prefix frontend
	cd backend && uv run pytest

lint:
	npm run typecheck --prefix frontend
	npm run lint --prefix frontend
	cd backend && uv run ruff check . && uv run ruff format --check .

build:
	npm run build --prefix frontend

migrate-local:
	cd backend && uv run pywrangler d1 migrations apply ambatukam-leaderboard --local

migrate-remote:
	cd backend && uv run pywrangler d1 migrations apply ambatukam-leaderboard --remote

# Deploy tay từ máy mình: cần frontend/.env.production (gitignore) chứa sitekey thật.
# Cùng script với Workers Builds: áp migration D1 còn thiếu rồi mới deploy.
deploy: build
	backend/scripts/deploy.sh
