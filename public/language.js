export const LANGUAGE_LABELS = {
  de: 'Deutsch',
  pl: 'Polnisch',
};

export function targetLanguage(sourceLanguage) {
  return sourceLanguage === 'pl' ? 'de' : 'pl';
}

export function directionText(sourceLanguage) {
  return `${LANGUAGE_LABELS[sourceLanguage]} → ${LANGUAGE_LABELS[targetLanguage(sourceLanguage)]}`;
}
