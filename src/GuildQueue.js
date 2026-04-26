const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const playdl = require('play-dl');
const log = require('./logger');

const PRECACHE_AHEAD_SECONDS = 30;
const MIN_PRECACHE_DELAY_MS = 3_000;
const TEMP_MESSAGE_TTL_MS = 30_000;
const HISTORY_LIMIT = 25;

function isYouTubeUrl(url) {
  return /(?:youtube\.com|youtu\.be)/i.test(url || '');
}

function sameTrack(a, b) {
  if (!a || !b) return false;
  return (a.url || '') === (b.url || '') && (a.title || '') === (b.title || '');
}

async function trySoundCloudFallback(query) {
  const results = await playdl.search(query, {
    source: { soundcloud: 'tracks' },
    limit: 1,
  });
  if (!results?.length) return null;
  return results[0];
}

async function buildSoundCloudFallbackQuery(track) {
  if (isYouTubeUrl(track.url)) {
    try {
      const info = await playdl.video_basic_info(track.url);
      const ytTitle = info?.video_details?.title?.trim();
      const ytAuthor = info?.video_details?.channel?.name?.trim();
      const ytQuery = [ytTitle, ytAuthor].filter(Boolean).join(' ');
      if (ytQuery) return ytQuery;
    } catch (err) {
      log.warn('stream', `Failed to fetch YouTube metadata for fallback query: ${err.message}`);
    }
  }

  return [track.title, track.author].filter(Boolean).join(' ');
}

async function createPlayableStream(url) {
  log.info('stream', `Creating play-dl stream: ${url}`);
  const source = await playdl.stream(url, {
    discordPlayerCompatibility: true,
  });
  return source;
}

async function createPlayableSourceWithFallback(track) {
  const streamTarget = track.streamUrl || track.url;
  try {
    const source = await createPlayableStream(streamTarget);
    return { source, activeTrack: track };
  } catch (err) {
    const message = String(err?.message || '');
    const isRateLimit = message.includes('429');
    const shouldFallback = isRateLimit && isYouTubeUrl(track.url);

    if (!shouldFallback) throw err;

    const query = await buildSoundCloudFallbackQuery(track);
    log.warn('stream', `YouTube rate-limited, trying SoundCloud fallback for: ${query}`);
    const fallback = await trySoundCloudFallback(query);
    if (!fallback) throw err;

    const fallbackTrack = {
      ...track,
      title: fallback.title || fallback.name || track.title,
      // Keep original URL for display/playlist use, stream from fallback URL.
      url: track.url,
      streamUrl: fallback.url || track.url,
      author: fallback.user?.name || fallback.channel?.name || fallback.uploader?.name || track.author,
      duration: fallback.durationInSec || track.duration,
      thumbnail: fallback.thumbnail?.url || fallback.thumbnail || track.thumbnail || null,
      source: 'soundcloud-fallback',
    };
    const source = await createPlayableStream(fallbackTrack.streamUrl);
    return { source, activeTrack: fallbackTrack };
  }
}

