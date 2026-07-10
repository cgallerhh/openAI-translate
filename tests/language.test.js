import test from 'node:test';
import assert from 'node:assert/strict';

import { directionText, targetLanguage } from '../public/language.js';

test('uses fixed Polish and German translation directions', () => {
  assert.equal(targetLanguage('pl'), 'de');
  assert.equal(targetLanguage('de'), 'pl');
  assert.equal(directionText('pl'), 'Polnisch → Deutsch');
  assert.equal(directionText('de'), 'Deutsch → Polnisch');
});
