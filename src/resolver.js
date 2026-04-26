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

function videoDetailsToTrack(details, requestedBy) {
    return {
        title: details.title || details.id || 'Unknown Title',
        url: details.url || `https://www.youtube.com/watch?v=${details.id}`,
        author: details.channel?.name || details.channel?.url || details.channel || 'Unknown Artist',
        duration: details.durationInSec || 0,
        thumbnail: details.thumbnails?.[0]?.url || details.thumbnail?.url || null,
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

function isYouTubeUrl(url) {
    return /(?:youtube\.com|youtu\.be)/i.test(url || '');
}

async function resolveYouTubeUrlViaSoundCloud(url, requestedBy) {
    const info = await playdl.video_basic_info(url).catch(err => {
        throw new Error(err.message || 'Failed to fetch YouTube metadata');
    });

    const details = info?.video_details;
    if (!details) throw new Error('Failed to read YouTube video details');

    const ytTrack = videoDetailsToTrack(details, requestedBy);
    const query = [details.title, details.channel?.name].filter(Boolean).join(' ').trim();
    if (!query) return [ytTrack];

    const scResults = await playdl.search(query, {
        source: { soundcloud: 'tracks' },
        limit: 1,
    }).catch(() => []);

    if (!scResults.length) return [ytTrack];

    const sc = normalizeSearchTrack(scResults[0], requestedBy);
    return [{
        ...ytTrack,
        streamUrl: sc.url || ytTrack.url,
        title: ytTrack.title || sc.title,
        author: sc.author || ytTrack.author,
        duration: sc.duration || ytTrack.duration,
        thumbnail: sc.thumbnail || ytTrack.thumbnail,
        album: sc.album || ytTrack.album || null,
        source: 'soundcloud-from-youtube',
    }];
}

function shouldExpandWatchMix(url) {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./, '');
        if (host !== 'youtube.com' && host !== 'm.youtube.com') return false;
        return parsed.pathname === '/watch' && !parsed.searchParams.get('list');
    } catch {
        return false;
    }
}

async function resolveYouTubeWatchMix(url, requestedBy) {
    const seed = await playdl.video_basic_info(url).catch(err => {
        throw new Error(err.message || 'Failed to load YouTube watch info');
    });

    const tracks = [videoDetailsToTrack(seed.video_details, requestedBy)];
    const related = Array.isArray(seed.related_videos) ? seed.related_videos : [];
    const unique = [...new Set(related)].slice(0, 15);
    if (!unique.length) return tracks;

    // Add related URLs as lightweight tracks to emulate playlist behavior.
    tracks.push(...unique.map((relatedUrl, idx) => ({
        title: `Mix Track ${idx + 1}`,
        url: relatedUrl,
        author: 'YouTube Mix',
        duration: 0,
        thumbnail: null,
        requestedBy: requestedBy || null,
        lyrics: null,
    })));
    return tracks;
}

async function resolveUrl(url, requestedBy) {
    const normalizedUrl = normalizeYouTubeUrl(url);
    const listId = parseYouTubeListId(normalizedUrl);
    if (isYouTubeUrl(normalizedUrl) && !listId) {
        return resolveYouTubeUrlViaSoundCloud(normalizedUrl, requestedBy);
    }

    const playlistUrl = listId ? `https://www.youtube.com/playlist?list=${listId}` : normalizedUrl;

    const playlist = await playdl.playlist_info(playlistUrl, { incomplete: true }).catch(() => null);
    if (playlist) {
        const videos = await playlist.all_videos();
        if (!videos?.length) throw new Error('Playlist is empty or unavailable.');
        return videos.map(v => ({
            title: v.title || 'Unknown',
            url: v.url,
            author: v.channel?.name || 'Unknown',
            duration: v.durationInSec || 0,
            thumbnail: v.thumbnails?.[0]?.url || null,
            requestedBy: requestedBy || null,
            lyrics: null,
        }));
    }

    if (shouldExpandWatchMix(normalizedUrl)) {
        return resolveYouTubeWatchMix(normalizedUrl, requestedBy);
    }

    const info = await playdl.video_basic_info(normalizedUrl).catch(err => {
        throw new Error(err.message || 'Failed to fetch video info');
    });
    const single = videoDetailsToTrack(info.video_details, requestedBy);
    return [await enrichTrackMetadata(single)];
}

async function resolve(input, requestedBy) {
    const trimmed = input.trim();
    const isUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://');

    if (isUrl) {
        log.info('resolver', 'URL detected, resolving via play-dl...');
        return resolveUrl(trimmed, requestedBy);
    }

    log.info('resolver', 'Searching via play-dl (SoundCloud first):', trimmed);

    let found = null;

    const scResults = await playdl.search(trimmed, { source: { soundcloud: 'tracks' }, limit: 1 })
        .catch(() => []);
    if (scResults.length) {
        found = scResults[0];
        log.info('resolver', 'Selected SoundCloud result:', found.url);
    } else {
        const ytResults = await playdl.search(trimmed, { source: { youtube: 'video' }, limit: 1 })
            .catch(() => []);
        if (!ytResults.length) throw new Error('No results found for: ' + trimmed);
        found = ytResults[0];
        log.info('resolver', 'Selected YouTube fallback result:', found.url);
    }

    return [await enrichTrackMetadata(normalizeSearchTrack(found, requestedBy))];
}

module.exports = { resolve };