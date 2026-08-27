const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadEmojiRegistry, getEmojiAsset } = require('../src/emojiService');

test('carrega o registro de emojis da pasta local', () => {
  const registry = loadEmojiRegistry(path.join(__dirname, '..', 'emojis'));
  assert.ok(registry.size > 0, 'O registro deve carregar arquivos da pasta emojis');
});

test('retorna um emoji disponível para um contexto', () => {
  const registry = loadEmojiRegistry(path.join(__dirname, '..', 'emojis'));
  const asset = getEmojiAsset(registry, 'success');
  assert.ok(asset, 'Deve retornar um arquivo de emoji para o contexto');
});
