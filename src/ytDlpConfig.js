const fs = require('fs');
const os = require('os');
const path = require('path');

let cachedCookiesPath = null;
let cachedSource = 'none';

function looksLikeNetscapeCookieFile(text) {
  if (!text) return false;
  const normalized = text.replace(/\r\n/g, '\n');
  return normalized.includes('youtube.com') && normalized.includes('\t');
}

function decodeBase64(value) {
  try {
    const compact = value.replace(/\s+/g, '');
    return Buffer.from(compact, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function ensureCookiesFile() {
  const envPath = process.env.YTDLP_COOKIES_FILE?.trim();
  if (envPath) {
    cachedSource = 'file';
    return envPath;
  }

  const base64Cookies = process.env.YTDLP_COOKIES_B64?.trim();
  const rawCookies = process.env.YTDLP_COOKIES?.trim();
  const decoded = base64Cookies ? decodeBase64(base64Cookies) : '';
  const cookieText = looksLikeNetscapeCookieFile(decoded) ? decoded : rawCookies;
  cachedSource = looksLikeNetscapeCookieFile(decoded) ? 'base64' : (rawCookies ? 'raw' : 'none');

  if (!cookieText) return null;

  if (cachedCookiesPath && fs.existsSync(cachedCookiesPath)) {
    return cachedCookiesPath;
  }

  const filePath = path.join(os.tmpdir(), `yt-dlp-cookies-${process.pid}.txt`);
  fs.writeFileSync(filePath, cookieText, 'utf8');
  try { fs.chmodSync(filePath, 0o600); } catch {}
  cachedCookiesPath = filePath;
  return filePath;
}

function getYtDlpAuthArgs() {
  const args = [];
  const cookiesPath = ensureCookiesFile();

  if (cookiesPath) {
    args.push('--cookies', cookiesPath);
  }

  const extractorArgs = process.env.YTDLP_EXTRACTOR_ARGS?.trim();
  if (extractorArgs) {
    args.push('--extractor-args', extractorArgs);
  }

  return args;
}

function getYtDlpAuthDebugInfo() {
  const cookiesPath = ensureCookiesFile();
  return {
    hasCookies: Boolean(cookiesPath),
    cookiesPath: cookiesPath || null,
    cookiesSource: cachedSource,
    hasExtractorArgs: Boolean(process.env.YTDLP_EXTRACTOR_ARGS?.trim()),
  };
}

module.exports = { getYtDlpAuthArgs, getYtDlpAuthDebugInfo };
