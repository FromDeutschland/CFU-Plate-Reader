export async function loadImageFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".heic") || name.endsWith(".heif")) return loadHeic(file);
  if (isRawFormat(name)) return loadRaw(file);
  return readAsDataURL(file);
}

function isRawFormat(name: string): boolean {
  return [".cr2", ".cr3", ".nef", ".arw", ".dng", ".orf", ".rw2", ".raf"].some((ext) =>
    name.endsWith(ext),
  );
}

async function loadHeic(file: File): Promise<string> {
  try {
    const heic2any = (await import("heic2any")).default;
    const blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.95 });
    const resultBlob = Array.isArray(blob) ? blob[0] : blob;
    return readAsDataURL(resultBlob as Blob);
  } catch {
    throw new Error("Failed to decode HEIC/HEIF file. Make sure the file is a valid HEIC image.");
  }
}

// Canon CR2 / CR3, Nikon NEF, Sony ARW, Adobe DNG and most RAW containers are
// TIFF-based. We walk IFDs, collect JPEG-looking strips, filter lossless (SOF3),
// and pick the largest displayable preview.
async function loadRaw(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const jpeg = extractTiffJpegPreview(bytes) ?? extractLargestEmbeddedJpeg(bytes);
  if (!jpeg) {
    throw new Error(
      "Could not find a displayable JPEG preview inside this RAW file. " +
        "Please export as JPEG or TIFF first.",
    );
  }
  const buf = new ArrayBuffer(jpeg.byteLength);
  new Uint8Array(buf).set(jpeg);
  const blob = new Blob([buf], { type: "image/jpeg" });
  return readAsDataURL(blob);
}

function isDisplayableJpeg(bytes: Uint8Array, offset: number, length: number): boolean {
  if (bytes[offset] !== 0xff || bytes[offset + 1] !== 0xd8 || bytes[offset + 2] !== 0xff) return false;
  const end = Math.min(offset + length, offset + 65536);
  for (let i = offset + 2; i < end - 1; i++) {
    if (bytes[i] !== 0xff) continue;
    const m = bytes[i + 1];
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) return true;
    if (m === 0xc3 || m === 0xc5 || m === 0xc7 || m === 0xc9 || m === 0xcb || m === 0xcd || m === 0xcf) return false;
    if (m === 0xd9) break;
  }
  return true;
}

interface JpegCandidate { offset: number; length: number; ifd: number }

function extractTiffJpegPreview(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 16) return null;
  const bo = String.fromCharCode(bytes[0], bytes[1]);
  if (bo !== "II" && bo !== "MM") return null;
  const le = bo === "II";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const r16 = (o: number) => view.getUint16(o, le);
  const r32 = (o: number) => view.getUint32(o, le);
  if (r16(2) !== 42) return null;

  const candidates: JpegCandidate[] = [];
  const visited = new Set<number>();

  function walk(ifdOffset: number, depth = 0) {
    if (depth > 8) return;
    if (ifdOffset < 8 || ifdOffset >= bytes.length - 2) return;
    if (visited.has(ifdOffset)) return;
    visited.add(ifdOffset);

    const count = r16(ifdOffset);
    if (count === 0 || count > 4000) return;
    if (ifdOffset + 2 + count * 12 + 4 > bytes.length) return;

    let jpegOff = 0, jpegLen = 0, stripOff = 0, stripLen = 0, compression = 0;

    for (let i = 0; i < count; i++) {
      const entry = ifdOffset + 2 + i * 12;
      const tag = r16(entry);
      const type = r16(entry + 2);
      const cnt = r32(entry + 4);
      const valOff = r32(entry + 8);

      switch (tag) {
        case 0x0103: compression = cnt === 1 ? r16(entry + 8) : 0; break;
        case 0x0111: stripOff = cnt === 1 ? valOff : 0; break;
        case 0x0117: stripLen = cnt === 1 ? valOff : 0; break;
        case 0x0201: jpegOff = valOff; break;
        case 0x0202: jpegLen = valOff; break;
        case 0x014a: {
          if (type === 4) {
            if (cnt === 1) walk(valOff, depth + 1);
            else if (valOff + cnt * 4 <= bytes.length) {
              for (let k = 0; k < Math.min(cnt, 16); k++) walk(r32(valOff + k * 4), depth + 1);
            }
          }
          break;
        }
        case 0x8769: walk(valOff, depth + 1); break;
        case 0x927c: walk(valOff, depth + 1); break;
      }
    }

    if (jpegOff > 0 && jpegLen > 0 && jpegOff + jpegLen <= bytes.length) {
      candidates.push({ offset: jpegOff, length: jpegLen, ifd: ifdOffset });
    }
    if ((compression === 6 || compression === 7) && stripOff > 0 && stripLen > 0 && stripOff + stripLen <= bytes.length) {
      candidates.push({ offset: stripOff, length: stripLen, ifd: ifdOffset });
    }

    const nextIfd = r32(ifdOffset + 2 + count * 12);
    if (nextIfd > 0) walk(nextIfd, depth + 1);
  }

  walk(r32(4));

  const valid = candidates.filter((c) => c.length >= 1024 && isDisplayableJpeg(bytes, c.offset, c.length));
  if (valid.length === 0) return null;
  valid.sort((a, b) => b.length - a.length);
  const best = valid[0];
  return bytes.slice(best.offset, best.offset + best.length);
}

function extractLargestEmbeddedJpeg(bytes: Uint8Array): Uint8Array | null {
  const starts: number[] = [];
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] !== 0xff || bytes[i + 1] !== 0xd8 || bytes[i + 2] !== 0xff) continue;
    const m = bytes[i + 3];
    if ((m >= 0xe0 && m <= 0xef) || m === 0xdb || m === 0xc4 || m === 0xfe) starts.push(i);
  }
  let bestStart = -1, bestLen = 0;
  for (let si = 0; si < starts.length; si++) {
    const start = starts[si];
    const nextSoi = starts[si + 1] ?? bytes.length;
    let end = -1;
    for (let j = nextSoi - 2; j > start + 2; j--) {
      if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) { end = j + 2; break; }
    }
    if (end < 0) continue;
    const len = end - start;
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
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(blob);
  });
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image — embedded preview may be unsupported."));
    img.src = src;
  });
}
