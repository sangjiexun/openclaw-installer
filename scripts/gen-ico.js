const sharp = require("sharp");
const fs = require("fs");

async function main() {
  // Resize icon to 256x256 PNG first
  await sharp("assets/icon.png")
    .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile("assets/icon-256.png");
  console.log("icon-256.png created (256x256)");

  // Generate ICO with multiple sizes embedded
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = [];
  for (const s of sizes) {
    const buf = await sharp("assets/icon.png")
      .resize(s, s, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true });
    images.push({ size: s, data: buf.data, width: buf.info.width, height: buf.info.height });
  }

  // Build ICO file manually
  const headerSize = 6;
  const entrySize = 16;
  const numImages = images.length;
  let offset = headerSize + entrySize * numImages;

  // Each image: BMP header (40 bytes) + pixel data
  const bmpEntries = [];
  for (const img of images) {
    const w = img.size;
    const h = img.size;
    const pixelDataSize = w * h * 4; // BGRA
    const bmpHeaderSize = 40;
    const dataSize = bmpHeaderSize + pixelDataSize;

    // BMP INFO HEADER
    const bmp = Buffer.alloc(dataSize);
    bmp.writeUInt32LE(40, 0);           // header size
    bmp.writeInt32LE(w, 4);             // width
    bmp.writeInt32LE(h * 2, 8);         // height (doubled for ICO)
    bmp.writeUInt16LE(1, 12);           // planes
    bmp.writeUInt16LE(32, 14);          // bpp
    bmp.writeUInt32LE(0, 16);           // compression
    bmp.writeUInt32LE(pixelDataSize, 20); // image size
    // rest is zero

    // Convert RGBA to BGRA, bottom-up
    for (let y = h - 1; y >= 0; y--) {
      for (let x = 0; x < w; x++) {
        const srcIdx = (y * w + x) * 4;
        const dstIdx = bmpHeaderSize + ((h - 1 - y) * w + x) * 4;
        bmp[dstIdx + 0] = img.data[srcIdx + 2]; // B
        bmp[dstIdx + 1] = img.data[srcIdx + 1]; // G
        bmp[dstIdx + 2] = img.data[srcIdx + 0]; // R
        bmp[dstIdx + 3] = img.data[srcIdx + 3]; // A
      }
    }
    bmpEntries.push({ w, h, buf: bmp, offset });
    offset += dataSize;
  }

  // Write ICO
  const ico = Buffer.alloc(offset);
  // Header
  ico.writeUInt16LE(0, 0);       // reserved
  ico.writeUInt16LE(1, 2);       // type (1=ICO)
  ico.writeUInt16LE(numImages, 4); // count

  // Directory entries
  for (let i = 0; i < bmpEntries.length; i++) {
    const e = bmpEntries[i];
    const pos = headerSize + i * entrySize;
    ico[pos + 0] = e.w >= 256 ? 0 : e.w;   // width (0 = 256)
    ico[pos + 1] = e.h >= 256 ? 0 : e.h;   // height
    ico[pos + 2] = 0;                        // colors
    ico[pos + 3] = 0;                        // reserved
    ico.writeUInt16LE(1, pos + 4);           // planes
    ico.writeUInt16LE(32, pos + 6);          // bpp
    ico.writeUInt32LE(e.buf.length, pos + 8);  // data size
    ico.writeUInt32LE(e.offset, pos + 12);     // data offset
  }

  // Image data
  for (const e of bmpEntries) {
    e.buf.copy(ico, e.offset);
  }

  fs.writeFileSync("assets/icon.ico", ico);
  console.log("icon.ico created, size:", ico.length, "bytes");
}
main().catch(console.error);
