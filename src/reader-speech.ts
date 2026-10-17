import { useEffect, useRef, useState } from 'react';
export type SpeechPart = { text: string; start: number; end: number };
export function speechParts(text: string): SpeechPart[] {
  const parts: SpeechPart[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + 260, text.length);
    if (end < text.length) {
      const fragment = text.slice(start, end),
        sentence = Math.max(
          fragment.lastIndexOf('. '),
          fragment.lastIndexOf('! '),
          fragment.lastIndexOf('? '),
          fragment.lastIndexOf('\n'),
        );
      const space = fragment.lastIndexOf(' ');
      if (sentence >= 60) end = start + sentence + 1;
      else if (space > 0) end = start + space + 1;
    }
    // Preserve offsets without cutting a UTF-16 surrogate pair.
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    if (end <= start) end = start + 2;
    const value = text.slice(start, end);
    if (value.trim()) parts.push({ text: value, start, end });
    start = end;
  }
  return parts;
}
type Options = { rate: number; voice: string; autoNext: boolean };
const key = 'studyhub-speech-preferences-v1';
function options(): Options {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return {
      rate:
        typeof v?.rate === 'number' && Number.isFinite(v.rate)
          ? Math.max(0.75, Math.min(2, v.rate))
          : 1,
      voice: typeof v?.voice === 'string' ? v.voice.slice(0, 240) : '',
      autoNext: v?.autoNext === true,
    };
  } catch {
    return { rate: 1, voice: '', autoNext: false };
  }
}
export function useReaderSpeech(onFinished: () => void) {
  const supported =
    typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  const [prefs, setPrefs] = useState(options),
    [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]),
    [state, setState] = useState<'idle' | 'playing' | 'paused'>('idle'),
    [error, setError] = useState(''),
    [current, setCurrent] = useState<SpeechPart | null>(null),
    [text, setText] = useState(''),
    [mode, setMode] = useState<'page' | 'selection'>('page');
  const generation = useRef(0),
    queue = useRef<SpeechPart[]>([]),
    index = useRef(0),
    status = useRef<typeof state>('idle'),
    source = useRef<'page' | 'selection'>('page'),
    config = useRef(prefs),
    finish = useRef(onFinished),
    nextPending = useRef(false),
    utterance = useRef<SpeechSynthesisUtterance | null>(null);
  config.current = prefs;
  finish.current = onFinished;
  function stop() {
    generation.current++;
    status.current = 'idle';
    queue.current = [];
    utterance.current = null;
    nextPending.current = false;
    if (supported) speechSynthesis.cancel();
    setState('idle');
    setCurrent(null);
  }
  function say(token: number) {
    if (!supported || token !== generation.current) return;
    const part = queue.current[index.current];
    if (!part) {
      status.current = 'idle';
      setState('idle');
      setCurrent(null);
      utterance.current = null;
      if (source.current === 'page' && config.current.autoNext) finish.current();
      return;
    }
    const u = new SpeechSynthesisUtterance(part.text),
      available = speechSynthesis.getVoices();
    const language = /[а-яё]/i.test(part.text) ? 'ru' : 'en';
    const voice =
      available.find((v) => v.voiceURI === config.current.voice) ||
      available.find((v) => v.lang.toLowerCase().startsWith(language));
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else u.lang = language === 'ru' ? 'ru-RU' : 'en-US';
    u.rate = config.current.rate;
    utterance.current = u;
    setCurrent(part);
    u.onend = () => {
      if (token !== generation.current) return;
      utterance.current = null;
      index.current++;
      if (status.current === 'paused') {
        nextPending.current = true;
        return;
      }
      say(token);
    };
    u.onerror = (e) => {
      if (token !== generation.current) return;
      stop();
      setError(
        e.error === 'not-allowed'
          ? 'Браузер заблокировал озвучку. Нажмите «Произнести» ещё раз.'
          : 'Голос недоступен. Выберите другой голос или проверьте настройки речи устройства.',
      );
    };
    try {
      speechSynthesis.speak(u);
    } catch {
      stop();
      setError('Не удалось запустить голос. Выберите другой голос и попробуйте ещё раз.');
    }
  }
  function start(value: string, kind: 'page' | 'selection' = 'page') {
    stop();
    setError('');
    if (!supported) {
      setError('Этот браузер не поддерживает озвучку.');
      return;
    }
    if (!value.trim()) {
      setError('На странице нет текста. Для скана сначала распознайте страницу.');
      return;
    }
    source.current = kind;
    setMode(kind);
    setText(value);
    queue.current = speechParts(value);
    index.current = 0;
    status.current = 'playing';
    setState('playing');
    say(generation.current);
  }
  function pause() {
    if (!supported || status.current !== 'playing') return;
    speechSynthesis.pause();
    status.current = 'paused';
    setState('paused');
  }
  function resume() {
    if (!supported || status.current !== 'paused') return;
    status.current = 'playing';
    setState('playing');
    if (nextPending.current) {
      nextPending.current = false;
      say(generation.current);
    } else speechSynthesis.resume();
  }
  function configure(value: Options) {
    if (value.rate !== config.current.rate || value.voice !== config.current.voice) stop();
    setPrefs(value);
    setError('');
  }
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(prefs));
    } catch {
      /* Device preferences are optional. */
    }
  }, [prefs]);
  useEffect(() => {
    if (!supported) return;
    const refresh = () => setVoices(speechSynthesis.getVoices());
    refresh();
    speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => {
      generation.current++;
      speechSynthesis.removeEventListener('voiceschanged', refresh);
      speechSynthesis.cancel();
    };
  }, [supported]);
  return {
    supported,
    prefs,
    configure,
    voices,
    state,
    error,
    current,
    text,
    mode,
    start,
    stop,
    pause,
    resume,
  };
}
