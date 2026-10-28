import { useEffect, useRef, useState, type FormEvent } from "react";
import { celebrate, stopCelebration } from "../game/audio";
import { isTimed, type RunResult } from "../game/types";
import { useRankPreview } from "../hooks/useRankPreview";
import { useScoreSubmission, type SubmitState } from "../hooks/useScoreSubmission";
import { useI18n, type Translate } from "../i18n/context";
import type { RunSummary } from "../lib/scoring";
import { modeName, shareResult } from "../lib/share";
import { Celebration } from "./Celebration";
import { Mascot, type MascotMood } from "./Mascot";
import { storage } from "../lib/storage";
import "./ResultDialog.css";

export interface FinishedRun {
  id: number;
  run: RunResult;
  summary: RunSummary;
  /** Token phiên server cấp lúc bắt đầu ván (null nếu không xin được) */
  session: Promise<string | null>;
}

interface Props {
  finished: FinishedRun;
  open: boolean;
  /** Tiến độ "xòe tay để chơi lại" (0..1) */
  replayProgress: number;
  onAgain: () => void;
  onClose: () => void;
  onOpenBoard: () => void;
  onTypingChange: (typing: boolean) => void;
  /** Chỉ dùng khi dev (?debug&auto=top10): xem trước hiệu ứng Top 10 dù chưa gửi điểm */
  forceCelebrate?: boolean;
}

/** `claim`: hạng dự kiến trong Top 10 khi chưa gửi, nhắc người chơi nhập tên để giữ chỗ */
function message(t: Translate, s: SubmitState, claim: number | null): string {
  if (s.status === "sending") return t("submitting");
  if (s.status === "done") return t("rankLine", s.rank.name, s.rank.rank, s.rank.total);
  if (s.status === "error" || s.status === "off") return t(s.msg);
  return claim ? t("topTenClaim", claim) : "";
}

/** Danh hiệu → biểu cảm mascot: 3 (Ambatukam) trở lên là nổ, 2 (Ambatu…) là gồng */
function moodForTier(tier: number): MascotMood {
  return tier >= 3 ? "kam" : tier === 2 ? "almost" : "tired";
}

function metaLine(t: Translate, run: RunResult, summary: RunSummary): string {
  const timed = isTimed(run.mode);
  const best = summary.isNewBest
    ? t("metaNewBest")
    : t("metaBest", timed ? `${(summary.prevBest / run.duration).toFixed(2)}/s` : `${summary.prevBest.toFixed(1)}s`);
  return [t("strokesN", run.count), !timed && t("rodsN", run.rods), best].filter(Boolean).join(" · ");
}

