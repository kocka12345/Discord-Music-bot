const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const playdl = require('play-dl');

function getYtDlpPath() {
  const root = path.join(__dirname, '..', 'yt-dlp.exe');
  if (fs.existsSync(root)) return root;
  const rootUnix = path.join(__dirname, '..', 'yt-dlp');
  if (fs.existsSync(rootUnix)) return rootUnix;
  return 'yt-dlp';
}

function ytDlpInfo(url) {
  return new Promise((resolve, reject) => {
    const ytdlp = getYtDlpPath();
    console.log('[resolver] yt-dlp path:', ytdlp);
    execFile(ytdlp, [
      '--dump-json', '--no-playlist', '--quiet', '--no-warnings', url,
    ], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new Error('Failed to parse yt-dlp output')); }
    });
  });
}

function infoToTrack(info, requestedBy) {
  return {
    title: info.title || 'Unknown Title',
    url: info.webpage_url || info.url || `https://www.youtube.com/watch?v=${info.id}`,
    author: info.uploader || info.channel || 'Unknown',
    duration: info.duration || 0,
    thumbnail: info.thumbnail || null,
    requestedBy: requestedBy || null,
    lyrics: null,
  };
}

async function resolve(input, requestedBy) {
  const trimmed = input.trim();
  const isUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://');

  if (isUrl) {
    console.log('[resolver] URL detected, fetching metadata...');
    const info = await ytDlpInfo(trimmed);
    return [infoToTrack(info, requestedBy)];
  }

  // Search query
  console.log('[resolver] Searching:', trimmed);
  const results = await playdl.search(trimmed, { source: { youtube: 'video' }, limit: 1 });
  if (!results.length) throw new Error('No results found for: ' + trimmed);
  const found = results[0];
  return [{
    title: found.title || 'Unknown',
    url: found.url,
    author: found.channel?.name || 'Unknown',
    duration: found.durationInSec || 0,
    thumbnail: found.thumbnails?.[0]?.url || null,
    requestedBy: requestedBy || null,
    lyrics: null,
  }];
}

module.exports = { resolve };
