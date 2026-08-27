const fs = require('fs');
const path = require('path');

function loadEmojiRegistry(emojiDirectory) {
  if (!fs.existsSync(emojiDirectory)) {
    return new Map();
  }

  const files = fs.readdirSync(emojiDirectory)
    .filter((file) => file.endsWith('.png') || file.endsWith('.gif'))
    .sort();

  const registry = new Map();
  for (const file of files) {
    const baseName = path.basename(file, path.extname(file));
    const normalizedKey = baseName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    registry.set(normalizedKey, path.join(emojiDirectory, file));
  }

  return registry;
}

function getEmojiAsset(registry, key, fallback = 'config') {
  const normalizedKey = String(key || '').toLowerCase();
  if (registry.has(normalizedKey)) {
    return registry.get(normalizedKey);
  }

  const fallbackKey = String(fallback || '').toLowerCase();
  if (registry.has(fallbackKey)) {
    return registry.get(fallbackKey);
  }

  return null;
}

function getEmojiFileName(registry, key, fallback = 'config') {
  const asset = getEmojiAsset(registry, key, fallback);
  return asset ? path.basename(asset) : null;
}

module.exports = {
  loadEmojiRegistry,
  getEmojiAsset,
  getEmojiFileName
};
