// Ảnh kết quả 1080x1080 để chia sẻ (Web Share API, không có thì tải về)
import { MAX_RATE } from "../game/constants";
import { isTimed, type RunResult } from "../game/types";
import type { Translate } from "../i18n/context";
import type { RunSummary } from "./scoring";

const C = { bg: "#0b0b0b", fg: "#f2f2f2", mute: "#8b8b8b", line: "#2a2a2a", bar: "#555", accent: "#ff3b3b" };

export const modeName = (t: Translate, mode: RunResult["mode"]) =>
  t(mode === "single" ? "modeSingle" : mode === "double" ? "modeDouble" : "modeRandom");

function drawChart(canvas: HTMLCanvasElement, data: number[], peak: number, label: string): void {
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  const pad = 16;
  const top = 22;
  const n = Math.max(1, data.length);
  const max = Math.max(MAX_RATE, ...data);
  const bw = (w - pad * 2) / n;
  for (let i = 0; i < n; i++) {
    const v = data[i] || 0;
    const bh = (v / max) * (h - pad - top);
    ctx.fillStyle = v === peak && v > 0 ? C.accent : C.bar;
    ctx.fillRect(pad + i * bw + 1, h - pad - bh, Math.max(1, bw - 2), bh);
  }
  ctx.fillStyle = C.line;
  ctx.fillRect(pad, h - pad, w - pad * 2, 1);
  ctx.fillStyle = C.mute;
  ctx.font = "11px system-ui";
  ctx.fillText(label.toUpperCase(), pad, 12);
  ctx.fillText("0s", pad, h - 3);
  ctx.textAlign = "right";
  ctx.fillText(`${n}s`, w - pad, h - 3);
}

function renderImage(run: RunResult, summary: RunSummary, t: Translate, title: string): HTMLCanvasElement {
  const timed = isTimed(run.mode);
  const c = Object.assign(document.createElement("canvas"), { width: 1080, height: 1080 });
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, 1080, 1080);
  ctx.fillStyle = C.accent;
  ctx.fillRect(80, 96, 28, 28);
  ctx.fillStyle = C.fg;
  ctx.font = "800 40px system-ui";
  ctx.fillText(`AMBATUKAM · ${modeName(t, run.mode).toUpperCase()}`, 130, 124);
  ctx.font = "700 260px ui-monospace, Menlo, monospace";
  ctx.fillText(summary.hero, 80, 480);
  ctx.fillStyle = C.mute;
  ctx.font = "32px system-ui";
  ctx.fillText(t(timed ? "avg" : "survived").toUpperCase(), 84, 540);
  ctx.fillStyle = C.fg;
  ctx.font = "800 72px system-ui";
  ctx.fillText(title, 80, 680);
  ctx.fillStyle = C.mute;
  ctx.font = "36px system-ui";
  ctx.fillText(
    timed ? t("shareSub", run.count, run.duration, run.peak) : t("shareSubRandom", run.count, run.rods),
    80,
    740,
  );
  const chart = Object.assign(document.createElement("canvas"), { width: 560, height: 110 });
  drawChart(chart, run.bins, run.peak, t("chartLabel"));
  ctx.drawImage(chart, 80, 800, 920, 180);
  return c;
}

export async function shareResult(run: RunResult, summary: RunSummary, t: Translate, title: string): Promise<void> {
  const canvas = renderImage(run, summary, t, title);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) return;
  const file = new File([blob], "ambatukam-score.png", { type: "image/png" });
  const text = isTimed(run.mode) ? t("shareText", summary.hero) : t("shareTextRandom", summary.hero);
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Ambatukam Game", text });
      return;
    } catch {
      // người dùng huỷ hoặc không chia sẻ được: tải ảnh về
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(a.href);
}
