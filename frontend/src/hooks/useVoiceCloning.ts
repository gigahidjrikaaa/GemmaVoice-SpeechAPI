import { useState } from 'react';
import { fileToBase64 } from '../lib/audioUtils';

/**
 * Custom hook for managing voice cloning functionality
 * Handles reference file management and base64 encoding
 */
export function useVoiceCloning() {
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [useVoiceCloning, setUseVoiceCloning] = useState(false);

  /**
   * Add new reference files
   * @param files - FileList or File array to add
   */
  const addReferenceFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    
    const fileArray = Array.isArray(files) ? files : Array.from(files);
    setReferenceFiles(prev => [...prev, ...fileArray]);
  };

  /**
   * Remove a reference file by index
   * @param index - Index of file to remove
   */
  const removeReferenceFile = (index: number) => {
    setReferenceFiles(prev => prev.filter((_, i) => i !== index));
  };

  /**
   * Clear all reference files
   */
  const clearReferenceFiles = () => {
    setReferenceFiles([]);
  };

  /**
   * Get base64 encoded references for API request
   * @returns Promise resolving to array of base64 strings (empty if voice cloning disabled)
   */
  const getReferences = async (): Promise<string[]> => {
    if (!useVoiceCloning || referenceFiles.length === 0) {
      return [];
    }
    
    try {
      const references = await Promise.all(
        referenceFiles.map(file => fileToBase64(file))
      );
      return references;
    } catch (error) {
      console.error('Error encoding reference files:', error);
      throw new Error('Failed to encode reference audio files');
    }
  };

  /**
   * Validate reference files (3-10 seconds recommended)
   * @returns Object with isValid flag and error message if invalid
   */
  const validateReferences = (): { isValid: boolean; error?: string } => {
    if (!useVoiceCloning) {
      return { isValid: true };
    }

    if (referenceFiles.length === 0) {
      return { 
        isValid: false, 
        error: 'Please upload at least one reference audio file' 
      };
    }

    if (referenceFiles.length > 5) {
      return { 
        isValid: false, 
        error: 'Maximum 5 reference files allowed' 
      };
    }

    return { isValid: true };
  };

  return {
    referenceFiles,
    useVoiceCloning,
    setUseVoiceCloning,
    addReferenceFiles,
    removeReferenceFile,
    clearReferenceFiles,
    getReferences,
    validateReferences,
  };
}
