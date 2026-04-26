const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const playdl = require('play-dl');
const { getYtDlpAuthArgs, getYtDlpAuthDebugInfo } = require('./ytDlpConfig');
const log = require('./logger');

let authLogged = false;

function logAuthInfoOnce(context) {
    if (authLogged) return;
    authLogged = true;
    const info = getYtDlpAuthDebugInfo();
    log.info(
        'yt-dlp-auth',
        `[yt-dlp auth][${context}] hasCookies=${info.hasCookies} source=${info.cookiesSource} ` +
        `cookiesPath=${info.cookiesPath || 'none'} extractorArgs=${info.hasExtractorArgs}`
    );
}

function getYtDlpPath() {
    const envBin = process.env.YTDLP_BIN?.trim();
    if (envBin) return envBin;

    // 1. Cesta na Renderu (ve složce src, kam to stahujeme přes Build Command)
    const renderPath = path.join(__dirname, 'yt-dlp');
    if (fs.existsSync(renderPath)) return renderPath;

    // 2. Cesta u tebe na Windows (o úroveň výš než src)
    const rootWin = path.join(__dirname, '..', 'yt-dlp.exe');
    if (fs.existsSync(rootWin)) return rootWin;

    // 3. Cesta u tebe na Linuxu/Mac (pokud bys ho měl v rootu)
    const rootUnix = path.join(__dirname, '..', 'yt-dlp');
    if (fs.existsSync(rootUnix)) return rootUnix;

    // 4. Pokud není nikde u projektu, zkusí ho systémově (pokud je nainstalován v OS)
    return 'yt-dlp';
}

function ytDlpInfo(url) {
    return new Promise((resolve, reject) => {
        const ytdlp = getYtDlpPath();
        const authArgs = getYtDlpAuthArgs();
        logAuthInfoOnce('metadata');
        log.info('resolver', 'Using binary:', ytdlp);
        log.debug('resolver', 'Metadata auth args:', authArgs);
        
        execFile(ytdlp, [
            '--dump-json',
            '--no-playlist',
            '--quiet',
            '--no-warnings',
            ...authArgs,
            url,
        ], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                log.error('resolver', 'yt-dlp error:', stderr || err.message);
                return reject(new Error(stderr || err.message));
            }
            try { 
                resolve(JSON.parse(stdout)); 
            } catch (e) { 
                reject(new Error('Failed to parse yt-dlp output')); 
            }
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
        log.info('resolver', 'URL detected, fetching metadata...');
        const info = await ytDlpInfo(trimmed);
        return [infoToTrack(info, requestedBy)];
    }

    // Search query
    log.info('resolver', 'Searching:', trimmed);
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