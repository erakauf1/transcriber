// Generates solid-background mic icons as PNGs with no image dependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BG = [0x4f, 0x46, 0xe5]; // indigo #4f46e5
const FG = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Distance from point (px,py) to vertical segment x=cx, y in [y1,y2]
function distToVSeg(px, py, cx, y1, y2) {
  const cy = Math.max(y1, Math.min(y2, py));
  return Math.hypot(px - cx, py - cy);
}

function isForeground(x, y, size) {
  const cx = size / 2;
  // Mic head: vertical capsule
  if (distToVSeg(x, y, cx, size * 0.28, size * 0.46) < size * 0.13) return true;
  // Stem
  if (distToVSeg(x, y, cx, size * 0.60, size * 0.72) < size * 0.035) return true;
  // Base bar
  if (Math.abs(y - size * 0.75) < size * 0.025 && Math.abs(x - cx) < size * 0.13) return true;
  return false;
}

export function makePng(size) {
  // Raw image data: each scanline is a filter byte (0) + RGB pixels
  const raw = Buffer.alloc(size * (1 + size * 3));
  let off = 0;
  for (let y = 0; y < size; y++) {
    raw[off++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = isForeground(x, y, size) ? FG : BG;
      raw[off++] = r; raw[off++] = g; raw[off++] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB
  // bytes 10-12: compression, filter, interlace = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function main() {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
  mkdirSync(outDir, { recursive: true });
  for (const size of [180, 192, 512]) {
    writeFileSync(join(outDir, `icon-${size}.png`), makePng(size));
    console.log(`wrote icon-${size}.png`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
