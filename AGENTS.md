# AGENTS.md

Hướng dẫn cho người (và AI agent) sửa repo này. Đọc hết trước khi đụng vào code.

## Tổng quan

Game webcam: nhận diện tay chạy hoàn toàn trong trình duyệt (MediaPipe), backend chỉ lo bảng xếp hạng.

Monorepo một git repo: `frontend/` (Node, npm) và `backend/` (Python, uv), mỗi bên giữ lockfile của mình (`frontend/package-lock.json`, `backend/uv.lock`).
Lệnh chung chạy từ gốc qua `Makefile`. Chỉ có một `.gitignore` ở gốc, đừng tạo `.gitignore` trong thư mục con.
Cả hai chạy trên **một Cloudflare Worker** ở https://ambatukam.bahao.site:

- File tĩnh (`frontend/dist`) do Workers Static Assets phục vụ.
- `/api/*` đi vào FastAPI chạy trên Cloudflare Python Workers (`run_worker_first`), lưu điểm ở D1.

```
frontend/                React 19 + TypeScript + Vite
  src/game/              Engine thuần TS (không React, không i18n): nhận diện tay, đếm nhát, vẽ canvas
  src/components/        Component React, mỗi component một file .css riêng nếu cần
  src/hooks/             useGameEngine, useStore (đọc Store của engine), useScoreSubmission
  src/api/               Client gọi /api, kiểu dữ liệu khớp backend/src/app/schemas.py
  src/i18n/              Chuỗi vi/en, provider, <Rich> (**đậm**)
  src/lib/               storage (localStorage), scoring, share (ảnh kết quả), turnstile
  src/assets/audio/      Mẫu âm thanh đã cắt sẵn (giọng meme, đếm ngược, nhạc Top 10)
  src/styles/global.css  Token màu, nút, layout chung
  public/                favicon, icon, og.png, site.webmanifest (copy nguyên vào dist)
  brand/, scripts/       Nguồn og.svg, dựng icon (`npm run brand`), cắt âm thanh (`npm run sound`, `npm run sound:countdown`)
backend/                 FastAPI trên Cloudflare Python Workers (quản lý bằng uv + pywrangler)
  src/entry.py           WorkerEntrypoint → ASGI
  src/app/main.py        create_app(): router, error handler, /api/docs
  src/app/routers/       sessions, scores, leaderboard
  src/app/services/      tokens (HMAC), anticheat, turnstile, names
  src/app/db.py          ScoreRepository trên D1
  src/app/rules.py       Hằng số luật chơi / chống gian lận
  migrations/            D1 migrations (đánh số 000N_*.sql)
  tests/                 pytest: D1 giả bằng sqlite3, đồng hồ giả, captcha giả
  wrangler.jsonc         Cấu hình Worker (assets, D1, rate limit, domain)
```

Engine ↔ React: `GameEngine` có các `Store` (`ui`, `hud`, `diagText`). React đọc qua `useStore` (`useSyncExternalStore`).
Engine chỉ phát ra **khoá chuỗi** (`gPalmReady`, `sLost`…), React dịch. Engine báo sự kiện qua `setHandlers({ onPlayStart, onFinish })`.

## Biến môi trường và secret

**Quy tắc: không commit file env nào.** Mọi `.env*`, `.dev.vars*`, `*.local` đều gitignore; chỉ commit file mẫu `*.example`.

**Frontend (Vite, build-time, CÔNG KHAI).** Mọi biến `VITE_*` bị nhúng vào bundle JS, ai cũng đọc được: không bao giờ đặt secret vào biến `VITE_*`.

| Biến | Local | Production | CI |
|---|---|---|---|
| `VITE_TURNSTILE_SITE_KEY` | `frontend/.env.development` (khoá thử, copy từ `.env.example`) | Cloudflare → Workers → ambatukam → Settings → Build → **Variables and secrets** | khoá thử, `--mode ci` (`ci.yml`) |
| `VITE_API_BASE_URL` | để trống | không đặt (= cùng tên miền) | không đặt |
| `API_DEV_URL` | tuỳ chọn, chỉ cho proxy của `vite dev` | | |

`vite.config.ts` kiểm tra lúc build: thiếu `VITE_TURNSTILE_SITE_KEY`, hoặc build production bằng khoá thử, là build lỗi ngay (không deploy ra trang hỏng).
Deploy tay từ máy mình (`make deploy`) thì tạo `frontend/.env.production` (gitignore) chứa sitekey thật.
Khi thêm biến mới: thêm vào `.env.example`, khai báo kiểu trong `src/vite-env.d.ts`, đọc qua `src/config.ts` (không gọi `import.meta.env` rải rác), thêm vào Build variables trên Cloudflare nếu production cần.

