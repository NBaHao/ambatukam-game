#!/bin/sh
# Cắt mẫu âm thanh của meme ra frontend/src/assets/audio (các file này được commit, script chỉ để
# dựng lại khi đổi bản gốc hoặc chỉnh mốc cắt). Cần ffmpeg.
#
#   npm run sound -- /đường/dẫn/tới/thư-mục-gốc
#
# Thư mục gốc cần có: ambatukam-short.mp3 (câu "I'm about to cum", 3.6s),
# ambatukam_mussic.mp3 (bản có nhạc, 10.4s). Mốc dưới đây đo trên bản gốc:
#   - 0.14s: hết khoảng lặng đầu file
#   - 1.22s: bắt đầu chữ "cum"
#   - 3.60s: hết câu
# Chỉnh mốc thì nhớ đo lại và nghe thử, nhất là HYPE_HIT_AT trong src/game/audio.ts.
set -eu
SRC=${1:?thiếu đường dẫn tới thư mục chứa file gốc}
cd "$(dirname "$0")/.."
OUT=src/assets/audio
mkdir -p "$OUT"

# Cả câu "I'm about to… cum": bấm nút mở màn
ffmpeg -hide_banner -loglevel error -y -i "$SRC/ambatukam-short.mp3" \
  -af "atrim=start=0.14:end=3.60,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.02,afade=t=out:st=3.21:d=0.25,loudnorm=I=-15:TP=-1.5:LRA=7" \
  -ac 1 -ar 44100 -c:a libmp3lame -b:a 64k "$OUT/hype.mp3"

# Từ chữ "cum": lúc kết ván, vào thẳng chỗ nổ
ffmpeg -hide_banner -loglevel error -y -i "$SRC/ambatukam-short.mp3" \
  -af "atrim=start=1.22:end=3.60,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.02,afade=t=out:st=2.08:d=0.30,loudnorm=I=-14:TP=-1.5:LRA=7" \
  -ac 1 -ar 44100 -c:a libmp3lame -b:a 64k "$OUT/finish.mp3"

# Câu bị hụt ngay trước "cum": danh hiệu Ambatu… (code tự thêm tiếng xịt sau mẫu)
ffmpeg -hide_banner -loglevel error -y -i "$SRC/ambatukam-short.mp3" \
  -af "atrim=start=0.14:end=1.30,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.02,afade=t=out:st=1.06:d=0.10,loudnorm=I=-15:TP=-1.5:LRA=7" \
  -ac 1 -ar 44100 -c:a libmp3lame -b:a 64k "$OUT/almost.mp3"

# Bản có nhạc, cắt còn 7.7s và fade cuối: lọt Top 10
ffmpeg -hide_banner -loglevel error -y -i "$SRC/ambatukam_mussic.mp3" \
  -af "atrim=start=0.10:end=7.80,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.05,afade=t=out:st=6.30:d=1.50,loudnorm=I=-19:TP=-1.5:LRA=11" \
  -ac 2 -ar 44100 -c:a libmp3lame -b:a 112k "$OUT/celebrate.mp3"

echo "Đã cắt xong 4 mẫu vào $OUT"
