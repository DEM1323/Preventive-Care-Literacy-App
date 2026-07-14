import type { LanguageCode } from '../types/language';

const langMap: Record<LanguageCode, string> = {
  en: 'en-US',
  es: 'es-ES',
  pt: 'pt-BR',
  fr: 'fr-FR',
  ht: 'fr-FR',
};

export function useSpeech(language: LanguageCode) {
  const speak = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = langMap[language] ?? 'en-US';
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
  };

  return { speak };
}
