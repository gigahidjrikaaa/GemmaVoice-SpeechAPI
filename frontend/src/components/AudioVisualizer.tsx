import { useEffect, useRef } from 'react';
import { cn } from '../lib/utils';

interface AudioVisualizerProps {
    stream: MediaStream | null;
    className?: string;
    barColor?: string;
}

export function AudioVisualizer({ stream, className, barColor = '#10b981' }: AudioVisualizerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>();
    const analyserRef = useRef<AnalyserNode>();
    const sourceRef = useRef<MediaStreamAudioSourceNode>();

    useEffect(() => {
        if (!stream || !canvasRef.current) return;

        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);

        source.connect(analyser);
        analyser.fftSize = 256;

        analyserRef.current = analyser;
        sourceRef.current = source;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        if (!ctx) return;

        const draw = () => {
            animationRef.current = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);

            ctx.fillStyle = 'rgb(2, 6, 23)'; // slate-950
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const barWidth = (canvas.width / bufferLength) * 2.5;
            let barHeight;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                barHeight = (dataArray[i] / 255) * canvas.height;

                // Gradient fill
                const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
                gradient.addColorStop(0, barColor);
                gradient.addColorStop(1, '#34d399'); // emerald-400

                ctx.fillStyle = gradient;
                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

                x += barWidth + 1;
            }
        };

        draw();

        return () => {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
            if (sourceRef.current) sourceRef.current.disconnect();
            if (audioContext.state !== 'closed') audioContext.close();
        };
    }, [stream, barColor]);

    return (
        <canvas
            ref={canvasRef}
            width={300}
            height={100}
            className={cn("w-full h-24 rounded-md bg-slate-950", className)}
        />
    );
}
