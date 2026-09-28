// webview-ui/src/meeting/transcriber.ts
//
// Live transcription of the person's OWN speech with the browser's speech
// recognition (Chrome and Edge send the audio to Google's or Microsoft's
// speech service; Safari transcribes on the device). Each participant
// transcribes themselves, so every line has the right speaker and nobody's
// voice is sent anywhere they did not agree to.

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface TranscriberOptions {
  lang: string;
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
  /** A problem worth telling the person (blocked microphone, no network). */
  onError: (message: string) => void;
}

/** Languages offered in the transcript panel (BCP 47). */
export const TRANSCRIPT_LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'es-ES', label: 'Español' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'it-IT', label: 'Italiano' },
];

export class Transcriber {
  static isSupported(): boolean {
    return recognitionCtor() !== null;
  }

  private recognition: Recognition | null = null;
  private wanted = false;
  private restartDelay = 250;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly opts: TranscriberOptions;

  constructor(opts: TranscriberOptions) {
    this.opts = opts;
  }

  get running(): boolean {
    return this.wanted;
  }

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    this.restartDelay = 250;
    this.spawn();
  }

  stop(): void {
    this.wanted = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const r = this.recognition;
    this.recognition = null;
    if (r) {
      r.onend = null;
      r.onresult = null;
      r.onerror = null;
      try {
        r.abort();
      } catch {
        /* already stopped */
      }
    }
    this.opts.onInterim('');
  }

  private spawn(): void {
    const Ctor = recognitionCtor();
    if (!Ctor || !this.wanted) return;
    const r = new Ctor();
    r.lang = this.opts.lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      this.restartDelay = 250;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) this.opts.onFinal(text);
        else interim += `${text} `;
      }
      this.opts.onInterim(interim.trim());
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.opts.onError('The browser blocked speech recognition for this page.');
        this.stop();
      } else if (e.error === 'network') {
        this.opts.onError('Transcription lost its connection to the speech service; retrying.');
      } else if (e.error === 'language-not-supported') {
        this.opts.onError(`This browser cannot transcribe ${this.opts.lang}.`);
        this.stop();
      }
      // no-speech / aborted / audio-capture: the end handler restarts it.
    };
    // Chrome ends a session after a silence or a minute: keep it going while wanted.
    r.onend = () => {
      if (!this.wanted || this.recognition !== r) return;
      this.recognition = null;
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.spawn();
      }, this.restartDelay);
      this.restartDelay = Math.min(this.restartDelay * 2, 8_000);
    };
    this.recognition = r;
    try {
      r.start();
    } catch {
      // Started twice in a row: the end handler will bring it back.
    }
  }
}
