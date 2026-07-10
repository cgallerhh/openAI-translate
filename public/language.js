export const LANGUAGE_LABELS = {
  de: 'Deutsch',
  pl: 'Polnisch',
};

export function otherLanguage(language) {
  return language === 'pl' ? 'de' : 'pl';
}

export function directionLabel(sourceLanguage) {
  const targetLanguage = otherLanguage(sourceLanguage);
  return `${LANGUAGE_LABELS[sourceLanguage]} → ${LANGUAGE_LABELS[targetLanguage]}`;
}

const POLISH_EXACT = new Map([
  ['tak', 5],
  ['nie', 5],
  ['dziekuje', 4],
  ['dziękuję', 4],
  ['prosze', 3],
  ['proszę', 3],
  ['dobrze', 3],
  ['czesc', 3],
  ['cześć', 3],
]);

const GERMAN_EXACT = new Map([
  ['ja', 5],
  ['nein', 5],
  ['danke', 4],
  ['bitte', 4],
  ['gut', 3],
  ['hallo', 3],
  ['tschuss', 3],
  ['tschüss', 3],
]);

const POLISH_WORDS = new Map([
  ['jestem', 2],
  ['jest', 1],
  ['sa', 1],
  ['są', 1],
  ['mam', 2],
  ['mamy', 2],
  ['chce', 2],
  ['chcę', 2],
  ['potrzebuje', 2],
  ['potrzebuję', 2],
  ['gdzie', 2],
  ['kiedy', 2],
  ['ile', 2],
  ['ulica', 2],
  ['ulicy', 2],
  ['telefon', 2],
  ['numer', 1],
  ['zlotych', 2],
  ['złotych', 2],
  ['warszawa', 3],
  ['warszawie', 3],
  ['krakow', 3],
  ['kraków', 3],
  ['lodz', 3],
  ['łódź', 3],
  ['wroclaw', 3],
  ['wrocław', 3],
  ['gdansk', 3],
  ['gdańsk', 3],
  ['poznan', 3],
  ['poznań', 3],
  ['szczecin', 3],
  ['katowice', 3],
]);

const GERMAN_WORDS = new Map([
  ['ich', 2],
  ['du', 1],
  ['sie', 1],
  ['wir', 1],
  ['bin', 2],
  ['ist', 1],
  ['sind', 1],
  ['habe', 2],
  ['haben', 2],
  ['mochte', 2],
  ['möchte', 2],
  ['brauche', 2],
  ['bitte', 2],
  ['danke', 2],
  ['wo', 2],
  ['wann', 2],
  ['wieviel', 2],
  ['wie', 1],
  ['strasse', 3],
  ['straße', 3],
  ['telefon', 1],
  ['nummer', 2],
  ['euro', 2],
  ['hamburg', 2],
  ['berlin', 2],
  ['munchen', 3],
  ['münchen', 3],
  ['koln', 3],
  ['köln', 3],
]);

function normalizeToken(token) {
  return token
    .toLocaleLowerCase('de-DE')
    .replace(/[.,!?;:()[\]{}"']/g, '')
    .trim();
}

function tokenize(text) {
  return text
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
}

export function detectLanguage(text, expectedLanguage = 'pl') {
  const normalized = text.trim().toLocaleLowerCase('de-DE');
  const tokens = tokenize(normalized);
  let plScore = 0;
  let deScore = 0;
  const reasons = [];

  if (!tokens.length) {
    return {
      language: expectedLanguage,
      confidence: 0,
      reason: 'empty',
      scores: { de: deScore, pl: plScore },
    };
  }

  if (/[ąćęłńóśźż]/i.test(normalized)) {
    plScore += 4;
    reasons.push('polish-diacritics');
  }

  if (/[äöüß]/i.test(normalized)) {
    deScore += 4;
    reasons.push('german-diacritics');
  }

  const compact = tokens.join(' ');
  if (POLISH_EXACT.has(compact)) {
    plScore += POLISH_EXACT.get(compact);
    reasons.push('polish-short-answer');
  }

  if (GERMAN_EXACT.has(compact)) {
    deScore += GERMAN_EXACT.get(compact);
    reasons.push('german-short-answer');
  }

  for (const token of tokens) {
    if (POLISH_WORDS.has(token)) plScore += POLISH_WORDS.get(token);
    if (GERMAN_WORDS.has(token)) deScore += GERMAN_WORDS.get(token);
  }

  if (/^\+?[\d\s/().-]{3,}$/.test(normalized)) {
    return {
      language: expectedLanguage,
      confidence: 0.25,
      reason: 'number-uses-expected-language',
      scores: { de: deScore, pl: plScore },
    };
  }

  const delta = Math.abs(plScore - deScore);
  if (plScore > deScore && delta >= 2) {
    return {
      language: 'pl',
      confidence: Math.min(1, 0.55 + delta / 10),
      reason: reasons.join(',') || 'polish-lexical-signal',
      scores: { de: deScore, pl: plScore },
    };
  }

  if (deScore > plScore && delta >= 2) {
    return {
      language: 'de',
      confidence: Math.min(1, 0.55 + delta / 10),
      reason: reasons.join(',') || 'german-lexical-signal',
      scores: { de: deScore, pl: plScore },
    };
  }

  return {
    language: expectedLanguage,
    confidence: delta > 0 ? 0.35 : 0.2,
    reason: 'ambiguous-uses-expected-language',
    scores: { de: deScore, pl: plScore },
  };
}
