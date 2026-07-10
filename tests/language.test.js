import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectLanguage,
  directionText,
  hasUnsupportedScript,
  repeatRequest,
  targetLanguage,
} from '../public/language.js';

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

test('rejects non German and Polish scripts in model output', () => {
  assert.equal(hasUnsupportedScript('Poproszę dwie kawy.'), false);
  assert.equal(hasUnsupportedScript('Ich hätte gern zwei Kaffee.'), false);
  assert.equal(hasUnsupportedScript('次の電車はいつ出発しますか？'), true);
  assert.equal(hasUnsupportedScript('これは日本語です'), true);
  assert.equal(hasUnsupportedScript('테스트 테스트 테스트.'), true);
});

test('uses repeat request only in German or Polish', () => {
  assert.equal(repeatRequest('de'), 'Bitte wiederholen.');
  assert.equal(repeatRequest('pl'), 'Proszę powtórzyć.');
});