/** Popup kết quả: điểm, danh hiệu, gửi điểm lên bảng xếp hạng. Mỗi ván một instance (key = id). */
export function ResultDialog({ finished, open, replayProgress, onAgain, onClose, onOpenBoard, onTypingChange, forceCelebrate }: Props) {
  const { t, strings } = useI18n();
  const { run, summary } = finished;
  const timed = isTimed(run.mode);
  const title = strings.tiers[summary.tier];

  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  const captchaRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(storage.getName);
  const { state, submit, edit } = useScoreSubmission(run, finished.session, captchaRef);
  const editing = state.status === "form" || state.status === "error";
  // Chưa có tên thì không tự gửi được: ước hạng từ bảng xếp hạng để báo trước nếu lọt Top 10
  const [needsName] = useState(() => name.trim() === "");
  const preview = useRankPreview(run, needsName);
  // Hạng server trả về lần gửi gần nhất: bấm "Đổi tên" (về lại form) vẫn giữ pháo hoa
  const [sentRank, setSentRank] = useState<number | null>(null);
  if (state.status === "done" && state.rank.rank !== sentRank) setSentRank(state.rank.rank);
  // Lọt Top 10 là có pháo hoa + nhạc chúc mừng
  const rank = state.status === "off" ? null : state.status === "done" ? state.rank.rank : (sentRank ?? preview);
  const top10 = rank !== null && rank <= 10;
  const party = open && (top10 || Boolean(forceCelebrate));

  useEffect(() => {
    if (!party) return;
    void celebrate();
    return stopCelebration;
  }, [party]);

  const send = () => {
    const value = name.trim();
    if (!value) return inputRef.current?.focus();
    inputRef.current?.blur();
    void submit(value);
  };

  // Mở / đóng theo prop. Đóng do người dùng (Esc, nút ✕) thì về màn hình đầu.
  const shownRef = useRef(false);
  const autoRef = useRef(false);
  useEffect(() => {
    const dlg = dialogRef.current!;
    if (open && !dlg.open) {
      dlg.showModal();
      shownRef.current = true;
      // Lần mở đầu: đã có tên từ lần trước thì tự gửi luôn. Chưa có thì đưa con trỏ vào ô tên
      // (trừ màn cảm ứng: bàn phím ảo bật lên sẽ che mất điểm).
      const autoSend = !autoRef.current && state.status === "form" && name.trim() !== "";
      autoRef.current = true;
      if (autoSend) send();
      else if (editing && !matchMedia("(pointer: coarse)").matches) inputRef.current?.focus();
      else againRef.current?.focus();
    } else if (!open && dlg.open) {
      shownRef.current = false;
      dlg.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy khi mở / đóng
  }, [open]);

  useEffect(() => {
    const dlg = dialogRef.current!;
    const onDialogClose = () => {
      // Bỏ qua sự kiện close đến muộn khi popup đã mở lại
      if (shownRef.current && !dlg.open) {
        shownRef.current = false;
        onClose();
      }
    };
    dlg.addEventListener("close", onDialogClose);
    return () => dlg.removeEventListener("close", onDialogClose);
  }, [onClose]);

  // Popup gỡ khỏi DOM khi còn mở (ván mới): đóng hẳn để không kẹt ::backdrop
  useEffect(() => {
    const dlg = dialogRef.current!;
    return () => {
      shownRef.current = false;
      if (dlg.open) dlg.close();
    };
  }, []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };

  const rename = () => {
    edit();
    // Ô nhập hiện lại ở lần render sau
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  return (
    <dialog ref={dialogRef} className="result" aria-labelledby="res-title">
      <Celebration active={party} />
      <button type="button" className="res-close" aria-label={t("close")} onClick={() => dialogRef.current?.close()}>
        ✕
      </button>
      <Mascot mood={moodForTier(summary.tier)} className="res-mascot" />
      <p className="res-mode">{modeName(t, run.mode) + (timed ? ` · ${run.duration}s` : "")}</p>
      <div className="res-hero">
        <span className="res-num">{summary.hero}</span>
        <span className="res-unit">{t(timed ? "avg" : "survived")}</span>
      </div>
      <h2 id="res-title">{title}</h2>
      {(top10 || forceCelebrate) && (
        <p className="res-top">
          <span aria-hidden="true">🏆</span> {t("topTen")}
        </p>
      )}
      <p className="res-meta">{metaLine(t, run, summary)}</p>

      <div className="rank">
        {/* Luôn giữ form trong DOM để focus được ngay khi bấm "Đổi tên" */}
        <form className={editing ? "submit-form" : "submit-form hidden"} onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="name-input">
            {t("namePh")}
          </label>
          <input
            ref={inputRef}
            id="name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={() => onTypingChange(true)}
            onBlur={() => onTypingChange(false)}
            placeholder={t("namePh")}
            maxLength={20}
            autoComplete="nickname"
            spellCheck={false}
            enterKeyHint="send"
          />
          <button className="btn primary">{t("submit")}</button>
        </form>
        <div ref={captchaRef} className="turnstile" />
        <p className="submit-msg" role="status" aria-live="polite">
          {message(t, state, top10 && sentRank === null ? rank : null)}
        </p>
        <div className="row links">
          {state.status === "done" && (
            <button type="button" className="link" onClick={rename}>
              {t("rename")}
            </button>
          )}
          <button type="button" className="link" onClick={onOpenBoard}>
            {t("board")}
          </button>
        </div>
      </div>

      <div className="row res-actions">
        {/* Mỗi lúc chỉ một nút chính: còn ô nhập tên thì là "Gửi điểm", gửi xong là "Chơi lại" */}
        <button ref={againRef} type="button" className={editing ? "btn btn-again" : "btn primary btn-again"} onClick={onAgain}>
          <span>{t("again")}</span>
          <i className="replay-fill" style={{ width: `${(replayProgress * 100).toFixed(0)}%` }} />
        </button>
        <button type="button" className="btn" onClick={() => void shareResult(run, summary, t, title)}>
          {t("share")}
        </button>
      </div>
    </dialog>
  );
}