**Backend (secret của Worker, KHÔNG BAO GIỜ commit).**

| Secret | Production | Local |
|---|---|---|
| `TOKEN_SECRET` | `cd backend && openssl rand -hex 32 \| uv run pywrangler secret put TOKEN_SECRET` | `backend/.dev.vars` |
| `TURNSTILE_SECRET` | `cd backend && uv run pywrangler secret put TURNSTILE_SECRET` (Cloudflare dashboard → Turnstile → widget) | `backend/.dev.vars` (khoá thử `1x0000000000000000000000000000000AA`) |

`backend/.dev.vars` đã gitignore; `make install` tạo từ `backend/.dev.vars.example`. Đọc secret qua `Settings.from_env` (`src/app/config.py`), thiếu thì lỗi 500 rõ ràng.
Không in secret ra log, không dán vào issue/PR.

Khoá Turnstile thử của Cloudflare (luôn qua): sitekey `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.
Sitekey thật và secret thật phải cùng một widget, và widget phải cho phép hostname `ambatukam.bahao.site`.

## Chạy local

Cần Node 22+ và [uv](https://docs.astral.sh/uv/) ≥ 0.13.4 (pywrangler đòi bản này).

```bash
make install                       # npm ci + uv sync + copy file env mẫu (frontend/.env.development, backend/.dev.vars)
make migrate-local                 # tạo bảng trong D1 local (lần đầu, hoặc khi có migration mới)
make dev-api                       # Worker thật trên http://localhost:8787 (API + dist)
make dev-web                       # Vite trên http://localhost:5173, /api proxy sang 8787
```

API chạy port khác thì đặt `API_DEV_URL=http://localhost:8788` trong `frontend/.env.development` (hoặc `API_DEV_URL=… make dev-web`). Tài liệu API: http://localhost:8787/api/docs.

Trước khi commit: `make lint test build` phải xanh.

## Debug

Chỉ có khi chạy `vite dev` (bị loại khỏi bản build):

- `?debug`: hiện dòng chẩn đoán (delegate, fps, số tay) và `window.__amb` (`processFrame`, `fakeHand`, `useFakeCamera`, `setMode`, đọc `phase`, `count`, `counts`, `anchors`, `onRod`, `meter`, `rods`).
- `?debug&auto=result&mode=double&lang=vi`: nhảy thẳng tới popup kết quả. `auto=play` để xem HUD đang chơi.
- `?delegate=CPU|GPU` ép delegate MediaPipe; `?mode=`, `?lang=` chọn sẵn chế độ / ngôn ngữ.

Chrome headless không có WebGL thì MediaPipe lỗi (`activeTexture`); chạy với `--use-angle=swiftshader --enable-unsafe-swiftshader`.

## Những thứ phải giữ đồng bộ

- `RND_METER_START / RND_DRAIN_BASE / RND_DRAIN_RAMP / RND_STROKE_GAIN` ở `frontend/src/game/constants.ts` ↔ `RND_START / RND_DRAIN / RND_RAMP / RND_GAIN` ở `backend/src/app/rules.py` (server dựng lại thanh Lửa để kiểm tra).
- Kiểu trong `frontend/src/api/types.ts` ↔ `backend/src/app/schemas.py`; mã lỗi `REJECTED_CODES` ↔ các `ApiError(...)` trong `routers/scores.py`.
- Tên khoá localStorage trong `frontend/src/lib/storage.ts`: đổi là người chơi mất kỷ lục và mã người chơi.
- Phiên bản `@mediapipe/tasks-vision` trong `package.json` (ghim cứng) ↔ `MEDIAPIPE_VERSION` ở `src/game/landmarker.ts` (WASM tải từ CDN theo phiên bản này).
- Mốc cắt mẫu âm thanh trong `frontend/scripts/sound.sh` / `countdown-sfx.sh` ↔ `HYPE_HIT_AT` và nhịp đếm ngược trong `src/game/audio.ts` (đổi file thì nghe lại và đo lại mốc).
- Đổi luật / ngưỡng chống gian lận: sửa `rules.py` + test trong `backend/tests/`, cập nhật mục chống gian lận trong README.

## Quy ước code

