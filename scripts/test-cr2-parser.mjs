// Node sanity-check that mirrors src/utils/imageLoader.ts — verifies the
// TIFF IFD walker + lossless-JPEG filter picks the right preview out of a
// real CR2 file (should land on the ~970 KiB baseline JPEG in IFD0, not
// the 25 MiB lossless-JPEG sensor stream in IFD3, nor the 9 KiB thumbnail
// in IFD1).

import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] ?? '/Users/alexanderholtkamp/Desktop/Colony Photos/IMG_2604.CR2';
const bytes = new Uint8Array(readFileSync(file));
console.log(`Loaded ${file} — ${bytes.length.toLocaleString()} bytes`);

const littleEndian = String.fromCharCode(bytes[0], bytes[1]) === 'II';
const view = new DataView(bytes.buffer);
const r16 = (o) => view.getUint16(o, littleEndian);
const r32 = (o) => view.getUint32(o, littleEndian);

function isDisplayableJpeg(bytes, offset, length) {
  if (bytes[offset] !== 0xff || bytes[offset + 1] !== 0xd8 || bytes[offset + 2] !== 0xff) return false;
  const end = Math.min(offset + length, offset + 65536);
  for (let i = offset + 2; i < end - 1; i++) {
    if (bytes[i] !== 0xff) continue;
    const m = bytes[i + 1];
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) return true;
    if ([0xc3, 0xc5, 0xc7, 0xc9, 0xcb, 0xcd, 0xcf].includes(m)) return false;
    if (m === 0xd9) break;
  }
  return true;
}

const candidates = [];
const visited = new Set();

function walk(off, depth = 0, lbl = '') {
  if (depth > 8 || off < 8 || off >= bytes.length - 2 || visited.has(off)) return;
  visited.add(off);
  const count = r16(off);
  if (count === 0 || count > 4000 || off + 2 + count * 12 + 4 > bytes.length) return;
  let jpegOff = 0, jpegLen = 0, stripOff = 0, stripLen = 0, compression = 0;
  for (let i = 0; i < count; i++) {
    const entry = off + 2 + i * 12;
    const tag = r16(entry), type = r16(entry + 2), cnt = r32(entry + 4), v = r32(entry + 8);
    switch (tag) {
      case 0x0103: compression = cnt === 1 ? r16(entry + 8) : 0; break;
      case 0x0111: stripOff = cnt === 1 ? v : 0; break;
      case 0x0117: stripLen = cnt === 1 ? v : 0; break;
      case 0x0201: jpegOff = v; break;
      case 0x0202: jpegLen = v; break;
      case 0x014A: if (type === 4) { if (cnt === 1) walk(v, depth+1, lbl+'>SubIFD'); else for (let k = 0; k < Math.min(cnt, 16); k++) walk(r32(v + k*4), depth+1, lbl+'>SubIFD'); } break;
      case 0x8769: walk(v, depth+1, lbl+'>Exif'); break;
      case 0x927C: walk(v, depth+1, lbl+'>MakerNote'); break;
    }
  }
  if (jpegOff > 0 && jpegLen > 0 && jpegOff + jpegLen <= bytes.length)
    candidates.push({ offset: jpegOff, length: jpegLen, src: `${lbl||'IFD0'}@${off} tag0201/0202` });
  if ((compression === 6 || compression === 7) && stripOff > 0 && stripLen > 0 && stripOff + stripLen <= bytes.length)
    candidates.push({ offset: stripOff, length: stripLen, src: `${lbl||'IFD0'}@${off} strip compression=${compression}` });
  const next = r32(off + 2 + count * 12);
  if (next > 0) walk(next, depth+1, lbl+'>next');
}

walk(r32(4));

console.log(`\n${candidates.length} JPEG candidates found:`);
candidates.forEach((c, i) => {
  const disp = isDisplayableJpeg(bytes, c.offset, c.length);
  console.log(`  [${i}] off=${c.offset.toString().padStart(10)} len=${c.length.toString().padStart(10).padStart(10)}  displayable=${disp ? 'YES' : 'NO ' }  ${c.src}`);
});

const valid = candidates.filter(c => c.length >= 1024 && isDisplayableJpeg(bytes, c.offset, c.length));
valid.sort((a, b) => b.length - a.length);
if (valid.length === 0) { console.error('\n❌ No displayable preview found.'); process.exit(1); }
const best = valid[0];
console.log(`\n✅ Picked: ${best.src} — ${best.length.toLocaleString()} bytes (${(best.length/1024/1024).toFixed(2)} MB)`);
writeFileSync('/tmp/cr2-preview.jpg', bytes.slice(best.offset, best.offset + best.length));
console.log('Wrote /tmp/cr2-preview.jpg — open it to eyeball the preview.');
