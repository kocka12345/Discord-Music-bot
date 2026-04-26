const playdl = require('play-dl');
const log = require('./logger');

function pickFirst(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return null;
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

async function resolveUrl(url, requestedBy) {
    const playlist = await playdl.playlist_info(url, { incomplete: true }).catch(() => null);
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

    const info = await playdl.video_basic_info(url).catch(err => {
        throw new Error(err.message || 'Failed to fetch video info');
    });
    return [videoDetailsToTrack(info.video_details, requestedBy)];
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

    // Prefer SoundCloud on cloud hosts to avoid frequent YouTube 429 limits.
    const scResults = await playdl.search(trimmed, { source: { soundcloud: 'tracks' }, limit: 1 })
        .catch(() => []);
    if (scResults.length) {
        found = scResults[0];
        log.info('resolver', 'Selected SoundCloud result:', found.url);
    } else {
        const ytResults = await playdl.search(trimmed, { source: { youtube: 'video' }, limit: 1 });
        if (!ytResults.length) throw new Error('No results found for: ' + trimmed);
        found = ytResults[0];
        log.info('resolver', 'Selected YouTube result:', found.url);
    }

    return [normalizeSearchTrack(found, requestedBy)];
}

module.exports = { resolve };