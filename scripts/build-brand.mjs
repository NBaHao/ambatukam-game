// Xuất favicon, icon cài app và ảnh preview chia sẻ link từ hai file nguồn SVG:
//   favicon.svg  → favicon.ico, apple-touch-icon.png, assets/icon-*.png
//   brand/og.svg → og.png
// Chạy: npm run brand (sau khi sửa SVG), rồi commit các file được tạo ra.
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const path = (p) => new URL(p, root);
const icon = await readFile(path("favicon.svg"));
const og = await readFile(path("brand/og.svg"));

// density cao để SVG được vẽ nét ở cỡ lớn rồi mới thu nhỏ
const png = (svg, size, opts = {}) => {
  let img = sharp(svg, { density: 1200 }).resize(size, size);
  if (opts.flatten) img = img.flatten({ background: "#0b0b0b" });
  return img.png({ compressionLevel: 9 }).toBuffer();
};

// Maskable: Android cắt icon theo hình tròn/bo góc, nên nội dung phải nằm trong vùng an toàn 80% giữa
const maskable = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0b0b0b"/>` +
  `<rect x="21" y="21" width="22" height="22" fill="#ff3b3b"/></svg>`
);

const out = {
  "favicon.ico": await pngToIco([await png(icon, 16), await png(icon, 32), await png(icon, 48)]),
  // iOS tự bo góc và không hỗ trợ trong suốt → nền đặc
  "apple-touch-icon.png": await png(icon, 180, { flatten: true }),
  "assets/icon-192.png": await png(icon, 192),
  "assets/icon-512.png": await png(icon, 512),
  "assets/icon-maskable-512.png": await png(maskable, 512),
  "og.png": await sharp(og, { density: 144 }).resize(1200, 630).png({ compressionLevel: 9 }).toBuffer(),
};
for (const [file, buf] of Object.entries(out)) {
  await writeFile(path(file), buf);
  console.log(`${file.padEnd(30)} ${(buf.length / 1024).toFixed(1)} KB`);
}
