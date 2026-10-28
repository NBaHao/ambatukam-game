import { useEffect, useRef } from "react";
import "./Celebration.css";

interface Props {
  /** Bật hiệu ứng chúc mừng. Tắt (đóng popup) thì dọn canvas. */
  active: boolean;
}

const COLORS = ["#ff3b3b", "#f2f2f2", "#ffd166", "#7cc8ff", "#ff8a3b", "#c084fc"];
/** Bao lâu thì dứt hiệu ứng (giây): pháo bắn 5 giây đầu, pháo giấy rơi hết là thôi */
const SHOW_SEC = 7;
const ROCKETS_AT = [0.15, 0.75, 1.4, 2.05, 2.8, 3.6, 4.5];
const CONFETTI = 110;

const rand = (from: number, to: number) => from + Math.random() * (to - from);
const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

interface Confetto {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  w: number;
  h: number;
  sway: number;
  phase: number;
  color: string;
}

interface Rocket {
  x: number;
  y: number;
  vy: number;
  /** Độ cao nổ (px) */
  target: number;
  color: string;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

/**
 * Pháo hoa + pháo giấy cho màn "lọt Top 10".
 * Vẽ trên canvas phủ toàn màn hình, nằm dưới nội dung popup nhưng trên nền mờ của nó.
 * Tôn trọng prefers-reduced-motion: không chạy hiệu ứng.
 */
export function Celebration({ active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    const c = canvas?.getContext("2d");
    if (!canvas || !c) return;

    let raf = 0;
    let width = 0;
    let height = 0;
    let elapsed = 0;
    let last = 0;
    let rocketIndex = 0;
    const confetti: Confetto[] = [];
    const rockets: Rocket[] = [];
    const sparks: Spark[] = [];

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      width = innerWidth;
      height = innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    addEventListener("resize", resize);

    const newConfetto = (delay: number): Confetto => ({
      x: rand(0, width),
      y: -rand(20, 240) - delay * 180,
      vx: rand(-20, 20),
      vy: rand(70, 190),
      rot: rand(0, Math.PI * 2),
      spin: rand(-6, 6),
      w: rand(5, 11),
      h: rand(9, 18),
      sway: rand(10, 34),
      phase: rand(0, Math.PI * 2),
      color: pick(COLORS),
    });
    for (let i = 0; i < CONFETTI; i++) confetti.push(newConfetto(rand(0, 1)));

    const explode = (r: Rocket) => {
      const count = 44;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + rand(-0.06, 0.06);
        const speed = rand(70, 280);
        sparks.push({
          x: r.x,
          y: r.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: rand(0.8, 1.5),
          color: Math.random() < 0.35 ? "#f2f2f2" : r.color,
        });
      }
    };

    const step = (ts: number) => {
      const dt = Math.min((ts - last) / 1000 || 0, 0.05);
      last = ts;
      elapsed += dt;
      if (elapsed > SHOW_SEC) {
        canvas.style.display = "none";
        return;
      }

      while (rocketIndex < ROCKETS_AT.length && elapsed >= ROCKETS_AT[rocketIndex]) {
        rocketIndex++;
        rockets.push({
          // Bắn ở hai bên để pháo không bị tấm thẻ kết quả che mất
          x: (Math.random() < 0.5 ? rand(0.04, 0.28) : rand(0.72, 0.96)) * width,
          y: height + 10,
          vy: -rand(520, 700),
          target: rand(height * 0.14, height * 0.44),
          color: pick(COLORS),
        });
      }

      c.clearRect(0, 0, width, height);

      for (let i = confetti.length - 1; i >= 0; i--) {
        const p = confetti[i];
        p.phase += dt * 2.4;
        p.x += (p.vx + Math.sin(p.phase) * p.sway) * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
        if (p.y > height + 40) {
          confetti.splice(i, 1);
          continue;
        }
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.fillStyle = p.color;
        c.globalAlpha = 0.9;
        c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        c.restore();
      }

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.y += r.vy * dt;
        c.strokeStyle = r.color;
        c.globalAlpha = 0.85;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(r.x, r.y);
        c.lineTo(r.x, r.y + 14);
        c.stroke();
        if (r.y <= r.target) {
          explode(r);
          rockets.splice(i, 1);
        }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= dt;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        s.vy += 220 * dt;
        s.vx *= 1 - 1.6 * dt;
        s.vy *= 1 - 0.6 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        c.globalAlpha = Math.min(1, s.life / 0.5) * 0.9;
        c.fillStyle = s.color;
        c.beginPath();
        c.arc(s.x, s.y, 2.2, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      canvas.style.display = "";
    };
  }, [active]);

  if (!active) return null;
  return <canvas ref={canvasRef} className="celebration" aria-hidden="true" />;
}
