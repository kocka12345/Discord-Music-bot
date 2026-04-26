const log = require('./logger');

function getLavalinkConfig() {
  const baseUrl = process.env.LAVALINK_URL?.trim();
  const password = process.env.LAVALINK_PASSWORD?.trim();
  if (!baseUrl || !password) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ''), password };
}

function mapTrackData(data, requestedBy) {
  const info = data?.info || {};
  return {
    title: info.title || 'Unknown Title',
    url: info.uri || null,
    author: info.author || 'Unknown Artist',
    duration: Number.isFinite(info.length) ? Math.floor(info.length / 1000) : 0,
    thumbnail: info.artworkUrl || null,
    requestedBy: requestedBy || null,
    lyrics: null,
    source: info.sourceName || 'lavalink',
  };
}

async function loadTracks(identifier) {
  const cfg = getLavalinkConfig();
  if (!cfg) return null;

  const endpoint = `${cfg.baseUrl}/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`;
  const res = await fetch(endpoint, {
    headers: {
      Authorization: cfg.password,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Lavalink loadtracks failed (${res.status}): ${body || 'no body'}`);
  }

  return res.json();
}

async function resolveWithLavalink(input, requestedBy) {
  const trimmed = input.trim();
  const isUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://');

  if (isUrl) {
    const loaded = await loadTracks(trimmed);
    if (!loaded || loaded.loadType === 'empty') {
      throw new Error('No tracks found for URL.');
    }

    if (loaded.loadType === 'playlist') {
      const tracks = (loaded.data?.tracks || []).map(t => mapTrackData(t, requestedBy));
      if (!tracks.length) throw new Error('Playlist is empty or unavailable.');
      return tracks;
    }

    if (loaded.loadType === 'track' || loaded.loadType === 'search') {
      const first = loaded.data?.[0];
      if (!first) throw new Error('Track is unavailable.');
      return [mapTrackData(first, requestedBy)];
    }

    if (loaded.loadType === 'error') {
      throw new Error(loaded.data?.message || 'Lavalink could not load this URL.');
    }

    throw new Error('Unsupported Lavalink load type.');
  }

  // Keep YouTube as absolute first choice in fallback order.
  const yt = await loadTracks(`ytsearch:${trimmed}`);
  if (yt && (yt.loadType === 'track' || yt.loadType === 'search')) {
    const first = yt.data?.[0];
    if (first) {
      log.info('resolver', 'Selected YouTube result from Lavalink.');
      return [mapTrackData(first, requestedBy)];
    }
  }

  const sc = await loadTracks(`scsearch:${trimmed}`);
  if (sc && (sc.loadType === 'track' || sc.loadType === 'search')) {
    const first = sc.data?.[0];
    if (first) {
      log.info('resolver', 'Selected SoundCloud result from Lavalink.');
      return [mapTrackData(first, requestedBy)];
    }
  }

  throw new Error(`No results found for: ${trimmed}`);
}

module.exports = { getLavalinkConfig, resolveWithLavalink };
