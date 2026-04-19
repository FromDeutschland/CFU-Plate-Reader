export async function loadImageFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.heic') || name.endsWith('.heif')) {
    return loadHeic(file);
  }

  if (isRawFormat(name)) {
    return loadRaw(file);
  }

  return readAsDataURL(file);
}

function isRawFormat(name: string): boolean {
  return ['.cr2', '.cr3', '.nef', '.arw', '.dng', '.orf', '.rw2', '.raf'].some(ext =>
    name.endsWith(ext)
  );
}

async function loadHeic(file: File): Promise<string> {
  try {
    const heic2any = (await import('heic2any')).default;
    const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
    const resultBlob = Array.isArray(blob) ? blob[0] : blob;
    return readAsDataURL(resultBlob as Blob);
  } catch {
    throw new Error('Failed to decode HEIC/HEIF file. Make sure the file is a valid HEIC image.');
  }
}

// ── RAW loader ────────────────────────────────────────────────────────────
//
// Canon CR2 / CR3, Nikon NEF, Sony ARW, Adobe DNG and most RAW containers are
// TIFF-based. Camera previews live as JPEG streams inside specific IFD tags:
//
//   • Canon CR2 IFD0  — compression=6 (old-style JPEG) strip → 1 MP preview
//   • Canon CR2 IFD1  — tag 0x0201/0x0202 → tiny 9 KB thumbnail
//   • Canon CR2 IFD3  — compression=6 strip → lossless JPEG of raw sensor
//                       (non-displayable — browsers only handle baseline/DCT)
//   • Nikon NEF       — compression=6 strip in IFD0 or NEFInfo
//   • DNG / ARW       — compression=7 (new JPEG) strip
//
// We walk the full IFD tree, collect every JPEG-looking strip we can find,
// filter out lossless SOF3 streams, and pick the largest valid preview.

async function loadRaw(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const jpeg = extractTiffJpegPreview(bytes) ?? extractLargestEmbeddedJpeg(bytes);
  if (!jpeg) {
    throw new Error(
      'Could not find a displayable JPEG preview inside this RAW file. ' +
      'Please export as JPEG or TIFF first.'
    );
  }

  // Copy into a fresh ArrayBuffer so Blob() is happy under strict TS lib.dom
  const buf = new ArrayBuffer(jpeg.byteLength);
  new Uint8Array(buf).set(jpeg);
  const blob = new Blob([buf], { type: 'image/jpeg' });
  return readAsDataURL(blob);
}

// ── JPEG validation ───────────────────────────────────────────────────────

/**
 * Is the JPEG at [offset..offset+length) something browsers can actually decode?
 * Baseline DCT (SOF0), extended DCT (SOF1), progressive DCT (SOF2) → yes.
 * Lossless (SOF3) and the differential/arithmetic variants → no (that's the
 * RAW sensor stream in CR2 IFD3, not a preview).
 */
function isDisplayableJpeg(bytes: Uint8Array, offset: number, length: number): boolean {
  if (bytes[offset] !== 0xff || bytes[offset + 1] !== 0xd8 || bytes[offset + 2] !== 0xff) return false;

  const end = Math.min(offset + length, offset + 65536); // scan up to 64 KiB of header
  for (let i = offset + 2; i < end - 1; i++) {
    if (bytes[i] !== 0xff) continue;
    const m = bytes[i + 1];
    // Displayable SOF: baseline, extended, progressive
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) return true;
    // Lossless / differential / arithmetic SOFs — browsers won't decode these
    if (m === 0xc3 || m === 0xc5 || m === 0xc7
        || m === 0xc9 || m === 0xcb || m === 0xcd || m === 0xcf) return false;
    if (m === 0xd9) break; // EOI reached
  }
  return true; // SOF not found in header — give the browser a chance anyway
}

// ── TIFF/IFD walker → find every embedded JPEG, pick the best ────────────

interface JpegCandidate { offset: number; length: number; ifd: number }

