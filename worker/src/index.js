// Leaderboard API cho Ambatukam Game (Cloudflare Workers + D1)
//
//   POST /api/session      { mode, duration }                      → { token }
//   POST /api/score        { token, pid, name, strokes, survived? } → { rank, total, score, strokes }
//   GET  /api/leaderboard  ?mode=&duration=&pid=                    → { entries, me }
//
// Điểm tính ở client nên không chống gian lận tuyệt đối được. Server chỉ làm khó hơn:
// token phiên chơi ký HMAC ghi lại lúc bắt đầu, so thời lượng thật với điểm nộp lên,
// chặn điểm vượt sức người, và giới hạn request theo IP.

const DURATIONS = { single: [10, 20, 30], double: [10, 20, 30], random: [0] };
const HANDS = { single: 1, double: 2, random: 1 };
const MAX_RATE_PER_HAND = 12; // nhát/giây/tay tối đa được chấp nhận
const RANDOM_MAX_SEC = 300;   // Lửa cạn ngày càng nhanh, sống quá mốc này là không thể
const TIME_SLACK_SEC = 3;     // bù độ trễ mạng giữa lúc lấy token và lúc nộp điểm
const TOKEN_TTL_SEC = 3600;
const NAME_MAX = 20;
const TOP_N = 50;
// Random: Lửa bắt đầu 100%, cạn (10 + 0.4·t)%/giây, mỗi nhát nạp 5%
const RND_START = 100, RND_DRAIN = 10, RND_RAMP = 0.4, RND_GAIN = 5;

const ALLOWED_ORIGINS = [/^https:\/\/nbahao\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

export default {
  async fetch(req, env) {
    const origin = req.headers.get("origin") || "";
    const cors = ALLOWED_ORIGINS.some((re) => re.test(origin))
      ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", vary: "origin" }
      : {};
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...cors } });
    const url = new URL(req.url);
    const ip = req.headers.get("cf-connecting-ip") || "unknown";

    try {
      if (req.method === "POST" && url.pathname === "/api/session") {
        if (!(await env.SESSION_LIMIT.limit({ key: ip })).success) return json({ error: "rate_limited" }, 429);
        const { mode, duration } = await req.json();
        if (!DURATIONS[mode]?.includes(duration)) return json({ error: "bad_mode" }, 400);
        return json({ token: await signToken(env, { m: mode, d: duration, t: Date.now() }) });
      }

      if (req.method === "POST" && url.pathname === "/api/score") {
        if (!(await env.SCORE_LIMIT.limit({ key: ip })).success) return json({ error: "rate_limited" }, 429);
        return await submitScore(env, await req.json(), json);
      }

      if (req.method === "GET" && url.pathname === "/api/leaderboard") {
        const mode = url.searchParams.get("mode");
        const duration = Number(url.searchParams.get("duration"));
        if (!DURATIONS[mode]?.includes(duration)) return json({ error: "bad_mode" }, 400);
        return json(await leaderboard(env, mode, duration, url.searchParams.get("pid")));
      }

      return json({ error: "not_found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: err instanceof SyntaxError ? "bad_json" : "server_error" }, err instanceof SyntaxError ? 400 : 500);
    }
  },
};

