import test from 'node:test';
import assert from 'node:assert/strict';

import { detectLanguage, directionLabel, otherLanguage } from '../public/language.js';

test('maps translation directions between Polish and German', () => {
  assert.equal(otherLanguage('pl'), 'de');
  assert.equal(otherLanguage('de'), 'pl');
  assert.equal(directionLabel('pl'), 'Polnisch → Deutsch');
  assert.equal(directionLabel('de'), 'Deutsch → Polnisch');
});

test('detects very short Polish and German answers', () => {
  assert.equal(detectLanguage('tak', 'pl').language, 'pl');
  assert.equal(detectLanguage('nie', 'pl').language, 'pl');
  assert.equal(detectLanguage('ja', 'de').language, 'de');
  assert.equal(detectLanguage('nein', 'de').language, 'de');
});

test('detects Polish names and places with diacritics', () => {
  assert.equal(detectLanguage('Nazywam się Anna Kowalska z Łodzi', 'pl').language, 'pl');
  assert.equal(detectLanguage('Spotkajmy się w Gdańsku jutro', 'pl').language, 'pl');
});

test('detects German everyday phrases and cities', () => {
  assert.equal(detectLanguage('Ich möchte bitte nach München fahren', 'de').language, 'de');
  assert.equal(detectLanguage('Meine Adresse ist in Köln', 'de').language, 'de');
});

test('keeps numeric-only utterances on the expected language', () => {
  assert.equal(detectLanguage('+48 501 234 567', 'pl').language, 'pl');
  assert.equal(detectLanguage('030 123456', 'de').language, 'de');
});

test('handles money and date phrases with lexical context', () => {
  assert.equal(detectLanguage('To kosztuje 120 złotych', 'pl').language, 'pl');
  assert.equal(detectLanguage('Das kostet 120 Euro', 'de').language, 'de');
  assert.equal(detectLanguage('Termin ist am 15. Juli', 'de').language, 'de');
});
