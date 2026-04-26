const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require('@discordjs/voice');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
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

// Find yt-dlp binary - OPRAVENO PRO RENDER
function getYtDlpPath() {
  const envBin = process.env.YTDLP_BIN?.trim();
  if (envBin) return envBin;

  // 1. Cesta na Renderu (ve složce src, kam to stahujeme přes Build Command)
  const renderPath = path.join(__dirname, 'yt-dlp');
  if (fs.existsSync(renderPath)) return renderPath;

  // 2. Cesta u tebe na Windows (o úroveň výš)
  const rootWin = path.join(__dirname, '..', 'yt-dlp.exe');
  if (fs.existsSync(rootWin)) return rootWin;

  // 3. Fallback pro root projektu na Linuxu
  const rootUnix = path.join(__dirname, '..', 'yt-dlp');
  if (fs.existsSync(rootUnix)) return rootUnix;

  return 'yt-dlp';
}

function createYtDlpStream(url) {
  const ytdlp = getYtDlpPath();
  const authArgs = getYtDlpAuthArgs();
  logAuthInfoOnce('stream');
  log.info('stream', `Using binary for streaming: ${ytdlp}`);
  log.info('stream', `Streaming: ${url}`);
  log.debug('stream', 'Spawn args:', [
    '-f', '251/250/249/140/bestaudio/best',
    '--no-playlist',
    '-o', '-',
    '--quiet',
    '--no-warnings',
    ...authArgs,
    url,
  ]);
  const proc = spawn(ytdlp, [
    // Explicit fallbacks: these audio formats are commonly available
    // even when generic bestaudio selectors fail on cloud hosts.
    '-f', '251/250/249/140/bestaudio/best',
    '--no-playlist',
    '-o', '-',
    '--quiet',
    '--no-warnings',
    ...authArgs,
    url,
  ]);
  proc.stderr.on('data', d => log.error('yt-dlp-stderr', d.toString().trim()));
  proc.on('error', err => log.error('yt-dlp-spawn', err.message));
  proc.on('close', code => log.info('stream', `yt-dlp exited with code ${code}`));
  return proc.stdout;
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
      const stream = createYtDlpStream(this.currentTrack.url);

      this._resource = createAudioResource(stream, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true,
      });
      this._resource.volume.setVolume(this.volume);
      this.player.play(this._resource);

      this.textChannel.send(this._nowPlayingEmbed(this.currentTrack));
      this._startLyricsDisplay();
    } catch (err) {
      log.error('stream', 'Stream error:', err.message);
      this.textChannel.send(`⚠️ Could not play **${this.currentTrack.title}**. Skipping...`);
      this.playNext();
    }
  }

  _onTrackEnd() {
    this._stopLyricsDisplay();
    if (this.loopMode === 'track' && this.currentTrack) {
      this.tracks.unshift(this.currentTrack);
    } else if (this.loopMode === 'queue' && this.currentTrack) {
      this.tracks.push(this.currentTrack);
    }
    this.playNext();
  }

  skip() { this._stopLyricsDisplay(); this.player.stop(true); }
  pause() { this.player.pause(); }
  resume() { this.player.unpause(); }

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

  _startLyricsDisplay() {
    this._stopLyricsDisplay();
    if (!this.currentTrack?.lyrics?.length) return;
    this._lyricsIndex = 0;
    this._postNextLyricLine();
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
      const delay = (nextLine.time - line.time) * 1000;
      this._lyricsInterval = setTimeout(() => this._postNextLyricLine(), delay);
    }
  }

  _nowPlayingEmbed(track) {
    const content = [
      `▶️  **Now Playing**`,
      `**${track.title}**`,
      `👤 ${track.author}  •  ⏱️ ${this._formatDuration(track.duration)}`,
      `🔗 ${track.url}`,
      track.requestedBy ? `Requested by <@${track.requestedBy}>` : '',
    ].filter(Boolean).join('\n');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`add_to_playlist:${track.url}`)
        .setLabel('➕ Add to Playlist')
        .setStyle(ButtonStyle.Secondary)
    );

    return { content, components: [row] };
  }

  _formatDuration(seconds) {
    if (!seconds) return 'Live';
    const m = Math.floor(seconds / 60);
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  isPlaying() { return this.player.state.status === AudioPlayerStatus.Playing; }
  isPaused() { return this.player.state.status === AudioPlayerStatus.Paused; }
}

module.exports = GuildQueue;