async function submitScore(env, body, json) {
  const session = await verifyToken(env, body.token);
  if (!session) return json({ error: "bad_token" }, 400);
  const { m: mode, d: duration } = session;
  const elapsed = (Date.now() - session.t) / 1000;
  if (elapsed > TOKEN_TTL_SEC) return json({ error: "expired" }, 400);

  const pid = String(body.pid || "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(pid)) return json({ error: "bad_pid" }, 400);
  const name = cleanName(body.name);
  if (!name) return json({ error: "bad_name" }, 400);

  const strokes = body.strokes;
  if (!Number.isInteger(strokes) || strokes < 0) return json({ error: "bad_score" }, 400);
  let score;
  if (mode === "random") {
    const survived = Math.round(Number(body.survived) * 10) / 10;
    if (!(survived > 0 && survived <= RANDOM_MAX_SEC)) return json({ error: "bad_score" }, 400);
    if (elapsed + TIME_SLACK_SEC < survived) return json({ error: "too_fast" }, 400);
    // Sống được `survived` giây thì phải xóc đủ nhát để bù lượng Lửa đã cạn
    const drained = RND_DRAIN * survived + (RND_RAMP / 2) * survived * survived;
    const minStrokes = Math.floor((drained - RND_START) / RND_GAIN) - 3;
    if (strokes < minStrokes || strokes > MAX_RATE_PER_HAND * survived) return json({ error: "implausible" }, 400);
    score = survived;
  } else {
    if (elapsed + TIME_SLACK_SEC < duration) return json({ error: "too_fast" }, 400);
    if (strokes > MAX_RATE_PER_HAND * HANDS[mode] * duration) return json({ error: "implausible" }, 400);
    score = strokes;
  }
  if (score <= 0) return json({ error: "bad_score" }, 400);

  // Giữ điểm cao nhất; tên luôn cập nhật theo lần nộp mới nhất
  const now = Date.now();
  const [, , mine] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO scores (pid, name, mode, duration, score, strokes, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (pid, mode, duration) DO UPDATE SET
         name = excluded.name,
         score = MAX(scores.score, excluded.score),
         strokes = CASE WHEN excluded.score > scores.score THEN excluded.strokes ELSE scores.strokes END,
         updated_at = CASE WHEN excluded.score > scores.score THEN excluded.updated_at ELSE scores.updated_at END`
    ).bind(pid, name, mode, duration, score, strokes, now),
    env.DB.prepare(`UPDATE scores SET name = ?1 WHERE pid = ?2`).bind(name, pid),
    myRankQuery(env, mode, duration, pid),
  ]);
  return json(mine.results[0]);
}

async function leaderboard(env, mode, duration, pid) {
  const top = env.DB.prepare(
    `SELECT name, score, strokes, pid = ?3 AS me FROM scores
     WHERE mode = ?1 AND duration = ?2 ORDER BY score DESC, updated_at ASC LIMIT ?4`
  ).bind(mode, duration, pid || "", TOP_N);
  const [entries, mine] = await env.DB.batch(pid ? [top, myRankQuery(env, mode, duration, pid)] : [top]);
  return {
    entries: entries.results.map((r) => ({ ...r, me: !!r.me })),
    me: mine?.results[0] || null,
  };
}

// Hạng của một người chơi: số người điểm cao hơn (hoặc bằng điểm nhưng đạt trước) + 1
function myRankQuery(env, mode, duration, pid) {
  return env.DB.prepare(
    `SELECT s.name, s.score, s.strokes,
       (SELECT COUNT(*) FROM scores o WHERE o.mode = s.mode AND o.duration = s.duration
          AND (o.score > s.score OR (o.score = s.score AND o.updated_at < s.updated_at))) + 1 AS rank,
       (SELECT COUNT(*) FROM scores o WHERE o.mode = s.mode AND o.duration = s.duration) AS total
     FROM scores s WHERE s.pid = ?3 AND s.mode = ?1 AND s.duration = ?2`
  ).bind(mode, duration, pid);
}

function cleanName(raw) {
  const s = String(raw || "").normalize("NFC").replace(/\p{C}/gu, "").replace(/\s+/g, " ").trim();
  return Array.from(s).slice(0, NAME_MAX).join("").trim();
}

// ---------- Token phiên chơi: base64url(JSON) + "." + base64url(HMAC-SHA256) ----------
const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmacKey(env) {
  if (!env.TOKEN_SECRET) throw new Error("TOKEN_SECRET is not set");
  return crypto.subtle.importKey("raw", enc.encode(env.TOKEN_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signToken(env, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

async function verifyToken(env, token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(env), unb64url(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64url(body)));
    return DURATIONS[p.m]?.includes(p.d) && Number.isFinite(p.t) ? p : null;
  } catch {
    return null;
  }
}