- Comment và chuỗi giao diện viết tiếng Việt (chuỗi người dùng thấy có cả `vi` và `en` trong `src/i18n/strings.ts`, không hardcode trong component).
- Frontend: TypeScript strict, function component + hooks, không thêm thư viện state/UI. CSS thuần, dùng biến trong `global.css`. Lint bằng oxlint, test bằng vitest (`*.test.ts` cạnh file nguồn).
- Engine (`src/game/`) không import React hay i18n.
- Backend: router mỏng, logic ở `services/`, truy cập D1 chỉ qua `ScoreRepository`. Phụ thuộc (env, settings, repo, captcha, rate limit) đi qua `Depends` để test thay được. Lỗi trả về dạng `{"error": "<code>"}` qua `ApiError`. Ruff (line 110) + pytest.
- Đổi schema D1: thêm file migration mới `backend/migrations/000N_*.sql`, không sửa migration đã chạy.
- Không thu thập IP / quốc gia người chơi cho chống gian lận (IP chỉ dùng làm khoá rate limit, không lưu).

## Git, commit và PR

`main` là production: mỗi commit vào `main` được Workers Builds deploy ngay. Vì vậy:

- Không commit hay push thẳng lên `main`. Mỗi thay đổi một nhánh tách từ `main` mới nhất, tên là `<type>/<mô-tả-kebab-case>` với `type` như commit bên dưới (`fix/android-camera`, `feat/weekly-leaderboard`).
- Không force push lên `main`, không viết lại lịch sử của nó. Trên nhánh của mình, cần force push thì dùng `git push --force-with-lease`.

**Luôn làm việc trên bản mới nhất của remote.** `main` local có thể cũ (PR merge trên GitHub không tự kéo về máy), nên luôn tách và rebase từ `origin/main`, không dùng `main` local.

```bash
# Bắt đầu task: lấy remote mới nhất rồi tách nhánh
git fetch origin --prune
git switch -c fix/android-camera origin/main

# Trước khi push lần đầu / tạo PR (và khi PR báo "out of date"): cập nhật lại
git fetch origin
git rebase origin/main          # có conflict thì sửa, `git rebase --continue`
make lint test build            # chạy lại sau khi rebase
git push -u origin HEAD         # đã push trước đó thì: git push --force-with-lease
```

- Tiếp tục một nhánh đã có: `git fetch origin` rồi `git pull --rebase` trước khi sửa, để không ghi đè commit người khác vừa đẩy lên.
- Rebase thay vì merge `main` vào nhánh: lịch sử nhánh gọn, squash ra một commit sạch.
- Lộ secret trong commit: thu hồi / đổi secret trước (`pywrangler secret put`, tạo widget Turnstile mới). Xoá khỏi lịch sử git không làm secret hết lộ.

**Commit**

