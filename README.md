# Ambatukam Game

Game meme chơi bằng webcam: nắm tay như cầm một thanh trụ, xóc lên xuống thật nhanh. Có ba chế độ: đo tốc độ một tay, hai tay, và sống sót đuổi theo trụ ngẫu nhiên.

Toàn bộ nhận diện tay chạy trong trình duyệt. Không có backend, video không rời khỏi máy người chơi.

> Game giải trí lành mạnh cho 16+. Không có hình ảnh nhạy cảm. Mục đích: vui, theo trend, và vận động cơ tay.

![Màn hình bắt đầu](docs/start.png)

## Chạy local

Không cần cài gì. Chỉ cần một HTTP server tĩnh (trình duyệt không cho mở camera từ `file://`):

```bash
git clone <repo-url> ambatukam-game
cd ambatukam-game
python3 -m http.server 5173
```

Mở http://localhost:5173 rồi cho phép camera.

Cách khác nếu đã có Node: `npx serve .`

Khi đưa lên mạng phải dùng HTTPS (GitHub Pages, Vercel, Netlify… đều được), vì trình duyệt chỉ cho mở camera trên `localhost` hoặc HTTPS.

## Chế độ

| Chế độ | Cách chơi | Điểm |
|---|---|---|
| **Single** | 1 tay, 1 trụ. Đặt neo rồi xóc trong 10 / 20 / 30 giây | Nhát/giây trung bình |
| **Double** | 2 tay, 2 trụ. Cả hai tay cùng nắm và giữ yên để đặt hai neo, rồi xóc cả hai. Nhát hai tay cộng dồn | Nhát/giây trung bình (danh hiệu tính theo mỗi tay) |
| **Random** | Trụ hiện ở chỗ ngẫu nhiên, nghiêng ngẫu nhiên, và đổi chỗ sau 5 giây (giảm dần tới 2.5 giây). Phải nắm tay đuổi theo rồi xóc. Thanh **Lửa** cạn 10%/giây lúc đầu và cạn nhanh dần; mỗi nhát đúng trụ nạp 5%. Hết Lửa là dừng | Số giây sống sót |
| Rank, PvP | Sắp có | |

Kỷ lục lưu riêng cho từng chế độ (và từng mốc thời gian) trong `localStorage`.

## Cách chơi

1. Chọn chế độ, chọn thời gian (single / double), bấm **Bật camera & chơi**. Đây là lần bấm chuột duy nhất; từ đây điều khiển hoàn toàn bằng tay.
2. **Xòe bàn tay**, giữ 1 giây → sẵn sàng.
3. **Nắm tay như cầm trụ**, giữ yên 1 giây → game đặt **điểm neo** và vẽ thanh trụ ảo tại đó, nghiêng theo đúng hướng tay bạn đang nắm. (Double: cả hai tay cùng nắm. Random: bỏ qua bước này, trụ tự hiện.)
4. Đếm ngược 3-2-1, rồi **xóc lên xuống dọc theo trụ**. Chỉ những nhát đúng tư thế (tay nắm, nằm trong vùng trụ) mới được tính.
5. Hết giờ (hoặc hết Lửa): xem tốc độ trung bình / số giây sống sót, tổng nhát, đỉnh, biểu đồ từng giây. **Xòe tay 1 giây** để chơi lại, hoặc bấm **Lưu ảnh** để tải ảnh kết quả 1080×1080.

Không có camera? Chế độ single có thể chơi bằng phím `↑` `↓` (hoặc chạm nửa trên / nửa dưới khung hình).

![Đang chơi](docs/play.png)
![Kết quả](docs/result.png)

## Cơ chế nhận diện

Mỗi khung hình, MediaPipe trả về 21 điểm khớp của bàn tay. Game tính:

