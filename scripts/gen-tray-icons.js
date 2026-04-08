// Generate rotating blue cube tray icon frames (32x32 PNG)
// Run with: node scripts/gen-tray-icons.js

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ─── Minimal PNG Encoder ────────────────────────────────────────────────────

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC32_TABLE[i] = c;
}

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ ~0) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const payload = Buffer.concat([t, data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(payload), 0);
  return Buffer.concat([len, payload, c]);
}

function createPNG(width, height, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  // Build raw scanlines with filter byte 0 per row
  const rowBytes = 1 + width * 4;
  const raw = Buffer.alloc(height * rowBytes);
  for (let y = 0; y < height; y++) {
    raw[y * rowBytes] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = y * rowBytes + 1 + x * 4;
      raw[di] = pixels[si];
      raw[di + 1] = pixels[si + 1];
      raw[di + 2] = pixels[si + 2];
      raw[di + 3] = pixels[si + 3];
    }
  }

  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─── Pixel buffer helpers ───────────────────────────────────────────────────

function setPixel(buf, w, h, x, y, r, g, b, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || x >= w || y < 0 || y >= h) return;
  const i = (y * w + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}

function drawLine(buf, w, h, x0, y0, x1, y1, r, g, b) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), 1));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    setPixel(buf, w, h, x0 + dx * t, y0 + dy * t, r, g, b, 255);
  }
}

function fillTriangle(buf, w, h, ax, ay, bx, by, cx, cy, r, g, b) {
  // Bounding box
  let minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  let maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
  let minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  let maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      // Barycentric test
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 0.001) continue;
      const u = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
      const v = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
      const ww = 1 - u - v;
      if (u >= -0.01 && v >= -0.01 && ww >= -0.01) {
        setPixel(buf, w, h, px, py, r, g, b, 255);
      }
    }
  }
}

function fillQuad(buf, w, h, pts, r, g, b) {
  fillTriangle(buf, w, h, pts[0][0], pts[0][1], pts[1][0], pts[1][1], pts[2][0], pts[2][1], r, g, b);
  fillTriangle(buf, w, h, pts[0][0], pts[0][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1], r, g, b);
}

// ─── 3D Cube Renderer ──────────────────────────────────────────────────────

function drawCube(size, angle) {
  const pixels = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const s = size * 0.30;

  // Rotation around Y
  const cosY = Math.cos(angle);
  const sinY = Math.sin(angle);
  // Slight tilt around X for 3D feel
  const tiltX = 0.45;
  const cosX = Math.cos(tiltX);
  const sinX = Math.sin(tiltX);

  // 3D cube vertices
  const verts3d = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1,  1], [1, -1,  1], [1, 1,  1], [-1, 1,  1],
  ];

  // Project: rotate Y, then tilt X, then orthographic
  function project(v) {
    let x = v[0], y = v[1], z = v[2];
    // Rotate Y
    const rx = x * cosY + z * sinY;
    const rz = -x * sinY + z * cosY;
    // Tilt X
    const ry = y * cosX - rz * sinX;
    const rz2 = y * sinX + rz * cosX;
    // Orthographic projection with slight perspective
    const scale = 1.0 + rz2 * 0.08;
    return { x: cx + rx * s * scale, y: cy + ry * s * scale, z: rz2 };
  }

  const projected = verts3d.map(project);

  // Faces with vertex indices + color
  const faces = [
    { idx: [0, 1, 2, 3], color: [25, 90, 210] },   // front
    { idx: [5, 4, 7, 6], color: [35, 110, 240] },   // back
    { idx: [4, 0, 3, 7], color: [15, 70, 185] },    // left
    { idx: [1, 5, 6, 2], color: [45, 130, 255] },   // right
    { idx: [3, 2, 6, 7], color: [60, 155, 255] },   // top
    { idx: [4, 5, 1, 0], color: [10, 50, 160] },    // bottom
  ];

  // Compute face normal Z to cull back faces and sort front-to-back
  function faceNormalZ(f) {
    const p = f.idx.map(i => projected[i]);
    const ax = p[1].x - p[0].x, ay = p[1].y - p[0].y;
    const bx = p[2].x - p[0].x, by = p[2].y - p[0].y;
    return ax * by - ay * bx; // cross product Z component
  }

  // Keep only faces facing the viewer (positive normal Z in screen space)
  const visible = faces.filter(f => faceNormalZ(f) > 0);

  // Sort by avg Z depth (farthest first = painter's)
  visible.sort((a, b) => {
    const za = a.idx.reduce((s, i) => s + projected[i].z, 0);
    const zb = b.idx.reduce((s, i) => s + projected[i].z, 0);
    return za - zb;
  });

  // Draw faces
  for (const face of visible) {
    const pts = face.idx.map(i => [projected[i].x, projected[i].y]);
    const [r, g, b] = face.color;
    fillQuad(pixels, size, size, pts, r, g, b);
  }

  // Draw edges (bright blue outline)
  const edges = [
    [0,1],[1,2],[2,3],[3,0],
    [4,5],[5,6],[6,7],[7,4],
    [0,4],[1,5],[2,6],[3,7],
  ];
  for (const [a, b] of edges) {
    const pa = projected[a], pb = projected[b];
    drawLine(pixels, size, size, pa.x, pa.y, pb.x, pb.y, 100, 200, 255);
  }

  return pixels;
}

// ─── Generate frames ────────────────────────────────────────────────────────

const FRAMES = 12;
const SIZE = 32;
const outDir = path.join(__dirname, "..", "assets");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

let totalFilledPixels = 0;

for (let i = 0; i < FRAMES; i++) {
  const angle = (i / FRAMES) * Math.PI * 2;
  const pixels = drawCube(SIZE, angle);
  const filled = countFilled(pixels);
  totalFilledPixels += filled;
  const png = createPNG(SIZE, SIZE, pixels);
  const outPath = path.join(outDir, `tray-${i}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`tray-${i}.png: ${png.length} bytes, ${filled} filled pixels`);
}

// Static icon
const staticPixels = drawCube(SIZE, Math.PI / 6);
fs.writeFileSync(path.join(outDir, "tray-icon.png"), createPNG(SIZE, SIZE, staticPixels));
console.log(`tray-icon.png: ${countFilled(staticPixels)} filled pixels`);

// Larger app icon (64x64)
const largePixels = drawCube(64, Math.PI / 6);
fs.writeFileSync(path.join(outDir, "icon.png"), createPNG(64, 64, largePixels));
console.log(`icon.png: ${countFilled(largePixels)} filled pixels`);

console.log(`\nTotal filled pixels across ${FRAMES} frames: ${totalFilledPixels}`);
if (totalFilledPixels === 0) {
  console.error("ERROR: No pixels were rendered! Something is wrong.");
  process.exit(1);
}

function countFilled(pixels) {
  let n = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) n++;
  return n;
}
