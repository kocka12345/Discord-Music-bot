const log = require('./logger');

function buildLookupQuery(track) {
  return [track?.title, track?.author]
    .filter(Boolean)
    .join(' ')
    .trim();
}

async function searchItunes(query) {
  if (!query) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&limit=1&media=music`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const item = data?.results?.[0];
    if (!item) return null;
    return {
      author: item.artistName || null,
      album: item.collectionName || null,
      thumbnail: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichTrackMetadata(track) {
  if (!track) return track;
  const needsAuthor = !track.author || track.author === 'Unknown Artist';
  const needsCover = !track.thumbnail;
  const needsAlbum = !track.album;
  if (!needsAuthor && !needsCover && !needsAlbum) return track;

  const query = buildLookupQuery(track);
  const meta = await searchItunes(query);
  if (!meta) return track;

  const enriched = {
    ...track,
    author: needsAuthor ? (meta.author || track.author) : track.author,
    thumbnail: needsCover ? (meta.thumbnail || track.thumbnail || null) : track.thumbnail,
    album: needsAlbum ? (meta.album || null) : track.album || null,
  };

  log.debug('metadata', `Enriched track metadata for "${track.title}"`);
  return enriched;
}

module.exports = { enrichTrackMetadata };
