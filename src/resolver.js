const { execSync } = require('child_process');
const log = require('./logger');
const { enrichTrackMetadata } = require('./trackMetadata');

function pickFirst(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return null;
}

function normalizeYouTubeUrl(url) {
    if (!url) return url;
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./, '');
        if (host === 'youtu.be') {
            const id = parsed.pathname.replace('/', '').trim();
            if (id) return `https://www.youtube.com/watch?v=${id}`;
        }
        if (host === 'youtube.com' || host === 'm.youtube.com') {
            if (parsed.pathname.startsWith('/shorts/') || parsed.pathname.startsWith('/live/')) {
                const id = parsed.pathname.split('/').pop();
                if (id) return `https://www.youtube.com/watch?v=${id}`;
            }
        }
    } catch {}
    return url;
}

function extractYouTubeId(url) {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./, '');
        if (host === 'youtu.be') {
            return parsed.pathname.replace('/', '').trim() || null;
        }
        if (host === 'youtube.com' || host === 'm.youtube.com') {
            if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
            if (parsed.pathname.startsWith('/shorts/') || parsed.pathname.startsWith('/live/')) {
                const id = parsed.pathname.split('/').pop();
                return id || null;
            }
        }
    } catch {}
    return null;
}

function parseYouTubeListId(url) {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./, '');
        if (host !== 'youtube.com' && host !== 'm.youtube.com') return null;
        return parsed.searchParams.get('list');
    } catch {
        return null;
    }
}

// Piped API pro obcházení Oracle Cloud IP blokace na YouTube
async function resolveUrlViaPipedApi(url, requestedBy) {
    const videoId = extractYouTubeId(url);
    if (!videoId) return null;

    const instances = [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.yt.privacy.com.de',
        'https://pipedapi.in.projectsegfau.lt'
    ];

    for (const instance of instances) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(`${instance}/streams/${videoId}`, { signal: controller.signal });
            clearTimeout(timeout);

            if (!res.ok) continue;
            const data = await res.json();

            const audioStream = data.audioStreams?.find(s => s.mimeType?.includes('audio')) || data.audioStreams?.[0];
            if (!audioStream?.url) continue;

            log.info('resolver', `Resolved successfully via Piped API (${instance})`);
            const track = {
                title: data.title || 'Unknown Title',
                url: url,
                streamUrl: audioStream.url,
                author: data.uploader || 'Unknown Artist',
                duration: data.duration || 0,
                thumbnail: data.thumbnailUrl || null,
                requestedBy: requestedBy || null,
                lyrics: null,
                album: null,
                source: 'youtube-piped'
            };
            return [await enrichTrackMetadata(track)];
        } catch {
            continue;
        }
    }
    return null;
}

function runYtDlp(target, options = '') {
    try {
        const cmd = `PYTHONIOENCODING=utf-8 LC_ALL=C.UTF-8 LANG=C.UTF-8 yt-dlp --extractor-args "youtube:player_client=ios,web" ${options} "${target}"`;
        const stdout = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
        return stdout;
    } catch (err) {
        throw new Error(err.message || 'yt-dlp execution failed');
    }
}

