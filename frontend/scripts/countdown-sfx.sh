#!/bin/sh
# Tải các mẫu đếm ngược rồi cắt cho vừa nhịp 3-2-1-GO (mỗi mốc 800ms).
# Cần ffmpeg + mạng. Chạy: npm run sound:countdown
#
# Giọng đọc 3-2-1-GO: https://www.myinstants.com/en/instant/countdown-3-2-1-go-47819/
#   ("Countdown 3, 2, 1... GO! (Deep Voice)"). MyInstants là nơi người dùng tự đăng tải,
#   không có giấy phép rõ ràng — chỉ dùng khi chấp nhận rủi ro bản quyền.
#
# Ba lớp nhạc nền lấy từ Mixkit Sound Effects Free License (dùng thương mại được,
# không cần ghi nguồn, không được bán lại file gốc): https://mixkit.co/license/#sfxFree
#   2299  Short bass hit           -> countdown-tick    (cú trầm dưới mỗi số)
#   563   Drum deep impact         -> countdown-impact  (cú nổ ở GO)
#   790   Cinematic trailer riser  -> countdown-riser   (rít dâng suốt 3-2-1, dài 2.45s)
set -eu
cd "$(dirname "$0")/.."
OUT=src/assets/audio
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
MIXKIT=https://assets.mixkit.co/active_storage/sfx
VOICE_URL=https://www.myinstants.com/media/sounds/countdown-3-2-1-go.mp3

for id in 2299 563 790; do
  curl -fsSL -A "Mozilla/5.0" "$MIXKIT/$id/$id-preview.mp3" -o "$TMP/$id.mp3"
done
curl -fsSL -A "Mozilla/5.0" -e "https://www.myinstants.com/en/instant/countdown-3-2-1-go-47819/" \
  "$VOICE_URL" -o "$TMP/voice.mp3"

# 3 · 2 · 1: cú trầm ngắn, code phát cao dần (playbackRate 0.88 → 1.08).
# Cắt luôn 60ms lặng đầu để tiếng khớp với con số hiện trên màn hình.
ffmpeg -hide_banner -loglevel error -y -i "$TMP/2299.mp3" \
  -af "atrim=start=0.06:end=0.68,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.005,afade=t=out:st=0.5:d=0.18,loudnorm=I=-16:TP=-1.5:LRA=6" \
  -ac 2 -ar 44100 -c:a libmp3lame -b:a 96k "$OUT/countdown-tick.mp3"

# GO: cú nổ trầm, ngân dài 2.2s nên vang vào những giây đầu của ván.
# Bản gốc swell chậm 154ms, cắt đi để cú nổ vào đúng lúc chữ GO hiện.
ffmpeg -hide_banner -loglevel error -y -i "$TMP/563.mp3" \
  -af "atrim=start=0.15:end=2.20,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.005,afade=t=out:st=1.6:d=0.6,volume=-1.2dB" \
  -ac 2 -ar 44100 -c:a libmp3lame -b:a 96k "$OUT/countdown-impact.mp3"

# Rít dâng dần: đỉnh ở 2.34s, khớp lúc chữ GO hiện ra
ffmpeg -hide_banner -loglevel error -y -i "$TMP/790.mp3" \
  -af "atrim=start=0:end=2.45,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.05,afade=t=out:st=2.32:d=0.13,loudnorm=I=-18:TP=-1.5:LRA=9" \
  -ac 2 -ar 44100 -c:a libmp3lame -b:a 96k "$OUT/countdown-riser.mp3"

# Giọng đọc: bản gốc đọc "Three, two, one, go!" với bốn từ bắt đầu ở 0.81 / 1.77 / 2.70 / 3.83s
# (mốc đo bằng năng lượng). Mỗi từ được đưa về cùng độ to (-17 dB RMS) để nghe đều nhau,
# và cắt sát chữ (bỏ 10-40ms lặng đầu) để giọng không trễ so với hình.
cut_word() {
  # $1 tên file · $2 bắt đầu · $3 kết thúc · $4 bắt đầu tắt dần · $5 gain bù cho đều
  ffmpeg -hide_banner -loglevel error -y -i "$TMP/voice.mp3" \
    -af "atrim=start=$2:end=$3,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.015,afade=t=out:st=$4:d=0.12,volume=$5,alimiter=level=disabled:limit=0.95:attack=3:release=50" \
    -ac 2 -ar 44100 -c:a libmp3lame -b:a 96k "$OUT/countdown-$1.mp3"
}

cut_word three 0.792 1.45 0.55 4.2dB
cut_word two 1.769 2.48 0.62 4.1dB
cut_word one 2.711 3.49 0.70 3.6dB
cut_word go 3.832 4.55 0.63 3.8dB

echo "Đã cắt xong các mẫu đếm ngược vào $OUT"
