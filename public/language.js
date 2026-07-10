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

export function repeatRequest(language) {
  return language === 'pl' ? 'Proszę powtórzyć.' : 'Bitte wiederholen.';
}

const SHORT_POLISH = new Set(['tak', 'nie', 'proszę', 'prosze', 'dzięki', 'dzieki']);
const SHORT_GERMAN = new Set(['ja', 'nein', 'bitte', 'danke']);

const POLISH_HINTS = [
  'czy',
  'jest',
  'mam',
  'mamy',
  'się',
  'sie',
  'chcę',
  'chce',
  'nazywam',
  'chciałbym',
  'chcialbym',
  'kosztuje',
  'poproszę',
  'poprosze',
  'dzień',
  'dzien',
  'dobry',
  'dziękuję',
  'dziekuje',
  'gdzie',
  'kiedy',
  'ile',
  'który',
  'ktory',
  'pociąg',
  'pociag',
  'warszawa',
  'kraków',
  'krakow',
  'łódź',
  'lodz',
  'złoty',
  'zloty',
  'złotych',
  'zlotych',
];

const GERMAN_HINTS = [
  'ich',
  'wir',
  'du',
  'sie',
  'der',
  'die',
  'das',
  'ein',
  'eine',
  'nicht',
  'heiße',
  'heisse',
  'möchte',
  'moechte',
  'kostet',
  'hätte',
  'haette',
  'gern',
  'guten',
  'tag',
  'wo',
  'wann',
  'wie',
  'viel',
  'uhr',
  'zug',
  'bahnhof',
  'kaffee',
  'euro',
];

export function detectLanguage(text) {
  const normalized = text
    .toLowerCase()
    .replace(/[“”„"'.!?;:()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return undefined;
  if (SHORT_POLISH.has(normalized)) return 'pl';
  if (SHORT_GERMAN.has(normalized)) return 'de';

  const words = normalized.split(' ');
  let polishScore = /[ąćęłńóśźż]/.test(normalized) ? 2 : 0;
  let germanScore = /[äöüß]/.test(normalized) ? 2 : 0;

  for (const word of words) {
    if (POLISH_HINTS.includes(word)) polishScore += 1;
    if (GERMAN_HINTS.includes(word)) germanScore += 1;
  }

  if (polishScore > germanScore) return 'pl';
  if (germanScore > polishScore) return 'de';
  return undefined;
}

export function hasUnsupportedScript(text) {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af\u0400-\u04ff\u0500-\u052f\u0600-\u06ff\u0750-\u077f\u0590-\u05ff\u0900-\u097f\u0e00-\u0e7f]/u.test(
    text,
  );
}