| Thứ | Cách tính |
|---|---|
| Vị trí tay | Trung bình 5 điểm lòng bàn tay (cổ tay + 4 gốc ngón) |
| Cỡ tay | Khoảng cách cổ tay → gốc ngón giữa. Mọi ngưỡng khác đều tính theo cỡ này nên đứng gần/xa camera đều chơi được |
| Độ duỗi ngón | (cổ tay → đầu ngón) / (cổ tay → gốc ngón): ~1.0 khi co, ~1.9 khi duỗi, làm mượt qua các khung |
| Xòe tay | Cả 4 ngón duỗi |
| Nắm trụ | Trung bình độ duỗi 4 ngón < 1.45 (ngón trỏ thường duỗi hơn khi cầm trụ nên không xét từng ngón) |
| Buông trụ (khi chơi) | Từ 3 ngón duỗi thẳng trở lên |
| Trục trụ | Đường nối khớp ngón trỏ → khớp ngón út lúc đặt neo (làm mượt trong 1 giây giữ yên). Nắm trụ nghiêng thế nào thì trụ nghiêng thế ấy |
| Một nhát | Vị trí tay chiếu lên trục trụ đi về một phía rồi đảo chiều, biên độ tối thiểu 25% cỡ tay (hysteresis, chống rung). Chuyển động vuông góc với trụ không được tính |
| Bám trụ | Tay nắm, lệch khỏi trục < 0.9 cỡ tay và dọc trục < 1.8 cỡ tay so với điểm neo |
| Gán tay (double) | Mỗi khung, hai bàn tay nhận được ghép vào hai trụ theo khoảng cách gần nhất; lúc chưa có neo thì xếp theo chiều ngang |
| Trụ ngẫu nhiên | Cỡ trụ lấy theo cỡ tay đo được lúc xòe tay sẵn sàng, nên đứng gần/xa đều vừa tay |

Xóc nhanh làm tay bị nhòe và mô hình mất dấu vài khung. Trong 0.4 giây game giữ trạng thái gần nhất thay vì phạt; mất lâu hơn thì trụ chuyển xám và nhắc thêm ánh sáng.

Tất cả tham số nằm ở đầu `game.js`, có chú thích từng dòng.

## Cấu trúc

```
index.html   Khung trang + các màn hình (start / ready / countdown / HUD / result)
style.css    Giao diện: đen trắng, một màu nhấn, không gradient
game.js      Toàn bộ logic: i18n, nhận diện tay, đếm nhát, vẽ overlay, chia sẻ
docs/        Ảnh chụp màn hình
```

Không có bước build. Thư viện MediaPipe và mô hình tải từ CDN lúc chạy.

## Ngôn ngữ

Có tiếng Việt và tiếng Anh, chuyển bằng nút VI / EN. Toàn bộ chuỗi nằm trong `STRINGS` ở đầu `game.js`; thêm ngôn ngữ mới = thêm một key.

## Debug

Mở `http://localhost:5173/?debug` để có `window.__amb` (bơm dữ liệu tay giả vào `processFrame`, `setMode`, đọc `state`, `count`, `counts`, `anchors`, `onRod`, `meter`, `rods`).

Nhảy thẳng tới một màn hình để xem giao diện, thêm `mode=single|double|random`:

- `?debug&auto=play&mode=double&lang=vi`
- `?debug&auto=result&mode=random&lang=en`

## Ý tưởng tiếp theo

- Rank: bảng xếp hạng toàn cầu (cần backend nhỏ + chống gian lận bằng chuỗi thời điểm từng nhát)
- PvP: 1v1 qua WebRTC
- Rhythm: xóc theo nhịp nhạc

## License

MIT

---

## English

Webcam meme game: grip like you're holding a rod, stroke up and down as fast as you can. Three modes: **Single** (1 hand, timed, average strokes/sec), **Double** (2 hands, 2 rods, strokes add up), **Random** (the rod spawns at random spots and keeps relocating; chase it to keep your Heat meter up, survive as long as you can). Rank and PvP are coming soon.

Hand tracking runs entirely in the browser. No backend; video never leaves the device. For fun, 16+, no explicit imagery.

**Run locally:** any static server works, e.g. `python3 -m http.server 5173`, then open http://localhost:5173. Camera access requires `localhost` or HTTPS.

**Play:** pick a mode and duration → open palm 1s to get ready → grip and hold still 1s to set the anchor (both hands in Double; skipped in Random) → stroke along the virtual rod. Only strokes made while gripping inside the rod zone count. Open palm again to replay. Keyboard mode (`↑` `↓`) is available without a camera.

Switch language with the VI / EN toggle. All tuning constants are documented at the top of `game.js`.
