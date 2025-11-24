/**
 * Audio utility functions for encoding, decoding, and handling audio files
 */

/**
 * Convert a File or Blob to a base64 encoded string (without data URI prefix)
 * @param file - The audio file to convert
 * @returns Promise resolving to base64 string
 */
export const fileToBase64 = (file: File | Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URI prefix (e.g., "data:audio/wav;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Convert a base64 encoded string to a Blob
 * @param base64 - Base64 encoded audio data
 * @param mimeType - MIME type for the blob (e.g., 'audio/wav', 'audio/mp3')
 * @returns Blob containing the audio data
 */
export const base64ToBlob = (base64: string, mimeType: string): Blob => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
};

/**
 * Create an object URL from base64 audio data
 * @param base64 - Base64 encoded audio data
 * @param mimeType - MIME type for the audio
 * @returns Object URL that can be used in audio elements
 */
export const base64ToObjectURL = (base64: string, mimeType: string): string => {
  const blob = base64ToBlob(base64, mimeType);
  return URL.createObjectURL(blob);
};

/**
 * Get MIME type from audio format string
 * @param format - Audio format (e.g., 'wav', 'mp3', 'ogg', 'flac')
 * @returns Full MIME type string
 */
export const getMimeType = (format: string): string => {
  const mimeTypes: Record<string, string> = {
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    webm: 'audio/webm',
  };
  return mimeTypes[format.toLowerCase()] || 'audio/wav';
};

/**
 * Validate audio file type
 * @param file - File to validate
 * @param allowedTypes - Array of allowed MIME types (optional)
 * @returns true if file type is valid
 */
export const isValidAudioFile = (
  file: File,
  allowedTypes: string[] = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/webm', 'audio/flac']
): boolean => {
  return allowedTypes.includes(file.type);
};

/**
 * Format file size for display
 * @param bytes - File size in bytes
 * @returns Formatted string (e.g., "1.5 MB")
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

/**
 * Format audio duration for display
 * @param seconds - Duration in seconds
 * @returns Formatted string (e.g., "1:23")
 */
export const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Get audio file duration
 * @param file - Audio file
 * @returns Promise resolving to duration in seconds
 */
export const getAudioDuration = (file: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.onloadedmetadata = () => {
      resolve(audio.duration);
      URL.revokeObjectURL(audio.src);
    };
    audio.onerror = reject;
    audio.src = URL.createObjectURL(file);
  });
};
