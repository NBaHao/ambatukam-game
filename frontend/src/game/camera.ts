/** Camera đang bị tab/app khác giữ: luồng vẫn "live" nhưng không có hình */
export class CameraNoFramesError extends Error {
  constructor() {
    super("camera sent no frames");
    this.name = "CameraNoFramesError";
  }
}

const NO_FRAMES_TIMEOUT_MS = 8000;

export async function startCamera(video: HTMLVideoElement): Promise<void> {
  if (video.srcObject) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } },
    audio: false,
  });
  video.srcObject = stream;
  // Không có hình thì play() treo mãi
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new CameraNoFramesError()), NO_FRAMES_TIMEOUT_MS);
  });
  try {
    await Promise.race([video.play(), timeout]);
  } catch (err) {
    stopCamera(video);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function stopCamera(video: HTMLVideoElement): void {
  const stream = video.srcObject;
  if (stream instanceof MediaStream) stream.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}