function extractTiffJpegPreview(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 16) return null;

  const bo = String.fromCharCode(bytes[0], bytes[1]);
  if (bo !== 'II' && bo !== 'MM') return null;
  const littleEndian = bo === 'II';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const r16 = (o: number) => view.getUint16(o, littleEndian);
  const r32 = (o: number) => view.getUint32(o, littleEndian);

  const magic = r16(2);
  if (magic !== 42) return null; // CR3 / heic / non-TIFF

  const candidates: JpegCandidate[] = [];
  const visited = new Set<number>();

  function walkIfd(ifdOffset: number, depth = 0) {
    if (depth > 8) return;
    if (ifdOffset < 8 || ifdOffset >= bytes.length - 2) return;
    if (visited.has(ifdOffset)) return;
    visited.add(ifdOffset);

    const count = r16(ifdOffset);
    if (count === 0 || count > 4000) return;
    if (ifdOffset + 2 + count * 12 + 4 > bytes.length) return;

    let jpegOff = 0, jpegLen = 0, stripOff = 0, stripLen = 0;
    let compression = 0;

    for (let i = 0; i < count; i++) {
      const entry = ifdOffset + 2 + i * 12;
      const tag = r16(entry);
      const type = r16(entry + 2);
      const cnt = r32(entry + 4);
      const valOff = r32(entry + 8);

      switch (tag) {
        case 0x0103: compression = cnt === 1 ? r16(entry + 8) : 0; break;  // Compression
        case 0x0111: stripOff = cnt === 1 ? valOff : 0; break;              // StripOffsets
        case 0x0117: stripLen = cnt === 1 ? valOff : 0; break;              // StripByteCounts
        case 0x0201: jpegOff = valOff; break;                                // JPEGInterchangeFormat
        case 0x0202: jpegLen = valOff; break;                                // JPEGInterchangeFormatLength
        case 0x014A: {                                                       // SubIFDs
          if (type === 4) {
            if (cnt === 1) {
              walkIfd(valOff, depth + 1);
            } else if (valOff + cnt * 4 <= bytes.length) {
              for (let k = 0; k < Math.min(cnt, 16); k++) {
                walkIfd(r32(valOff + k * 4), depth + 1);
              }
            }
          }
          break;
        }
        case 0x8769: walkIfd(valOff, depth + 1); break;                      // EXIF IFD
        case 0x927C: walkIfd(valOff, depth + 1); break;                      // MakerNote (Canon = nested IFD)
        default: break;
      }
    }

    // Thumbnail-style preview: tag 0x0201 + 0x0202 (most TIFFs)
    if (jpegOff > 0 && jpegLen > 0 && jpegOff + jpegLen <= bytes.length) {
      candidates.push({ offset: jpegOff, length: jpegLen, ifd: ifdOffset });
    }
    // Strip-based preview: compression=6 (old JPEG) or 7 (new JPEG).
    // CR2 IFD0 is compression=6 strip with the 1 MP preview.
    if ((compression === 6 || compression === 7)
        && stripOff > 0 && stripLen > 0
        && stripOff + stripLen <= bytes.length) {
      candidates.push({ offset: stripOff, length: stripLen, ifd: ifdOffset });
    }

    const nextIfd = r32(ifdOffset + 2 + count * 12);
    if (nextIfd > 0) walkIfd(nextIfd, depth + 1);
  }

  walkIfd(r32(4));

  // Accept only candidates that start with a valid SOI and are NOT lossless.
  // This is what rejects the CR2 IFD3 RAW-sensor lossless JPEG.
  const valid = candidates.filter(c =>
    c.length >= 1024 && isDisplayableJpeg(bytes, c.offset, c.length)
  );
  if (valid.length === 0) return null;

  // Pick the largest valid JPEG — that's the highest-resolution preview.
  valid.sort((a, b) => b.length - a.length);
  const best = valid[0];
  return bytes.slice(best.offset, best.offset + best.length);
}

// ── Fallback: self-consistent displayable JPEG (SOI…EOI) somewhere inside ─

function extractLargestEmbeddedJpeg(bytes: Uint8Array): Uint8Array | null {
  // A valid JPEG starts with FF D8 FF followed by a segment marker.
  // Browsers typically see APP0-APP15 (0xE0-0xEF) or DQT (0xDB) or COM (0xFE).
  // Lossless-RAW streams start FF D8 FF DB as well, but we filter by SOF below.
  const starts: number[] = [];
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] !== 0xff || bytes[i + 1] !== 0xd8 || bytes[i + 2] !== 0xff) continue;
    const m = bytes[i + 3];
    if ((m >= 0xe0 && m <= 0xef) || m === 0xdb || m === 0xc4 || m === 0xfe) {
      starts.push(i);
    }
  }

  let bestStart = -1;
  let bestLen = 0;

  for (let si = 0; si < starts.length; si++) {
    const start = starts[si];
    const nextSoi = starts[si + 1] ?? bytes.length;

    // Find the last FF D9 (EOI) before the next SOI
    let end = -1;
    for (let j = nextSoi - 2; j > start + 2; j--) {
      if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) { end = j + 2; break; }
    }
    if (end < 0) continue;
    const len = end - start;

    // Skip lossless JPEGs — the CR2 IFD3 RAW-sensor stream matches a raw scan
    // but can't be rendered by the browser. isDisplayableJpeg inspects the SOF.
    if (!isDisplayableJpeg(bytes, start, len)) continue;

    if (len > bestLen) { bestLen = len; bestStart = start; }
  }

  if (bestStart < 0 || bestLen < 1024) return null;
  return bytes.slice(bestStart, bestStart + bestLen);
}

function readAsDataURL(blob: Blob | File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(blob);
  });
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image — the embedded preview may be unsupported.'));
    img.src = src;
  });
}

export function getImageData(img: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
