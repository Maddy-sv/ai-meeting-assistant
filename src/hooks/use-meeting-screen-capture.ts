import { useCallback, useEffect, useRef, useState } from "react";

const CHUNK_MS = 12_000;
const SCREENSHOT_MS = 15_000;
const MIN_CHUNK_BYTES = 5_000;
/** Remote audio is only sent if the tab produced sound within this window. */
const RECENT_AUDIO_MS = 15_000;
/** Longest stop() waits for the final clip to be transcribed. */
const STOP_TIMEOUT_MS = 35_000;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Captures a shared tab or screen: its audio is recorded in self-contained 12-second
 * clips (each a complete WebM file) and handed to `onAudioChunk` for remote
 * transcription, and a low-resolution screenshot is kept every 15 seconds.
 */
export function useScreenShareCapture(options: {
  onAudioChunk: (dataUrl: string) => void | Promise<unknown>;
  isPaused: () => boolean;
}) {
  const [sharing, setSharing] = useState(false);
  const [hasTabAudio, setHasTabAudio] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const lastRemoteAudioAtRef = useRef(0);
  const analyserFailedRef = useRef(false);
  const screenshotsRef = useRef<string[]>([]);
  /** Clips being converted or transcribed; stop() waits for them. */
  const pendingRef = useRef(new Set<Promise<unknown>>());
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  /**
   * Stops sharing. The returned promise resolves once the final clip (recorded
   * up to this moment) and every clip already in flight have been handled, or
   * after a safety timeout.
   */
  const stop = useCallback((): Promise<unknown> => {
    activeRef.current = false;
    if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current);
    chunkTimerRef.current = null;
    if (shotTimerRef.current) clearInterval(shotTimerRef.current);
    shotTimerRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    const rec = recorderRef.current;
    recorderRef.current = null;
    let finalClip: Promise<void> = Promise.resolve();
    if (rec && rec.state !== "inactive") {
      // Registered after `onstop`, so it runs once the last clip has been queued.
      finalClip = new Promise((resolve) =>
        rec.addEventListener("stop", () => resolve(), { once: true }),
      );
      try {
        rec.stop();
      } catch {
        finalClip = Promise.resolve();
      }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setSharing(false);
    setHasTabAudio(false);
    const flushed = finalClip.then(() => Promise.allSettled(Array.from(pendingRef.current)));
    const timeout = new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS));
    return Promise.race([flushed, timeout]);
  }, []);

  const recordClip = useCallback((audioStream: MediaStream) => {
    if (!activeRef.current) return;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(audioStream, { mimeType: "audio/webm" });
    } catch {
      return;
    }
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) parts.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(parts, { type: "audio/webm" });
      const recentAudio =
        analyserFailedRef.current || Date.now() - lastRemoteAudioAtRef.current < RECENT_AUDIO_MS;
      if (blob.size > MIN_CHUNK_BYTES && recentAudio && !optionsRef.current.isPaused()) {
        const job = blobToDataUrl(blob)
          .then((url) => optionsRef.current.onAudioChunk(url))
          .catch(() => undefined);
        pendingRef.current.add(job);
        void job.finally(() => pendingRef.current.delete(job));
      }
      if (activeRef.current) recordClip(audioStream);
    };
    recorderRef.current = rec;
    rec.start();
    chunkTimerRef.current = setTimeout(() => {
      if (rec.state !== "inactive") rec.stop();
    }, CHUNK_MS);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (streamRef.current) return true;
    if (!navigator.mediaDevices?.getDisplayMedia) return false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch {
      return false;
    }
    streamRef.current = stream;
    activeRef.current = true;
    lastRemoteAudioAtRef.current = 0;
    analyserFailedRef.current = false;
    screenshotsRef.current = [];
    setSharing(true);

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    void video.play().catch(() => undefined);

    const audioTracks = stream.getAudioTracks();
    setHasTabAudio(audioTracks.length > 0);
    if (audioTracks.length > 0) {
      const audioStream = new MediaStream(audioTracks);
      try {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(audioStream).connect(analyser);
        const freq = new Uint8Array(analyser.frequencyBinCount);
        const loop = () => {
          if (!activeRef.current) return;
          analyser.getByteFrequencyData(freq);
          let sum = 0;
          let max = 0;
          for (const v of freq) {
            sum += v;
            if (v > max) max = v;
          }
          if (max > 10 || sum / freq.length > 2) lastRemoteAudioAtRef.current = Date.now();
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch {
        // Without an analyser every clip counts as containing audio.
        analyserFailedRef.current = true;
      }
      recordClip(audioStream);
    }

    shotTimerRef.current = setInterval(() => {
      if (!video.videoWidth || !video.videoHeight) return;
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(video.videoWidth, 800);
      canvas.height = Math.min(video.videoHeight, 450);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      screenshotsRef.current = [
        ...screenshotsRef.current.slice(-2),
        canvas.toDataURL("image/jpeg", 0.4),
      ];
    }, SCREENSHOT_MS);

    stream.getVideoTracks()[0]?.addEventListener("ended", () => void stop());
    return true;
  }, [recordClip, stop]);

  const getScreenshots = useCallback(() => screenshotsRef.current, []);

  /** True if the shared tab produced sound in the last `ms` milliseconds. */
  const remoteAudioActiveWithin = useCallback(
    (ms: number) => Date.now() - lastRemoteAudioAtRef.current < ms,
    [],
  );

  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );

  return { sharing, hasTabAudio, start, stop, getScreenshots, remoteAudioActiveWithin };
}
