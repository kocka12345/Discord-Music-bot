const { SlashCommandBuilder } = require('discord.js');
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const GuildQueue = require('../GuildQueue');
const { resolve } = require('../resolver');
const log = require('../logger');
const { getGuildSettings } = require('../guildSettings');

function isInteractionAckError(err) {
  return err?.code === 10062 || err?.code === 40060;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a YouTube video or playlist, or search by name')
    .addStringOption(o =>
      o.setName('query')
        .setDescription('YouTube URL or search query')
        .setRequired(true)
    ),

  async execute(interaction, client) {
    log.debug('play', `Received /play from ${interaction.user.id}`);
    client._playCooldowns = client._playCooldowns || new Map();
    client._playInFlightGuilds = client._playInFlightGuilds || new Set();
    const guildSettings = getGuildSettings(client, interaction.guildId);
    const cooldownMs = Math.max(0, Number(guildSettings.playCooldownSec || 0) * 1000);

    const cooldownKey = `${interaction.guildId}:${interaction.user.id}`;
    const now = Date.now();
    const lastCall = client._playCooldowns.get(cooldownKey) || 0;
    const remainingMs = cooldownMs - (now - lastCall);
    if (remainingMs > 0) {
      const waitSec = (remainingMs / 1000).toFixed(1);
      await interaction.reply({
        content: `⏳ Slow down a bit. Try /play again in ${waitSec}s.`,
        ephemeral: true,
      }).catch(() => {});
      return;
    }
    client._playCooldowns.set(cooldownKey, now);

    if (client._playInFlightGuilds.has(interaction.guildId)) {
      await interaction.reply({
        content: '⏳ Another /play request is processing right now. Try again in a moment.',
        ephemeral: true,
      }).catch(() => {});
      return;
    }
    client._playInFlightGuilds.add(interaction.guildId);

    try {
    let canUseInteractionReply = true;
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (err) {
      if (isInteractionAckError(err)) {
        canUseInteractionReply = false;
        log.warn('play', `Interaction ack failed (${err.code}), continuing without interaction reply.`);
      } else {
        throw err;
      }
    }

    const replySafe = async content => {
      if (canUseInteractionReply) {
        try {
          await interaction.editReply(content);
          return;
        } catch (err) {
          if (!isInteractionAckError(err)) throw err;
          canUseInteractionReply = false;
          log.warn('play', `Interaction reply failed (${err.code}), falling back to channel message.`);
        }
      }
      await interaction.channel?.send(typeof content === 'string' ? content : String(content)).catch(() => {});
    };

    const member = interaction.member;
    const voiceChannel = member.voice?.channel;

    if (!voiceChannel) {
      return replySafe('❌ You need to be in a voice channel first!');
    }

    const query = interaction.options.getString('query');

    // Resolve tracks
    let tracks;
    try {
      tracks = await resolve(query, interaction.user.id);
      log.info('play', `Resolved ${tracks.length} track(s) for query: ${query}`);
    } catch (err) {
      log.warn('play', `Resolve failed for query "${query}": ${err.message}`);
      return replySafe(`❌ Could not find: **${query}**\n${err.message}`);
    }

    // Check blocked songs
    const blocked = client.blocked || { urls: [], names: [] };
    const allowed = tracks.filter(t => {
      const urlBlocked = blocked.urls.includes(t.url);
      const nameBlocked = blocked.names.some(n => t.title.toLowerCase().includes(n.toLowerCase()));
      return !urlBlocked && !nameBlocked;
    });

    if (allowed.length === 0) {
      return replySafe('🚫 That song/playlist is blocked on this server.');
    }
    tracks = allowed;

    const maxTracks = Math.max(1, Number(guildSettings.maxTracksPerPlay || 30));
    if (tracks.length > maxTracks) {
      const dropped = tracks.length - maxTracks;
      tracks = tracks.slice(0, maxTracks);
      await replySafe(`ℹ️ This server allows max **${maxTracks}** tracks per /play. Trimmed **${dropped}** track(s).`);
    }

    // Get or create guild queue
    let queue = client.queues.get(interaction.guildId);

    if (!queue) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
        log.info('voice', `Connected to voice channel ${voiceChannel.id}`);
      } catch {
        connection.destroy();
        log.error('voice', `Failed to connect to voice channel ${voiceChannel.id}`);
        return replySafe('❌ Failed to join voice channel.');
      }

      queue = new GuildQueue(connection, interaction.channel);
      client.queues.set(interaction.guildId, queue);
      queue.setVolume(Number(guildSettings.defaultVolume || 50));
      queue.setLyricsEnabled(Boolean(guildSettings.autoLiveLyrics));

      queue.connection.on(VoiceConnectionStatus.Destroyed, () => {
        client.queues.delete(interaction.guildId);
      });
    }
    queue.setPreferredVoiceChannelId(voiceChannel.id);

    // Add tracks
    for (const track of tracks) {
      queue.addTrack(track);
    }

    const wasIdle = !queue.isPlaying() && !queue.isPaused();

    if (wasIdle) {
      queue.playNext().catch(err => {
        log.error('play', 'Failed to start playback:', err.message);
      });
      if (tracks.length === 1) {
        const prefix = guildSettings.testMode ? '🧪 [TEST MODE] ' : '';
        await replySafe(`${prefix}🎵 Starting playing **${tracks[0].title}**`);
      } else {
        const prefix = guildSettings.testMode ? '🧪 [TEST MODE] ' : '';
        await replySafe(`${prefix}🎵 Starting playlist — **${tracks.length} tracks**`);
      }
    } else {
      if (tracks.length === 1) {
        await replySafe(`✅ Added to queue: **${tracks[0].title}**`);
      } else {
        await replySafe(`✅ Added **${tracks.length} tracks** from playlist to queue`);
      }
    }
    } finally {
      client._playInFlightGuilds.delete(interaction.guildId);
    }
  },
};