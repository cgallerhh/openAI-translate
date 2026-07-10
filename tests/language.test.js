import test from 'node:test';
import assert from 'node:assert/strict';

import { detectLanguage, directionText, targetLanguage } from '../public/language.js';

test('uses fixed Polish and German translation directions', () => {
  assert.equal(targetLanguage('pl'), 'de');
  assert.equal(targetLanguage('de'), 'pl');
  assert.equal(directionText('pl'), 'Polnisch → Deutsch');
  assert.equal(directionText('de'), 'Deutsch → Polnisch');
});

test('detects short German and Polish answers', () => {
  assert.equal(detectLanguage('ja'), 'de');
  assert.equal(detectLanguage('nein'), 'de');
  assert.equal(detectLanguage('tak'), 'pl');
  assert.equal(detectLanguage('nie'), 'pl');
});

test('detects typical German and Polish utterances for bubble direction', () => {
  assert.equal(detectLanguage('Ich hätte gern zwei Kaffee.'), 'de');
  assert.equal(detectLanguage('Wann fährt der nächste Zug?'), 'de');
  assert.equal(detectLanguage('Poproszę dwie kawy.'), 'pl');
  assert.equal(detectLanguage('Kiedy odjeżdża następny pociąg?'), 'pl');
});

test('keeps ambiguous numbers language-neutral', () => {
  assert.equal(detectLanguage('12345'), undefined);
  assert.equal(detectLanguage('15,80'), undefined);
});

test('detects names and prices when language context is present', () => {
  assert.equal(detectLanguage('Ich heiße Christian und das kostet 15 Euro.'), 'de');
  assert.equal(detectLanguage('Nazywam się Piotr i to kosztuje 15 złotych.'), 'pl');
});
