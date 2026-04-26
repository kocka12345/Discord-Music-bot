const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const playdl = require('play-dl');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('./logger');

function isYouTubeUrl(url) {
  return /(?:youtube\.com|youtu\.be)/i.test(url || '');
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

function getYtDlpPath() {
  const envBin = process.env.YTDLP_BIN?.trim();
  if (envBin) return envBin;

  const localWin = path.join(__dirname, '..', 'yt-dlp.exe');
  if (fs.existsSync(localWin)) return localWin;

  const localUnix = path.join(__dirname, '..', 'yt-dlp');
  if (fs.existsSync(localUnix)) return localUnix;

  return 'yt-dlp';
}

function maybeWriteCookiesFile() {
  const b64 = process.env.YTDLP_COOKIES_B64?.trim();
  const raw = process.env.YTDLP_COOKIES?.trim();
  if (!b64 && !raw) return null;

  const text = b64 ? Buffer.from(b64.replace(/\s+/g, ''), 'base64').toString('utf8') : raw;
  if (!text?.trim()) return null;

  const cookiesPath = path.join(os.tmpdir(), `yt-dlp-cookies-${process.pid}.txt`);
  fs.writeFileSync(cookiesPath, text, 'utf8');
  return cookiesPath;
}

async function downloadWithYtDlp(url) {
  const ytdlp = getYtDlpPath();
  const outputPath = path.join(os.tmpdir(), `discord-bot-cache-${Date.now()}.webm`);
  const cookiesPath = maybeWriteCookiesFile();

  const args = [
    '-f', 'bestaudio/best',
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    '-o', outputPath,
  ];
  if (cookiesPath) args.push('--cookies', cookiesPath);
  args.push(url);

  log.warn('stream', `Trying yt-dlp cache fallback with binary: ${ytdlp}`);

  await new Promise((resolve, reject) => {
    const proc = spawn(ytdlp, args);
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited with code ${code}`));
    });
  });

  return outputPath;
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
    this.player = createAudioPlayer();
    this.loopMode = 'none';
    this.volume = 0.5;
    this._resource = null;
    this._lyricsInterval = null;
    this._cachedFilePath = null;
    this._trackStartedAt = 0;
    this._pausedAt = 0;
    this._pausedAccumulatedMs = 0;
    this.lyricsEnabled = true;

    this.connection.subscribe(this.player);

    this.player.on(AudioPlayerStatus.Idle, () => {
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
        this.destroy();
      }
    });
  }

  async playNext() {
    if (this.tracks.length === 0) {
      this.currentTrack = null;
      this.textChannel.send('✅ Queue finished! Add more songs with `/play`.');
      this._stopLyricsDisplay();
      return;
    }

    this.currentTrack = this.tracks.shift();

    try {
      const { source, activeTrack } = await createPlayableSourceWithFallback(this.currentTrack);
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

      this.textChannel.send(this._nowPlayingEmbed(this.currentTrack));
      if (this.currentTrack.source === 'soundcloud-fallback') {
        this.textChannel.send('ℹ️ YouTube is rate-limited right now, using SoundCloud fallback for playback.');
      }
      this._startLyricsDisplay(0);
    } catch (err) {
      log.error('stream', 'Primary stream error:', err.message);

      if (isYouTubeUrl(this.currentTrack.url)) {
        try {
          const cachedPath = await downloadWithYtDlp(this.currentTrack.url);
          this._cachedFilePath = cachedPath;
          this._resource = createAudioResource(cachedPath, { inlineVolume: true });
          this._resource.volume.setVolume(this.volume);
          this.player.play(this._resource);
          this.textChannel.send(this._nowPlayingEmbed(this.currentTrack));
          this.textChannel.send('ℹ️ Using temporary cached playback fallback.');
          this._startLyricsDisplay(0);
          return;
        } catch (fallbackErr) {
          log.error('stream', 'yt-dlp cache fallback failed:', fallbackErr.message);
        }
      }

      this.textChannel.send(`⚠️ Could not play **${this.currentTrack.title}**. Skipping...`);
      this.playNext().catch(nextErr => {
        log.error('stream', 'Failed to continue queue after stream error:', nextErr.message);
      });
    }
  }

  _onTrackEnd() {
    if (this._cachedFilePath) {
      const toDelete = this._cachedFilePath;
      this._cachedFilePath = null;
      setTimeout(() => {
        fs.unlink(toDelete, err => {
          if (err) log.warn('cache', `Failed to delete cache file: ${toDelete}`);
          else log.info('cache', `Deleted cache file: ${toDelete}`);
        });
      }, 30_000);
    }

    this._stopLyricsDisplay();
    if (this.loopMode === 'track' && this.currentTrack) {
      this.tracks.unshift(this.currentTrack);
    } else if (this.loopMode === 'queue' && this.currentTrack) {
      this.tracks.push(this.currentTrack);
    }
    this.playNext().catch(err => {
      log.error('queue', 'Failed to play next track on idle:', err.message);
    });
  }

  skip() { this._stopLyricsDisplay(); this.player.stop(true); }
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
    this.tracks = [];
    this.currentTrack = null;
    this._stopLyricsDisplay();
    this.player.stop(true);
  }

  destroy() {
    this.stop();
    try { this.connection.destroy(); } catch {}
  }

  addTrack(track) { this.tracks.push(track); }
  addTrackNext(track) { this.tracks.unshift(track); }
  removeTrack(index) {
    if (index < 0 || index >= this.tracks.length) return null;
    return this.tracks.splice(index, 1)[0];
  }
  shuffleQueue() {
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
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
    if (line.text?.trim()) this.textChannel.send(`🎵 *${line.text}*`).catch(() => {});
    const nextLine = lyrics[this._lyricsIndex];
    if (nextLine) {
      const delay = Math.max(0, (nextLine.time - line.time) * 1000);
      this._lyricsInterval = setTimeout(() => this._postNextLyricLine(), delay);
    }
  }

  _nowPlayingEmbed(track) {
    const showLink = isYouTubeUrl(track.url);
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`▶️ Now Playing`)
      .setDescription([
        `**${track.title}**`,
        `👤 ${track.author}  •  ⏱️ ${this._formatDuration(track.duration)}`,
        track.requestedBy ? `Requested by <@${track.requestedBy}>` : '',
      ].filter(Boolean).join('\n'));

    if (showLink) embed.setURL(track.url);
    if (track.thumbnail) embed.setThumbnail(track.thumbnail);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`add_to_playlist:${track.url}`)
        .setLabel('➕ Add to Playlist')
        .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
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
}

module.exports = GuildQueue;