class GuildQueue {
  constructor(voiceConnection, textChannel) {
    this.connection = voiceConnection;
    this.textChannel = textChannel;
    this.tracks = [];
    this.currentTrack = null;
    this.history = [];
    this.player = createAudioPlayer();
    this.loopMode = 'none';
    this.volume = 0.5;
    this._resource = null;
    this._lyricsInterval = null;
    this._trackStartedAt = 0;
    this._pausedAt = 0;
    this._pausedAccumulatedMs = 0;
    this._precacheTimer = null;
    this._preloadedNext = null;
    this._lastNowPlayingMessage = null;
    this._lyricsDmBlockedWarned = false;
    this.lyricsEnabled = true;

    this.connection.subscribe(this.player);

    this.player.on(AudioPlayerStatus.Idle, () => {
      log.debug('player', `Audio player idle. queueSize=${this.tracks.length}`);
      this._onTrackEnd();
    });

    this.player.on('error', err => {
      log.error('player', 'Player error:', err.message);
      this._onTrackEnd();
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        log.warn('voice', 'Voice disconnected and reconnect failed. Destroying queue.');
        this.destroy();
      }
    });
  }

  async playNext() {
    this._clearPrecache();

    if (this.tracks.length === 0) {
      this.currentTrack = null;
      this._sendTemporaryChannelMessage('✅ Queue finished! Add more songs with `/play`.');
      this._stopLyricsDisplay();
      return;
    }

    this.currentTrack = this.tracks.shift();

    try {
      let prepared = null;
      if (this._preloadedNext && sameTrack(this.currentTrack, this._preloadedNext.track)) {
        prepared = this._preloadedNext;
        this._preloadedNext = null;
        log.info('precache', `Using preloaded stream for: ${this.currentTrack.title}`);
      }

      const { source, activeTrack } = prepared || await createPlayableSourceWithFallback(this.currentTrack);
      this.currentTrack = activeTrack;

      this._resource = createAudioResource(source.stream, {
        inputType: source.type,
        inlineVolume: true,
      });
      this._resource.volume.setVolume(this.volume);
      this.player.play(this._resource);
      this._trackStartedAt = Date.now();
      this._pausedAt = 0;
      this._pausedAccumulatedMs = 0;

      this._deleteLastNowPlayingMessage();
      this._lastNowPlayingMessage = await this._sendTemporaryChannelMessage(this._nowPlayingEmbed(this.currentTrack));
      if (this.currentTrack.source === 'soundcloud-fallback') {
        this._sendTemporaryChannelMessage('ℹ️ YouTube is rate-limited right now, using SoundCloud fallback for playback.');
      }
      this._lyricsDmBlockedWarned = false;
      this._startLyricsDisplay(0);
      this._schedulePrecache();
    } catch (err) {
      log.error('stream', 'Primary stream error:', err.message);
      this._sendTemporaryChannelMessage(`⚠️ Could not play **${this.currentTrack.title}**. Skipping...`);
      this.playNext().catch(nextErr => {
        log.error('stream', 'Failed to continue queue after stream error:', nextErr.message);
      });
    }
  }

  _onTrackEnd() {
    this._clearPrecache();
    this._deleteLastNowPlayingMessage();
    this._stopLyricsDisplay();
    if (this.currentTrack) {
      this.history.push(this.currentTrack);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
    }
    if (this.loopMode === 'track' && this.currentTrack) {
      this.tracks.unshift(this.currentTrack);
    } else if (this.loopMode === 'queue' && this.currentTrack) {
      this.tracks.push(this.currentTrack);
    }
    this.playNext().catch(err => {
      log.error('queue', 'Failed to play next track on idle:', err.message);
    });
  }

  skip() { this._clearPrecache(); this._stopLyricsDisplay(); this.player.stop(true); }
  pause() {
    if (!this._pausedAt) this._pausedAt = Date.now();
    this.player.pause();
  }
  resume() {
    if (this._pausedAt) {
      this._pausedAccumulatedMs += Date.now() - this._pausedAt;
      this._pausedAt = 0;
    }
    this.player.unpause();
  }

  setVolume(vol) {
    this.volume = vol / 100;
    if (this._resource?.volume) this._resource.volume.setVolume(this.volume);
  }

  stop() {
    this._clearPrecache();
    this._deleteLastNowPlayingMessage();
    this.tracks = [];
    this.history = [];
    this.currentTrack = null;
    this._stopLyricsDisplay();
    this.player.stop(true);
  }

  destroy() {
    this.stop();
    try { this.connection.destroy(); } catch {}
  }

  addTrack(track) { this._clearPrecache(); this.tracks.push(track); }
  addTrackNext(track) { this._clearPrecache(); this.tracks.unshift(track); }
  removeTrack(index) {
    this._clearPrecache();
    if (index < 0 || index >= this.tracks.length) return null;
    return this.tracks.splice(index, 1)[0];
  }
  shuffleQueue() {
    this._clearPrecache();
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
  }

  playPrevious() {
    const previous = this.history.pop();
    if (!previous) return false;
    if (this.currentTrack) {
      this.tracks.unshift(this.currentTrack);
    }
    this.tracks.unshift(previous);
    this.skip();
    return true;
  }

  _clearPrecache() {
    if (this._precacheTimer) {
      clearTimeout(this._precacheTimer);
      this._precacheTimer = null;
    }
    this._preloadedNext = null;
  }

  _schedulePrecache() {
    if (!this.currentTrack || this.tracks.length === 0) return;
    if (!this.currentTrack.duration || this.currentTrack.duration <= 0) return;

    const startInMs = Math.max(
      MIN_PRECACHE_DELAY_MS,
      (this.currentTrack.duration - PRECACHE_AHEAD_SECONDS) * 1000
    );

    this._precacheTimer = setTimeout(() => {
      this._precacheNextTrack().catch(err => {
        log.warn('precache', `Failed to precache next track: ${err.message}`);
      });
    }, startInMs);
  }

  async _precacheNextTrack() {
    if (this._preloadedNext) return;
    const candidate = this.tracks[0];
    if (!candidate) return;

    log.info('precache', `Preloading next track: ${candidate.title}`);
    const { source, activeTrack } = await createPlayableSourceWithFallback(candidate);
    this._preloadedNext = { source, track: activeTrack };
  }

  _startLyricsDisplay(startOffsetSec = 0) {
    this._stopLyricsDisplay();
    if (!this.currentTrack?.lyrics?.length || !this.lyricsEnabled) return;
    const lyrics = this.currentTrack.lyrics;
    const idx = lyrics.findIndex(line => line.time >= startOffsetSec);
    if (idx === -1) return;
    this._lyricsIndex = idx;
    const initialDelay = Math.max(0, Math.round((lyrics[idx].time - startOffsetSec) * 1000));
    this._lyricsInterval = setTimeout(() => this._postNextLyricLine(), initialDelay);
  }

  _stopLyricsDisplay() {
    if (this._lyricsInterval) { clearTimeout(this._lyricsInterval); this._lyricsInterval = null; }
  }

  _postNextLyricLine() {
    const lyrics = this.currentTrack?.lyrics;
    if (!lyrics || this._lyricsIndex >= lyrics.length) return;
    const line = lyrics[this._lyricsIndex++];
    if (line.text?.trim()) this._sendTemporaryLyricsToRequester(`🎵 *${line.text}*`);
    const nextLine = lyrics[this._lyricsIndex];
    if (nextLine) {
      const delay = Math.max(0, (nextLine.time - line.time) * 1000);
      this._lyricsInterval = setTimeout(() => this._postNextLyricLine(), delay);
    }
  }

  async _sendTemporaryChannelMessage(payload) {
    try {
      const msg = await this.textChannel.send(payload);
      setTimeout(() => {
        msg.delete().catch(() => {});
      }, TEMP_MESSAGE_TTL_MS);
      return msg;
    } catch {
      return null;
    }
  }

  _deleteLastNowPlayingMessage() {
    if (!this._lastNowPlayingMessage) return;
    this._lastNowPlayingMessage.delete().catch(() => {});
    this._lastNowPlayingMessage = null;
  }

  async _sendTemporaryLyricsToRequester(content) {
    const userId = this.currentTrack?.requestedBy;
    if (!userId) return;
    try {
      const user = await this.textChannel.client.users.fetch(userId);
      const dm = await user.send(content);
      setTimeout(() => {
        dm.delete().catch(() => {});
      }, TEMP_MESSAGE_TTL_MS);
    } catch (err) {
      if (!this._lyricsDmBlockedWarned) {
        this._lyricsDmBlockedWarned = true;
        log.warn('lyrics', `Could not DM lyrics to user ${userId}: ${err.message}`);
      }
    }
  }

  _nowPlayingEmbed(track) {
    const showLink = Boolean(track.url);
    const sourceLabel = track.source === 'soundcloud-fallback'
      ? 'SoundCloud fallback'
      : (isYouTubeUrl(track.url) ? 'YouTube' : 'SoundCloud/Other');
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Now Playing')
      .setDescription([
        `**${track.title}**`,
        `👤 **Artist:** ${track.author || 'Unknown Artist'}`,
        track.album ? `💿 **Album:** ${track.album}` : null,
        `⏱️ **Duration:** ${this._formatDuration(track.duration)}`,
        `🌐 **Source:** ${sourceLabel}`,
        track.requestedBy ? `Requested by <@${track.requestedBy}>` : '',
      ].filter(Boolean).join('\n'))
      .setFooter({ text: 'discord-music-bot' })
      .setTimestamp();

    if (showLink) embed.setURL(track.url);
    if (track.thumbnail) embed.setThumbnail(track.thumbnail);

    const controlsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('npctl:toggle_pause')
        .setLabel('⏯ Pause/Resume')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('npctl:previous')
        .setLabel('⏮ Previous')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('npctl:next')
        .setLabel('⏭ Next')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('npctl:shuffle')
        .setLabel('🔀 Shuffle')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('npctl:show_queue')
        .setLabel('📜 Queue')
        .setStyle(ButtonStyle.Secondary)
    );

    const playlistRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`add_to_playlist:${track.url}`)
        .setLabel('➕ Add to Playlist')
        .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [controlsRow, playlistRow] };
  }

  _formatDuration(seconds) {
    if (!seconds) return 'Live';
    const m = Math.floor(seconds / 60);
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  isPlaying() { return this.player.state.status === AudioPlayerStatus.Playing; }
  isPaused() { return this.player.state.status === AudioPlayerStatus.Paused; }
  getElapsedPlaybackSeconds() {
    if (!this._trackStartedAt) return 0;
    const inFlightPauseMs = this._pausedAt ? (Date.now() - this._pausedAt) : 0;
    const elapsedMs = Date.now() - this._trackStartedAt - this._pausedAccumulatedMs - inFlightPauseMs;
    return Math.max(0, Math.floor(elapsedMs / 1000));
  }
  setLyricsEnabled(enabled) {
    this.lyricsEnabled = Boolean(enabled);
    if (!this.lyricsEnabled) {
      this._stopLyricsDisplay();
      return;
    }
    if (this.currentTrack?.lyrics?.length) {
      this._startLyricsDisplay(this.getElapsedPlaybackSeconds());
    }
  }
  buildQueuePreview(pageSize = 10) {
    const lines = [];
    if (this.currentTrack) {
      lines.push(`▶️ Now: **${this.currentTrack.title}** — \`${this._formatDuration(this.currentTrack.duration)}\``);
    }
    if (!this.tracks.length) {
      lines.push('📭 Queue is empty.');
      return lines.join('\n');
    }
    lines.push(`\nUp next (${this.tracks.length}):`);
    this.tracks.slice(0, pageSize).forEach((t, i) => {
      lines.push(`\`${i + 1}.\` ${t.title} — \`${this._formatDuration(t.duration)}\``);
    });
    if (this.tracks.length > pageSize) {
      lines.push(`...and ${this.tracks.length - pageSize} more`);
    }
    return lines.join('\n').slice(0, 1900);
  }
}

module.exports = GuildQueue;