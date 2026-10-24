const { execSync } = require('child_process');
const playdl = require('play-dl');
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

function normalizeSearchTrack(found, requestedBy) {
    const title = pickFirst(found?.title, found?.name, found?.id, 'Unknown Title');
    const author = pickFirst(
        found?.channel?.name,
        found?.user?.name,
        found?.uploader?.name,
        found?.uploader,
        'Unknown Artist'
    );
    const duration = found?.durationInSec || 0;
    const thumbnail = pickFirst(
        found?.thumbnails?.[0]?.url,
        found?.thumbnail?.url,
        found?.thumbnail
    );

    return {
        title,
        url: found?.url,
        author,
        duration,
        thumbnail: thumbnail || null,
        requestedBy: requestedBy || null,
        lyrics: null,
    };
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

async function resolveYouTubeUrlViaSoundCloudFallback(url, requestedBy) {
    const meta = await fetchYouTubeBasicMeta(url);
    const query = [meta?.title, meta?.author].filter(Boolean).join(' ').trim();
    if (!query) {
        throw new Error('Could not read YouTube title for fallback lookup.');
    }

    const scResults = await playdl.search(query, {
        source: { soundcloud: 'tracks' },
        limit: 1,
    }).catch(() => []);

    if (!scResults.length) {
        throw new Error('Could not resolve URL via yt-dlp and no SoundCloud match found.');
    }

    const sc = normalizeSearchTrack(scResults[0], requestedBy);
    return [{
        title: meta?.title || sc.title || 'Unknown Title',
        url: url,
        streamUrl: sc.url,
        author: sc.author || meta?.author || 'Unknown Artist',
        duration: sc.duration || 0,
        thumbnail: sc.thumbnail || meta?.thumbnail || null,
        requestedBy: requestedBy || null,
        lyrics: null,
        album: null,
        source: 'soundcloud-from-youtube',
    }];
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

    // Pokus 1: Přímé stažení URL
    try {
        log.info('resolver', 'Resolving single video via yt-dlp...');
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
        log.warn('resolver', `Direct yt-dlp failed, using oembed + search fallback: ${err.message}`);
        
        // Pokus 2: Získání metadat přes OEmbed a vyhledání přes ytsearch1
        const meta = await fetchYouTubeBasicMeta(normalizedUrl);
        const query = [meta?.title, meta?.author].filter(Boolean).join(' ').trim();
        
        if (query) {
            try {
                const searchOutput = runYtDlp(`ytsearch1:${query}`, '-j --no-playlist');
                const data = JSON.parse(searchOutput.trim().split('\n')[0]);
                const single = {
                    title: data.title || meta?.title || 'Unknown Title',
                    url: normalizedUrl,
                    streamUrl: data.url || null,
                    author: data.uploader || data.channel || meta?.author || 'Unknown Artist',
                    duration: data.duration || 0,
                    thumbnail: data.thumbnail || meta?.thumbnail || null,
                    requestedBy: requestedBy || null,
                    lyrics: null,
                    album: null,
                    source: 'youtube'
                };
                return [await enrichTrackMetadata(single)];
            } catch (searchErr) {
                // Pokus 3: SoundCloud fallback
                return resolveYouTubeUrlViaSoundCloudFallback(normalizedUrl, requestedBy);
            }
        }
        
        throw err;
    }
}

async function resolve(input, requestedBy) {
    const trimmed = input.trim();
    const isUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://');

    if (isUrl) {
        log.info('resolver', 'URL detected, resolving via yt-dlp...');
        return resolveUrlViaYtDlp(trimmed, requestedBy);
    }

    log.info('resolver', 'Searching via SoundCloud / yt-dlp:', trimmed);

    const scResults = await playdl.search(trimmed, { source: { soundcloud: 'tracks' }, limit: 1 })
        .catch(() => []);
    if (scResults.length) {
        const found = scResults[0];
        log.info('resolver', 'Selected SoundCloud result:', found.url);
        return [await enrichTrackMetadata(normalizeSearchTrack(found, requestedBy))];
    }

    // Fallback to yt-dlp search
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
        log.info('resolver', 'Selected YouTube yt-dlp search result:', track.url);
        return [await enrichTrackMetadata(track)];
    } catch (err) {
        throw new Error('No results found for: ' + trimmed);
    }
}

module.exports = { resolve };
