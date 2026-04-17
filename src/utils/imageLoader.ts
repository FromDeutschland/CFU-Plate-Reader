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

async function loadRaw(file: File): Promise<string> {
  // Canon CR2 and many RAW files embed a full-size JPEG preview starting with FF D8
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Search for JPEG SOI marker (FF D8 FF)
  let lastJpegStart = -1;
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      lastJpegStart = i;
    }
  }

  if (lastJpegStart === -1) {
    throw new Error(
      'Could not find embedded JPEG preview in RAW file. Please export as JPEG or TIFF first.'
    );
  }

  const jpegBytes = bytes.slice(lastJpegStart);
  const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
  return readAsDataURL(blob);
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
    img.onerror = () => reject(new Error('Failed to load image'));
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
