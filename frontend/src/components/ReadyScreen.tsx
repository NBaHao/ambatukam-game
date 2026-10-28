import type { Boot } from "../game/GameEngine";
import { useI18n } from "../i18n/context";

/** Đang chuẩn bị (xòe tay / đặt neo): chỉ hiện thẻ khi đang mở camera, tải mô hình hoặc bị lỗi */
export function ReadyScreen({ boot }: { boot: Boot }) {
  const { t } = useI18n();
  const hint =
    boot.step === "opening" ? t("opening")
    : boot.step === "loading" ? t("loading")
    : boot.step === "error" ? t("camError", boot.noFrames ? t("camNoFrames") : boot.message)
    : "";
  return (
    <div className="screen clear screen-ready">
      {hint && (
        <div className="card" role="status">
          <p className="hint">{hint}</p>
        </div>
      )}
    </div>
  );
}
