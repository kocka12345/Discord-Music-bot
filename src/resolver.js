const playdl = require('play-dl');
const log = require('./logger');

function videoDetailsToTrack(details, requestedBy) {
    return {
        title: details.title || 'Unknown Title',
        url: details.url || `https://www.youtube.com/watch?v=${details.id}`,
        author: details.channel?.name || details.channel?.url || details.channel || 'Unknown',
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

    log.info('resolver', 'Searching via play-dl:', trimmed);
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