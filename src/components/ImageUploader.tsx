import { useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { Upload, ImageIcon } from 'lucide-react';

interface Props {
  onImageLoaded: (file: File) => void;
  loading: boolean;
}

const ACCEPTED = '.jpg,.jpeg,.png,.tif,.tiff,.heic,.heif,.cr2,.cr3,.nef,.arw,.dng,.orf,.rw2,.raf';

export function ImageUploader({ onImageLoaded, loading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    onImageLoaded(files[0]);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    handleFiles(e.target.files);
    e.target.value = '';
  }

  return (
    <div
      className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-12 cursor-pointer transition-all duration-200
        ${dragging
          ? 'border-blue-400 bg-blue-950/40 scale-[1.01]'
          : 'border-slate-600 bg-slate-800/50 hover:border-blue-500 hover:bg-slate-800'
        }`}
      onDrop={onDrop}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={onChange}
      />

      {loading ? (
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-300 text-sm">Processing image…</p>
        </div>
      ) : (
        <>
          <div className="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center mb-4">
            {dragging ? (
              <ImageIcon className="w-8 h-8 text-blue-400" />
            ) : (
              <Upload className="w-8 h-8 text-slate-400" />
            )}
          </div>

          <h3 className="text-lg font-semibold text-slate-200 mb-1">
            {dragging ? 'Drop to upload' : 'Upload plate image'}
          </h3>
          <p className="text-sm text-slate-400 text-center max-w-sm">
            Drag & drop or click to browse. Supports JPG, PNG, TIFF, HEIC, Canon CR2/CR3, Nikon NEF,
            Sony ARW, DNG, and more.
          </p>
        </>
      )}
    </div>
  );
}