async function fetchYouTubeBasicMeta(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
        const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const res = await fetch(endpoint, { signal: controller.signal });
        if (!res.ok) return null;
        const data = await res.json();
        return {
            title: data?.title || null,
            author: data?.author_name || null,
            thumbnail: data?.thumbnail_url || null,
        };
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

function cleanQuery(title) {
    if (!title) return '';
    return title
        .replace(/\[.*?\]|\(.*?\)/g, '')
        .replace(/(official video|official audio|lyrics|music video|hd|4k|long version)/gi, '')
        .trim();
}

// SoundCloud záloha přes yt-dlp – vrací správný webový odkaz na SoundCloud skladbu
async function resolveYouTubeUrlViaSoundCloudFallback(url, requestedBy) {
    const meta = await fetchYouTubeBasicMeta(url);
    const query = cleanQuery(meta?.title) || meta?.title;
    if (!query) {
        throw new Error('Could not read YouTube title for fallback lookup.');
    }

    try {
        log.info('resolver', `Searching SoundCloud via yt-dlp for: ${query}`);
        const output = runYtDlp(`scsearch1:${query}`, '-j --no-playlist');
        const data = JSON.parse(output.trim().split('\n')[0]);
        
        const trackUrl = data.webpage_url || data.original_url;
        if (!trackUrl) {
            throw new Error('SoundCloud search returned no webpage URL.');
        }

        return [{
            title: meta?.title || data.title || 'Unknown Title',
            url: trackUrl,
            streamUrl: null, // Necháme bota, ať si to vyřeší standardním streamovacím resolverem pro SoundCloud
            author: data.uploader || data.channel || meta?.author || 'Unknown Artist',
            duration: data.duration || 0,
            thumbnail: data.thumbnail || meta?.thumbnail || null,
            requestedBy: requestedBy || null,
            lyrics: null,
            album: null,
            source: 'soundcloud',
        }];
    } catch (err) {
        throw new Error('Could not resolve URL via Piped/yt-dlp and SoundCloud fallback failed: ' + err.message);
    }
}

async function resolveUrlViaYtDlp(url, requestedBy) {
    const normalizedUrl = normalizeYouTubeUrl(url);
    const listId = parseYouTubeListId(normalizedUrl);

    if (listId) {
        log.info('resolver', 'Playlist detected, resolving via yt-dlp...');
        const output = runYtDlp(`https://www.youtube.com/playlist?list=${listId}`, '-j --flat-playlist');
        const lines = output.trim().split('\n').filter(Boolean);
        const videos = lines.map(line => {
            try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);

        if (!videos.length) throw new Error('Playlist is empty or unavailable.');
        return videos.map(v => ({
            title: v.title || 'Unknown',
            url: v.url || (v.id ? `https://www.youtube.com/watch?v=${v.id}` : null),
            author: v.uploader || v.channel || 'Unknown',
            duration: v.duration || 0,
            thumbnail: v.thumbnail || v.thumbnails?.[0]?.url || null,
            requestedBy: requestedBy || null,
            lyrics: null,
        }));
    }

    // Krok 1: Piped API
    const pipedResult = await resolveUrlViaPipedApi(normalizedUrl, requestedBy);
    if (pipedResult) return pipedResult;

    // Krok 2: yt-dlp
    try {
        log.info('resolver', 'Piped API unavailable, trying direct yt-dlp...');
        const output = runYtDlp(normalizedUrl, '-j --no-playlist');
        const data = JSON.parse(output.trim().split('\n')[0]);
        const single = {
            title: data.title || 'Unknown Title',
            url: data.webpage_url || data.original_url || normalizedUrl,
            streamUrl: data.url || null,
            author: data.uploader || data.channel || 'Unknown Artist',
            duration: data.duration || 0,
            thumbnail: data.thumbnail || null,
            requestedBy: requestedBy || null,
            lyrics: null,
            album: null,
            source: 'youtube'
        };
        return [await enrichTrackMetadata(single)];
    } catch (err) {
        log.warn('resolver', `yt-dlp blocked, falling back to SoundCloud via yt-dlp: ${err.message}`);
        // Krok 3: SoundCloud fallback přes yt-dlp
        return resolveYouTubeUrlViaSoundCloudFallback(normalizedUrl, requestedBy);
    }
}

async function resolve(input, requestedBy) {
    const trimmed = input.trim();
    const isUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://');

    if (isUrl) {
        log.info('resolver', 'URL detected, resolving via Piped/yt-dlp...');
        return resolveUrlViaYtDlp(trimmed, requestedBy);
    }

    log.info('resolver', 'Searching via yt-dlp (SoundCloud/YouTube):', trimmed);

    try {
        const output = runYtDlp(`scsearch1:${trimmed}`, '-j --no-playlist');
        const data = JSON.parse(output.trim().split('\n')[0]);
        const trackUrl = data.webpage_url || data.original_url;
        if (data && trackUrl) {
            const track = {
                title: data.title || 'Unknown Title',
                url: trackUrl,
                streamUrl: null,
                author: data.uploader || data.channel || 'Unknown Artist',
                duration: data.duration || 0,
                thumbnail: data.thumbnail || null,
                requestedBy: requestedBy || null,
                lyrics: null,
                album: null,
                source: 'soundcloud'
            };
            log.info('resolver', 'Selected SoundCloud search result:', track.title);
            return [await enrichTrackMetadata(track)];
        }
    } catch {}

    // Fallback na ytsearch
    try {
        const output = runYtDlp(`ytsearch1:${trimmed}`, '-j --no-playlist');
        const data = JSON.parse(output.trim().split('\n')[0]);
        const track = {
            title: data.title || 'Unknown Title',
            url: data.webpage_url || data.original_url || `https://www.youtube.com/watch?v=${data.id}`,
            streamUrl: data.url || null,
            author: data.uploader || data.channel || 'Unknown Artist',
            duration: data.duration || 0,
            thumbnail: data.thumbnail || null,
            requestedBy: requestedBy || null,
            lyrics: null,
            album: null,
            source: 'youtube'
        };
        log.info('resolver', 'Selected YouTube search result:', track.url);
        return [await enrichTrackMetadata(track)];
    } catch (err) {
        throw new Error('No results found for: ' + trimmed);
    }
}

module.exports = { resolve };
