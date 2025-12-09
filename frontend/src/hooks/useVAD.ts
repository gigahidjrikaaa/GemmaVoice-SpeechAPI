/**
 * Voice Activity Detection hook using Silero VAD via @ricky0123/vad-web
 * Automatically detects when the user starts/stops speaking
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { MicVAD, RealTimeVADOptions } from "@ricky0123/vad-web";

export interface VADState {
    /** Whether VAD is currently listening */
    isListening: boolean;
    /** Whether speech is currently detected */
    isSpeaking: boolean;
    /** Whether VAD is loading/initializing */
    isLoading: boolean;
    /** Any error that occurred */
    error: string | null;
}

export interface UseVADOptions {
    /** Callback when speech starts */
    onSpeechStart?: () => void;
    /** Callback when speech ends, receives the audio data */
    onSpeechEnd?: (audio: Float32Array) => void;
    /** Callback for each audio frame while speaking */
    onFrameProcessed?: (probabilities: { isSpeech: number; notSpeech: number }) => void;
    /** Positive speech threshold (0-1, default 0.5) */
    positiveSpeechThreshold?: number;
    /** Negative speech threshold (0-1, default 0.35) */
    negativeSpeechThreshold?: number;
    /** Redemption time in ms - how long to wait after speech ends before triggering (default 300) */
    redemptionMs?: number;
    /** Pre-speech pad in ms (default 100) */
    preSpeechPadMs?: number;
    /** Minimum speech duration in ms before triggering (default 150) */
    minSpeechMs?: number;
}

export interface UseVADReturn extends VADState {
    /** Start listening for speech */
    start: () => Promise<void>;
    /** Stop listening */
    stop: () => void;
    /** Pause without destroying (keeps mic open) */
    pause: () => void;
    /** Resume after pause */
    resume: () => void;
}

export function useVAD(options: UseVADOptions = {}): UseVADReturn {
    const {
        onSpeechStart,
        onSpeechEnd,
        onFrameProcessed,
        positiveSpeechThreshold = 0.5,
        negativeSpeechThreshold = 0.35,
        redemptionMs = 300,
        preSpeechPadMs = 100,
        minSpeechMs = 150,
    } = options;

    const [state, setState] = useState<VADState>({
        isListening: false,
        isSpeaking: false,
        isLoading: false,
        error: null,
    });

    const vadRef = useRef<MicVAD | null>(null);
    const callbacksRef = useRef({ onSpeechStart, onSpeechEnd, onFrameProcessed });

    // Keep callbacks ref updated
    useEffect(() => {
        callbacksRef.current = { onSpeechStart, onSpeechEnd, onFrameProcessed };
    }, [onSpeechStart, onSpeechEnd, onFrameProcessed]);

    const start = useCallback(async () => {
        if (vadRef.current) {
            console.log("[VAD] Already initialized, starting...");
            vadRef.current.start();
            setState(s => ({ ...s, isListening: true }));
            return;
        }

        setState(s => ({ ...s, isLoading: true, error: null }));

        try {
            console.log("[VAD] Initializing Silero VAD...");
            
            const vadOptions: Partial<RealTimeVADOptions> = {
                positiveSpeechThreshold,
                negativeSpeechThreshold,
                redemptionMs,
                preSpeechPadMs,
                minSpeechMs,
                onSpeechStart: () => {
                    console.log("[VAD] Speech started");
                    setState(s => ({ ...s, isSpeaking: true }));
                    callbacksRef.current.onSpeechStart?.();
                },
                onSpeechEnd: (audio: Float32Array) => {
                    console.log("[VAD] Speech ended, audio length:", audio.length);
                    setState(s => ({ ...s, isSpeaking: false }));
                    callbacksRef.current.onSpeechEnd?.(audio);
                },
                onFrameProcessed: (probs) => {
                    callbacksRef.current.onFrameProcessed?.(probs);
                },
            };

            const vad = await MicVAD.new(vadOptions);
            vadRef.current = vad;
            vad.start();

            console.log("[VAD] Initialized and started");
            setState({
                isListening: true,
                isSpeaking: false,
                isLoading: false,
                error: null,
            });
        } catch (err) {
            console.error("[VAD] Initialization error:", err);
            setState({
                isListening: false,
                isSpeaking: false,
                isLoading: false,
                error: err instanceof Error ? err.message : "Failed to initialize VAD",
            });
        }
    }, [positiveSpeechThreshold, negativeSpeechThreshold, redemptionMs, preSpeechPadMs, minSpeechMs]);

    const stop = useCallback(() => {
        if (vadRef.current) {
            console.log("[VAD] Stopping and destroying...");
            vadRef.current.destroy();
            vadRef.current = null;
        }
        setState({
            isListening: false,
            isSpeaking: false,
            isLoading: false,
            error: null,
        });
    }, []);

    const pause = useCallback(() => {
        if (vadRef.current) {
            console.log("[VAD] Pausing...");
            vadRef.current.pause();
            setState(s => ({ ...s, isListening: false, isSpeaking: false }));
        }
    }, []);

    const resume = useCallback(() => {
        if (vadRef.current) {
            console.log("[VAD] Resuming...");
            vadRef.current.start();
            setState(s => ({ ...s, isListening: true }));
        }
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (vadRef.current) {
                vadRef.current.destroy();
                vadRef.current = null;
            }
        };
    }, []);

    return {
        ...state,
        start,
        stop,
        pause,
        resume,
    };
}

/**
 * Convert Float32Array audio (from VAD) to WAV format
 * VAD outputs 16kHz mono Float32 audio
 */
export function float32ToWav(audio: Float32Array, sampleRate = 16000): Blob {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = audio.length * bytesPerSample;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, "RIFF");
    view.setUint32(4, totalSize - 8, true);
    writeString(view, 8, "WAVE");

    // fmt chunk
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);

    // Convert Float32 to Int16 and write
    const int16Array = new Int16Array(audio.length);
    for (let i = 0; i < audio.length; i++) {
        const s = Math.max(-1, Math.min(1, audio[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    const int16View = new Uint8Array(buffer, headerSize);
    int16View.set(new Uint8Array(int16Array.buffer));

    return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}
