const fs = require('fs');
const path = require('path');

function ensureConfigStore(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ guilds: {} }, null, 2));
  }

  return filePath;
}

function loadConfig(filePath) {
  ensureConfigStore(filePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveConfig(filePath, config) {
  ensureConfigStore(filePath);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
}

function getGuildConfig(config, guildId) {
  if (!config) config = {};
  if (!config.guilds) config.guilds = {};

  if (!config.guilds[guildId]) {
    config.guilds[guildId] = {
      title: '',
      description: '',
      banner: '',
      icon: '',
      logChannelId: '',
      botName: '',
      botIcon: '',
      botBanner: '',
      creditsText: 'Creditos By 11K Booster',
      protectedServerIds: [],
      botMode: 'v1'
    };
  } else if (!config.guilds[guildId].botMode) {
    config.guilds[guildId].botMode = 'v1';
  }

  return config.guilds[guildId];
}

function normalizeProtectedServerIds(values = []) {
  if (Array.isArray(values)) {
    return [...new Set(values.map(String).map(v => v.trim()).filter(Boolean))].slice(0, 5);
  }
  return [...new Set(String(values || '')
    .split(/,|\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 5))];
}

function isProtectedTarget(targetGuildId, protectedServerIds = []) {
  const normalizedIds = normalizeProtectedServerIds(protectedServerIds);
  return normalizedIds.includes(String(targetGuildId).trim());
}

function isServerProtectedGlobally(config, targetGuildId) {
  const targetIdStr = String(targetGuildId).trim();
  if (!config || !config.guilds) return false;
  for (const guildId in config.guilds) {
    const guildConfig = config.guilds[guildId];
    if (guildConfig && guildConfig.protectedServerIds) {
      const protectedIds = normalizeProtectedServerIds(guildConfig.protectedServerIds);
      if (protectedIds.includes(targetIdStr)) {
        return true;
      }
    }
  }
  return false;
}

function normalizeCreditsText(value = '') {
  const trimmed = String(value || '').trim();
  return trimmed || 'Creditos By 11K Booster';
}

module.exports = {
  ensureConfigStore,
  loadConfig,
  saveConfig,
  getGuildConfig,
  normalizeProtectedServerIds,
  isProtectedTarget,
  isServerProtectedGlobally,
  normalizeCreditsText
};
