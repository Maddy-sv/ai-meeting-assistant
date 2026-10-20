import { useCallback, useEffect, useRef, useState } from "react";

type RecognitionAlternative = { transcript: string };
type RecognitionResult = { isFinal: boolean; 0: RecognitionAlternative };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionErrorEvent = { error: string };

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export type LiveTranscriptionSupport = "checking" | "supported" | "unsupported";

export type StartResult = { ok: true } | { ok: false; reason: string };

export function useLiveTranscription(options: {
  onFinalText: (text: string) => void;
  onFatalError?: (message: string) => void;
  lang?: string;
}) {
  const [support, setSupport] = useState<LiveTranscriptionSupport>("checking");
  const [listening, setListening] = useState(false);
  const [paused, setPausedState] = useState(false);
  const [interim, setInterim] = useState("");
  const [elapsed, setElapsed] = useState(0);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);
  const pausedRef = useRef(false);
  const interimRef = useRef("");
  const callbacksRef = useRef(options);
  useEffect(() => {
    callbacksRef.current = options;
  });

  useEffect(() => {
    setSupport(getRecognitionCtor() ? "supported" : "unsupported");
  }, []);

  const safeStart = (rec: SpeechRecognitionLike) => {
    try {
      rec.start();
    } catch {}
  };

  const stop = useCallback(() => {
    activeRef.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const rec = recognitionRef.current;
    if (rec) {
      rec.onend = null;
      rec.onresult = null;
      try {
        rec.stop();
      } catch {}
    }
    recognitionRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setListening(false);
    setPausedState(false);
    pausedRef.current = false;
    setInterim("");
    interimRef.current = "";
  }, []);

  const start = useCallback(async (): Promise<StartResult> => {
    if (activeRef.current) return { ok: true };
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      return {
        ok: false,
        reason: "Live transcription needs Chrome or Edge. This browser does not support it.",
      };
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return {
        ok: false,
        reason: "Microphone access was blocked. Allow it in your browser settings and try again.",
      };
    }

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = callbacksRef.current.lang || "en-US";
    rec.onresult = (event) => {
      if (pausedRef.current) return;
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = res[0].transcript.trim();
        if (!text) continue;
        if (res.isFinal) callbacksRef.current.onFinalText(text);
        else interimText += text + " ";
      }
      interimRef.current = interimText;
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        stop();
        callbacksRef.current.onFatalError?.("Microphone access was blocked.");
      }
    };
    rec.onend = () => {
      if (activeRef.current && !pausedRef.current) safeStart(rec);
    };

    recognitionRef.current = rec;
    activeRef.current = true;
    pausedRef.current = false;
    setPausedState(false);
    setElapsed(0);
    setListening(true);
    timerRef.current = setInterval(() => {
      if (!pausedRef.current) setElapsed((s) => s + 1);
    }, 1000);
    safeStart(rec);
    return { ok: true };
  }, [stop]);

  const setPaused = useCallback((next: boolean) => {
    pausedRef.current = next;
    setPausedState(next);
    const rec = recognitionRef.current;
    if (!rec || !activeRef.current) return;
    if (next) {
      setInterim("");
      interimRef.current = "";
      try {
        rec.stop();
      } catch {}
    } else {
      safeStart(rec);
    }
  }, []);

  const takeInterim = useCallback(() => {
    const text = interimRef.current.trim();
    interimRef.current = "";
    setInterim("");
    return text;
  }, []);

  useEffect(() => stop, [stop]);

  return {
    support,
    listening,
    paused,
    interim,
    elapsed,
    start,
    stop,
    setPaused,
    takeInterim,
  };
}