Theo [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <mô tả>`. Commit cũ trước khi có quy tắc này không theo chuẩn, đừng bắt chước.

| `type` | Dùng khi |
|---|---|
| `feat` | Tính năng mới người chơi thấy được |
| `fix` | Sửa lỗi |
| `perf` | Nhanh hơn / nhẹ hơn, hành vi không đổi |
| `refactor` | Đổi cấu trúc code, hành vi không đổi |
| `test` | Chỉ thêm / sửa test |
| `docs` | README, AGENTS.md, comment |
| `style` | Định dạng code (ruff format…), không đổi logic. CSS giao diện là `feat` / `fix` |
| `build` | Dependency, Vite, wrangler, Makefile |
| `ci` | `.github/workflows/` |
| `chore` | Việc lặt vặt khác (gitignore, dọn file) |
| `revert` | Hoàn tác một commit trước |

- `scope` (tuỳ chọn): `frontend`, `backend`, `game` (engine), `api`, `db` (migration D1), `i18n`, `deploy`. Đụng nhiều chỗ thì bỏ scope.
- Mô tả: tiếng Anh, thể mệnh lệnh, chữ thường đầu câu, không chấm cuối, cả dòng dưới ~72 ký tự.
- Thay đổi phá tương thích (đổi API, đổi khoá localStorage, migration không chạy ngược được): thêm `!` sau type/scope và dòng `BREAKING CHANGE: …` ở phần thân.
- Dòng thứ hai để trống. Phần thân nói **tại sao** và tác động, không kể lại diff; nhiều ý thì gạch đầu dòng, xuống dòng ở ~72 ký tự.
- Một commit một thay đổi có nghĩa; không trộn sửa lỗi, refactor và đổi định dạng hàng loạt.

```
fix(game): fall back to CPU when the GPU delegate finds no hands

Samsung S25 creates the GPU delegate without error but returns no
landmarks. Self-test on a bundled sample image and switch to CPU.
```

```
feat(api)!: require a Turnstile token on score submit

BREAKING CHANGE: POST /api/scores rejects requests without `captcha`.
```
- Trước khi commit:
  - `make lint test build` phải xanh.
  - Đọc lại `git status` và `git diff --staged`: không có file env, secret, `dist/`, `.wrangler/`, file debug.
  - Sửa `package.json` / `pyproject.toml` thì commit kèm lockfile (`package-lock.json` / `uv.lock`).
- Không bỏ qua hook hay kiểm tra (`--no-verify`).

**Pull request**

- PR vào `main`. Tiêu đề **bắt buộc** đúng định dạng commit (`feat(backend): add weekly leaderboard`): Squash and merge lấy tiêu đề PR làm message commit trên `main`. Mô tả gồm:
  - Thay đổi gì và vì sao.
  - Đã test thế nào (lệnh đã chạy, thiết bị / trình duyệt đã thử). Đổi giao diện thì kèm ảnh chụp.
  - **Việc cần làm trên Cloudflare** nếu có: migration D1 mới, secret mới (`pywrangler secret put`), Build variable mới, đổi widget Turnstile.
- Merge khi CI GitHub (`frontend`, `backend`) xanh. Dùng **Squash and merge** để `main` mỗi PR một commit, rồi xoá nhánh.
- Preview Builds của Cloudflare đang tắt, nên PR chỉ có CI GitHub; lần build Cloudflare thật đầu tiên là lúc merge. Sau khi merge, xem build trong dashboard (Workers → ambatukam → Deployments) và làm bước 6 ở checklist Deploy bên dưới.

**Riêng cho AI agent**

- Chỉ commit, push, tạo PR khi người dùng yêu cầu. Không bao giờ tự merge PR, xoá nhánh của người khác hay đổi cấu hình GitHub / Cloudflare.
- Không chạy lệnh mất dữ liệu (`git reset --hard`, `git clean -fd`, `git checkout -- .`, force push) khi chưa hỏi; có thay đổi chưa commit thì sao lưu trước (`git stash` hoặc `git diff > /tmp/…`).
- Commit do agent viết thêm trailer `Co-Authored-By:` ghi model; mô tả PR do agent viết ghi rõ là do agent tạo.
- Không dán secret, token, nội dung `.dev.vars` vào commit, PR, issue hay log.

## Deploy

Workers Builds (Cloudflare dashboard → Workers → ambatukam → Settings → Build) tự deploy khi push lên `main`. Cấu hình:

| Mục | Giá trị |
|---|---|
| Root directory | `/` |
| Build command | `npm ci --prefix frontend && npm run build --prefix frontend` |
| Build variables | `VITE_TURNSTILE_SITE_KEY` = sitekey thật của widget Turnstile |
| Deploy command | `cd backend && uv run pywrangler d1 migrations apply ambatukam-leaderboard --remote && uv run pywrangler deploy` |

Worker secrets (`TOKEN_SECRET`, `TURNSTILE_SECRET`) nằm ở Settings → Variables and secrets (runtime), khác với Build variables ở trên.

Preview Builds đang tắt (Settings → Build → Branch control → **Enable Preview Builds**). Muốn bật lại thì cần:

- Thêm khối `previews` vào `wrangler.jsonc`, kèm D1 staging riêng để không lẫn điểm thật.
- Đặt secret riêng cho preview.
- Thêm hostname preview vào widget Turnstile.

GitHub Actions (`.github/workflows/ci.yml`) chỉ kiểm tra: typecheck, lint, test, build, ruff, pytest, `pywrangler deploy --dry-run`. Không cần GitHub secret nào.

Checklist khi deploy thay đổi lớn:

1. `make lint test build` xanh.
2. Có migration mới: `make migrate-remote` (hoặc để deploy command lo). Migration phải chạy lại được an toàn (`IF NOT EXISTS`).
3. Có secret mới: `uv run pywrangler secret put <NAME>` trong `backend/` trước khi deploy.
4. Đổi widget Turnstile: cập nhật Build variable `VITE_TURNSTILE_SITE_KEY` và Worker secret `TURNSTILE_SECRET` cùng lúc.
5. Bundle Worker (gzip) phải dưới 3 MB của gói free; `pywrangler deploy --dry-run` in ra kích thước.
6. Sau deploy: mở trang, chơi một ván, gửi điểm, xem bảng xếp hạng.
