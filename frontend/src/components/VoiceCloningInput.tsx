import { ChangeEvent, useEffect, useState } from 'react';
import { formatFileSize, getAudioDuration, formatDuration } from '../lib/audioUtils';

interface VoiceCloningInputProps {
  referenceFiles: File[];
  onFilesChange: (files: FileList | null) => void;
  onFileRemove: (index: number) => void;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  maxFiles?: number;
  className?: string;
}

interface FileInfo {
  file: File;
  duration?: number;
  objectUrl?: string;
}

export function VoiceCloningInput({
  referenceFiles,
  onFilesChange,
  onFileRemove,
  enabled,
  onEnabledChange,
  maxFiles = 5,
  className = '',
}: VoiceCloningInputProps) {
  const [fileInfos, setFileInfos] = useState<FileInfo[]>([]);

  // Load file metadata when files change
  useEffect(() => {
    const loadFileInfo = async () => {
      const infos = await Promise.all(
        referenceFiles.map(async (file) => {
          try {
            const duration = await getAudioDuration(file);
            const objectUrl = URL.createObjectURL(file);
            return { file, duration, objectUrl };
          } catch (error) {
            console.error('Error loading file info:', error);
            return { file };
          }
        })
      );
      setFileInfos(infos);
    };

    loadFileInfo();

    // Cleanup object URLs on unmount or when files change
    return () => {
      fileInfos.forEach((info) => {
        if (info.objectUrl) {
          URL.revokeObjectURL(info.objectUrl);
        }
      });
    };
  }, [referenceFiles]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    onFilesChange(event.target.files);
    // Reset input value to allow re-selecting the same file
    event.target.value = '';
  };

  const handleRemoveFile = (index: number) => {
    const info = fileInfos[index];
    if (info?.objectUrl) {
      URL.revokeObjectURL(info.objectUrl);
    }
    onFileRemove(index);
  };

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Enable/Disable Toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
        />
        <span className="text-sm font-medium">
          Enable Voice Cloning
        </span>
      </label>

      {/* Instructions */}
      {enabled && (
        <p className="text-xs text-slate-400">
          Upload 1-{maxFiles} reference audio files (3-10 seconds each recommended) to clone the voice characteristics.
        </p>
      )}

      {/* File Upload Input */}
      {enabled && referenceFiles.length < maxFiles && (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed border-slate-700 bg-slate-900/50 px-4 py-6 transition-colors hover:border-slate-600 hover:bg-slate-900">
          <svg
            className="h-8 w-8 text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <span className="text-sm text-slate-300">
            Click to upload reference audio
          </span>
          <span className="text-xs text-slate-500">
            WAV, MP3, OGG, FLAC, WebM
          </span>
          <input
            type="file"
            accept="audio/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />
        </label>
      )}

      {/* File List with Preview */}
      {enabled && fileInfos.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Reference Files ({fileInfos.length}/{maxFiles})
          </span>
          {fileInfos.map((info, index) => (
            <div
              key={index}
              className="flex items-center gap-3 rounded-md border border-slate-700 bg-slate-900 p-3"
            >
              {/* Audio Preview */}
              {info.objectUrl && (
                <audio
                  controls
                  src={info.objectUrl}
                  className="h-8 flex-1 text-xs"
                  preload="metadata"
                />
              )}
              
              {/* File Info */}
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="truncate text-xs font-medium text-slate-200">
                  {info.file.name}
                </span>
                <span className="text-xs text-slate-500">
                  {formatFileSize(info.file.size)}
                  {info.duration && ` • ${formatDuration(info.duration)}`}
                </span>
              </div>

              {/* Remove Button */}
              <button
                type="button"
                onClick={() => handleRemoveFile(index)}
                className="shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-900/20 hover:text-red-400"
                aria-label={`Remove ${info.file.name}`}
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Warning when at max files */}
      {enabled && referenceFiles.length >= maxFiles && (
        <p className="text-xs text-yellow-400">
          Maximum {maxFiles} files reached. Remove files to upload more.
        </p>
      )}

      {/* Duration Warning */}
      {enabled && fileInfos.some((info) => info.duration && (info.duration < 3 || info.duration > 10)) && (
        <p className="text-xs text-orange-400">
          ⚠️ For best results, use audio clips between 3-10 seconds.
        </p>
      )}
    </div>
  );
}
