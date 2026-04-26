const playdl = require('play-dl');
const log = require('./logger');

function parseNetscapeCookieText(text) {
  const jar = {};
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 7) continue;
    const name = parts[5];
    const value = parts.slice(6).join('\t');
    if (name) jar[name] = value;
  }

  return jar;
}

function cookieTextToHeader(text) {
  const jar = parseNetscapeCookieText(text);
  const entries = Object.entries(jar);
  if (!entries.length) return null;
  return entries.map(([k, v]) => `${k}=${v}`).join('; ');
}

function decodeBase64(input) {
  try {
    const compact = input.replace(/\s+/g, '');
    return Buffer.from(compact, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function getYoutubeCookieHeaderFromEnv() {
  const direct = process.env.PLAYDL_YOUTUBE_COOKIE?.trim();
  if (direct) return direct;

  const directB64 = process.env.PLAYDL_YOUTUBE_COOKIE_B64?.trim();
  if (directB64) {
    const decoded = decodeBase64(directB64);
    const parsed = cookieTextToHeader(decoded);
    if (parsed) return parsed;
  }

  // Backward-compatible with previous yt-dlp envs.
  const legacyRaw = process.env.YTDLP_COOKIES?.trim();
  if (legacyRaw) {
    const parsed = cookieTextToHeader(legacyRaw);
    if (parsed) return parsed;
  }

  const legacyB64 = process.env.YTDLP_COOKIES_B64?.trim();
  if (legacyB64) {
    const decoded = decodeBase64(legacyB64);
    const parsed = cookieTextToHeader(decoded);
    if (parsed) return parsed;
  }

  return null;
}

function initPlayDlAuth() {
  const cookie = getYoutubeCookieHeaderFromEnv();
  if (!cookie) {
    log.warn('play-dl-auth', 'No YouTube cookie configured for play-dl.');
    return;
  }

  playdl.setToken({
    youtube: { cookie },
  });
  log.info('play-dl-auth', 'YouTube cookie loaded into play-dl token store.');
}

module.exports = { initPlayDlAuth };
