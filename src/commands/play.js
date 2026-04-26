const { SlashCommandBuilder } = require('discord.js');
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const GuildQueue = require('../GuildQueue');
const { resolve } = require('../resolver');

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
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.member;
    const voiceChannel = member.voice?.channel;

    if (!voiceChannel) {
      return interaction.editReply('❌ You need to be in a voice channel first!');
    }

    const query = interaction.options.getString('query');

    // Resolve tracks
    let tracks;
    try {
      tracks = await resolve(query, interaction.user.id);
    } catch (err) {
      return interaction.editReply(`❌ Could not find: **${query}**\n${err.message}`);
    }

    // Check blocked songs
    const blocked = client.blocked || { urls: [], names: [] };
    const allowed = tracks.filter(t => {
      const urlBlocked = blocked.urls.includes(t.url);
      const nameBlocked = blocked.names.some(n => t.title.toLowerCase().includes(n.toLowerCase()));
      return !urlBlocked && !nameBlocked;
    });

    if (allowed.length === 0) {
      return interaction.editReply('🚫 That song/playlist is blocked on this server.');
    }
    tracks = allowed;

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
      } catch {
        connection.destroy();
        return interaction.editReply('❌ Failed to join voice channel.');
      }

      queue = new GuildQueue(connection, interaction.channel);
      client.queues.set(interaction.guildId, queue);

      queue.connection.on(VoiceConnectionStatus.Destroyed, () => {
        client.queues.delete(interaction.guildId);
      });
    }

    // Add tracks
    for (const track of tracks) {
      queue.addTrack(track);
    }

    const wasIdle = !queue.isPlaying() && !queue.isPaused();

    if (wasIdle) {
      queue.playNext();
      if (tracks.length === 1) {
        await interaction.editReply(`🎵 Starting **${tracks[0].title}**`);
      } else {
        await interaction.editReply(`🎵 Starting playlist — **${tracks.length} tracks** added`);
      }
    } else {
      if (tracks.length === 1) {
        await interaction.editReply(`✅ Added to queue: **${tracks[0].title}**`);
      } else {
        await interaction.editReply(`✅ Added **${tracks.length} tracks** from playlist to queue`);
      }
    }
  },
};