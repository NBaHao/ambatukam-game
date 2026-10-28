import { FilesetResolver, HandLandmarker, type HandLandmarkerOptions } from "@mediapipe/tasks-vision";
import handSampleUrl from "../assets/hand-sample.jpg";

// WASM tải từ CDN, phải cùng phiên bản với @mediapipe/tasks-vision trong package.json (đang ghim cứng)
const MEDIAPIPE_VERSION = "0.10.14";
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export type Delegate = "GPU" | "CPU";

// CPU chậm theo số tay (máy Android tầm cao: 1 tay ~27ms, 2 tay ~52ms) nên chỉ tìm đúng số tay cần.
// GPU nhanh nên luôn tìm 2 tay để ghép đúng tay đang chơi khi có tay thứ hai lọt vào khung.
export const handsFor = (delegate: Delegate, tracks: number) => (delegate === "CPU" ? tracks : 2);

function options(delegate: Delegate, tracks: number, runningMode: "IMAGE" | "VIDEO"): HandLandmarkerOptions {
  return {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode,
    numHands: handsFor(delegate, tracks),
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.4,
    minTrackingConfidence: 0.3,
  };
}

export interface Tracker {
  landmarker: HandLandmarker;
  delegate: Delegate;
  /** Ghi chú chẩn đoán (vd GPU bị bỏ qua vì sao) */
  note: string;
}

/**
 * Thử GPU trước, lỗi thì CPU. `forced` (từ ?delegate=CPU|GPU) để ép một loại khi cần chẩn đoán.
 */
export async function createTracker(tracks: number, forced?: Delegate): Promise<Tracker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const order: Delegate[] = forced ? [forced] : ["GPU", "CPU"];
  let note = "";
  let lastErr: unknown;
  for (const d of order) {
    try {
      // Tạo ở chế độ ảnh để chạy thử trên ảnh mẫu, xong mới chuyển sang video
      const lm = await HandLandmarker.createFromOptions(fileset, options(d, tracks, "IMAGE"));
      // Có GPU tạo được, chạy không lỗi mà không bao giờ thấy tay (vd Samsung S25 chip Exynos)
      if (d === "GPU" && !forced && !(await seesSampleHands(lm))) {
        lm.close();
        note = "GPU: không thấy tay trong ảnh mẫu → CPU";
        continue;
      }
      await lm.setOptions({ runningMode: "VIDEO" });
      return { landmarker: lm, delegate: d, note };
    } catch (err) {
      lastErr = err;
      note = `${d}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  throw lastErr;
}

/** GPU lỗi lúc chạy (mất WebGL context…) thì tạo lại bằng CPU */
export async function createCpuTracker(tracks: number): Promise<Tracker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const landmarker = await HandLandmarker.createFromOptions(fileset, options("CPU", tracks, "VIDEO"));
  return { landmarker, delegate: "CPU", note: "" };
}

// Ảnh mẫu 2 bàn tay (128x192, từ bộ test của MediaPipe, Apache-2.0)
async function seesSampleHands(lm: HandLandmarker): Promise<boolean> {
  const img = new Image();
  img.src = handSampleUrl;
  try {
    await img.decode();
  } catch {
    return true; // không tải được ảnh thì không kết luận được, cứ dùng GPU
  }
  return lm.detect(img).landmarks.length > 0;
}
