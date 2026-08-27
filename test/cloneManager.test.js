const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProtectedServerIds, isProtectedTarget, normalizeCreditsText } = require('../src/cloneManager');

test('normaliza até 5 servidores protegidos', () => {
  const values = '111,222\n333,444,555,666';
  assert.deepEqual(normalizeProtectedServerIds(values), ['111', '222', '333', '444', '555']);
});

test('bloqueia alvos protegidos', () => {
  assert.equal(isProtectedTarget('222', '111,222,333'), true);
  assert.equal(isProtectedTarget('999', '111,222,333'), false);
});

test('normaliza texto de créditos com valor padrão', () => {
  assert.equal(normalizeCreditsText(''), 'Creditos By 11K Booster');
  assert.equal(normalizeCreditsText('Obrigado!'), 'Obrigado!');
});
