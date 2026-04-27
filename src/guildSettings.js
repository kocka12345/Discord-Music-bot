const fs = require('fs');
const path = require('path');

const DEFAULT_GUILD_SETTINGS = {
  adminRoleId: null,
  testMode: false,
  playCooldownSec: 2,
  maxTracksPerPlay: 30,
  defaultVolume: 50,
  autoLiveLyrics: true,
};

function getSettingsFile(client) {
  const dataDir = path.dirname(client.playlistFile);
  return path.join(dataDir, 'guild-settings.json');
}

function ensureFile(client) {
  const file = getSettingsFile(client);
  if (!fs.existsSync(file)) fs.writeFileSync(file, '{}');
  return file;
}

function loadAllGuildSettings(client) {
  const file = ensureFile(client);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function saveAllGuildSettings(client, data) {
  const file = ensureFile(client);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getGuildSettings(client, guildId) {
  const all = loadAllGuildSettings(client);
  return {
    ...DEFAULT_GUILD_SETTINGS,
    ...(all[guildId] || {}),
  };
}

function setGuildSettings(client, guildId, patch) {
  const all = loadAllGuildSettings(client);
  const current = {
    ...DEFAULT_GUILD_SETTINGS,
    ...(all[guildId] || {}),
  };
  all[guildId] = {
    ...current,
    ...patch,
  };
  saveAllGuildSettings(client, all);
  return all[guildId];
}

function memberCanUseAdminCommand(member, settings) {
  if (!member) return false;
  if (member.permissions?.has?.('Administrator')) return true;
  if (!settings?.adminRoleId) return false;
  return member.roles?.cache?.has?.(settings.adminRoleId) || false;
}

module.exports = {
  DEFAULT_GUILD_SETTINGS,
  getGuildSettings,
  setGuildSettings,
  memberCanUseAdminCommand,
};
