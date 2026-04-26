const fs = require('fs');
const os = require('os');
const path = require('path');

let cachedCookiesPath = null;

function ensureCookiesFile() {
  const envPath = process.env.YTDLP_COOKIES_FILE?.trim();
  if (envPath) {
    return envPath;
  }

  const base64Cookies = process.env.YTDLP_COOKIES_B64?.trim();
  const rawCookies = process.env.YTDLP_COOKIES?.trim();
  const cookieText = base64Cookies
    ? Buffer.from(base64Cookies, 'base64').toString('utf8')
    : rawCookies;

  if (!cookieText) return null;

  if (cachedCookiesPath && fs.existsSync(cachedCookiesPath)) {
    return cachedCookiesPath;
  }

  const filePath = path.join(os.tmpdir(), 'yt-dlp-cookies.txt');
  fs.writeFileSync(filePath, cookieText, 'utf8');
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

module.exports = { getYtDlpAuthArgs };
