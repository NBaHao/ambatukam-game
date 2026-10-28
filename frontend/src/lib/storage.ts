// localStorage của game. Giữ nguyên tên khoá cũ để người chơi không mất kỷ lục / mã người chơi.
// Safari chế độ riêng tư có thể ném lỗi khi ghi nên mọi truy cập đều bọc try/catch.
import type { Duration, Mode } from "../game/types";

const KEY = {
  lang: "ambatukam_lang",
  mode: "ambatukam_mode",
  name: "ambatukam_name",
  pid: "ambatukam_pid",
  best: (mode: Mode, duration: Duration) =>
    mode === "random" ? "ambatukam_best_random" : `ambatukam_best_${mode}_${duration}`,
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // không lưu được thì thôi, game vẫn chơi bình thường
  }
}

export const storage = {
  getLang: () => read(KEY.lang),
  setLang: (lang: string) => write(KEY.lang, lang),
  getMode: () => read(KEY.mode),
  setMode: (mode: Mode) => write(KEY.mode, mode),
  getName: () => read(KEY.name) ?? "",
  setName: (name: string) => write(KEY.name, name),
  getBest: (mode: Mode, duration: Duration) => Number(read(KEY.best(mode, duration)) || 0),
  setBest: (mode: Mode, duration: Duration, score: number) => write(KEY.best(mode, duration), String(score)),
};

// Mã người chơi ẩn danh: mỗi máy giữ một dòng điểm cao nhất trên bảng
export function playerId(): string {
  let id = read(KEY.pid);
  if (!id) {
    id = crypto.randomUUID();
    write(KEY.pid, id);
  }
  return id;
}
