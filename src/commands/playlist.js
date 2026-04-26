const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const { resolve } = require('../resolver');

// ── Playlist helpers ───────────────────────────────────────────────────────

function loadPlaylists(client) {
  try {
    return JSON.parse(fs.readFileSync(client.playlistFile, 'utf8'));
  } catch {
    return {};
  }
}

function savePlaylists(client, data) {
  fs.writeFileSync(client.playlistFile, JSON.stringify(data, null, 2));
}

function getUserPlaylists(client, userId) {
  const all = loadPlaylists(client);
  return all[userId] || {};
}

function saveUserPlaylists(client, userId, playlists) {
  const all = loadPlaylists(client);
  all[userId] = playlists;
  savePlaylists(client, all);
}

function normalizePlaylist(playlist) {
  if (Array.isArray(playlist)) return { public: false, tracks: playlist };
  if (!playlist || typeof playlist !== 'object') return { public: false, tracks: [] };
  return {
    public: Boolean(playlist.public),
    tracks: Array.isArray(playlist.tracks) ? playlist.tracks : [],
  };
}

// ── /playlist create ───────────────────────────────────────────────────────

const playlistCmd = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Manage your personal playlists')
    .addSubcommand(s =>
      s.setName('create')
        .setDescription('Create a new playlist')
        .addStringOption(o => o.setName('name').setDescription('Playlist name').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('add')
        .setDescription('Add a song to a playlist')
        .addStringOption(o => o.setName('name').setDescription('Playlist name').setRequired(true))
        .addStringOption(o => o.setName('url').setDescription('YouTube URL or search query').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('remove')
        .setDescription('Remove a song from a playlist')
        .addStringOption(o => o.setName('name').setDescription('Playlist name').setRequired(true))
        .addIntegerOption(o => o.setName('position').setDescription('Track position (1-based)').setMinValue(1).setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('list')
        .setDescription('List your playlists or a playlist\'s tracks')
        .addStringOption(o => o.setName('name').setDescription('Playlist name (omit to see all)'))
    )
    .addSubcommand(s =>
      s.setName('play')
        .setDescription('Queue an entire personal playlist')
        .addStringOption(o => o.setName('name').setDescription('Playlist name').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('delete')
        .setDescription('Delete a playlist')
        .addStringOption(o => o.setName('name').setDescription('Playlist name').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('rename')
        .setDescription('Rename a playlist')
        .addStringOption(o => o.setName('name').setDescription('Current name').setRequired(true))
        .addStringOption(o => o.setName('newname').setDescription('New name').setRequired(true))
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const playlists = getUserPlaylists(client, userId);

    // ── create ──
    if (sub === 'create') {
      const name = interaction.options.getString('name');
      if (playlists[name]) return interaction.reply({ content: `❌ Playlist **${name}** already exists.`, ephemeral: true });
      playlists[name] = { public: false, tracks: [] };
      saveUserPlaylists(client, userId, playlists);
      return interaction.reply(`✅ Created playlist **${name}**. Add songs with \`/playlist add name:${name} url:<link>\`.`);
    }

    // ── add ──
    if (sub === 'add') {
      const name = interaction.options.getString('name');
      const query = interaction.options.getString('url');

      if (!playlists[name]) return interaction.reply({ content: `❌ Playlist **${name}** not found.`, ephemeral: true });

      await interaction.deferReply();

      let tracks;
      try {
        tracks = await resolve(query, userId);
      } catch (err) {
        return interaction.editReply(`❌ Could not resolve: ${err.message}`);
      }

      const playlist = normalizePlaylist(playlists[name]);
      playlist.tracks.push(...tracks.map(t => ({ title: t.title, url: t.url, author: t.author, duration: t.duration })));
      playlists[name] = playlist;
      saveUserPlaylists(client, userId, playlists);

      return interaction.editReply(
        tracks.length === 1
          ? `✅ Added **${tracks[0].title}** to **${name}**`
          : `✅ Added **${tracks.length} tracks** to **${name}**`
      );
    }

    // ── remove ──
    if (sub === 'remove') {
      const name = interaction.options.getString('name');
      if (!playlists[name]) return interaction.reply({ content: `❌ Playlist **${name}** not found.`, ephemeral: true });
      const playlist = normalizePlaylist(playlists[name]);

      const pos = interaction.options.getInteger('position') - 1;
      if (pos < 0 || pos >= playlist.tracks.length) {
        return interaction.reply({ content: '❌ Invalid position.', ephemeral: true });
      }
      const [removed] = playlist.tracks.splice(pos, 1);
      playlists[name] = playlist;
      saveUserPlaylists(client, userId, playlists);
      return interaction.reply(`🗑️ Removed **${removed.title}** from **${name}**`);
    }

    // ── list ──
    if (sub === 'list') {
      const name = interaction.options.getString('name');

      if (!name) {
        const names = Object.keys(playlists);
        if (names.length === 0) return interaction.reply({ content: '📭 You have no playlists yet. Create one with `/playlist create`.', ephemeral: true });
        const lines = names.map(n => {
          const playlist = normalizePlaylist(playlists[n]);
          return `• **${n}** — ${playlist.tracks.length} track(s)`;
        });
        return interaction.reply(`🎧 **Your playlists:**\n${lines.join('\n')}`);
      }

      if (!playlists[name]) return interaction.reply({ content: `❌ Playlist **${name}** not found.`, ephemeral: true });

      const tracks = normalizePlaylist(playlists[name]).tracks;
      if (tracks.length === 0) return interaction.reply(`📭 **${name}** is empty.`);

      const lines = tracks.map((t, i) => `\`${i + 1}.\` ${t.title} — \`${fmt(t.duration)}\``);
      return interaction.reply(`🎧 **${name}** (${tracks.length} tracks):\n${lines.join('\n')}`.slice(0, 2000));
    }

    // ── play ──
    if (sub === 'play') {
      const name = interaction.options.getString('name');
      if (!playlists[name]) return interaction.reply({ content: `❌ Playlist **${name}** not found.`, ephemeral: true });

      const tracks = normalizePlaylist(playlists[name]).tracks;
      if (tracks.length === 0) return interaction.reply({ content: `📭 **${name}** is empty.`, ephemeral: true });

      // Use /play logic inline
      const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
      const GuildQueue = require('../GuildQueue');

      const voiceChannel = interaction.member.voice?.channel;
      if (!voiceChannel) return interaction.reply({ content: '❌ Join a voice channel first!', ephemeral: true });

      await interaction.deferReply();

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
        queue.connection.on(VoiceConnectionStatus.Destroyed, () => client.queues.delete(interaction.guildId));
      }

      for (const t of tracks) {
        queue.addTrack({ ...t, requestedBy: userId, lyrics: null });
      }

      const wasIdle = !queue.isPlaying() && !queue.isPaused();
      if (wasIdle) queue.playNext();

      return interaction.editReply(`🎧 Queued playlist **${name}** — **${tracks.length} tracks**`);
    }

    // ── delete ──
    if (sub === 'delete') {
      const name = interaction.options.getString('name');
      if (!playlists[name]) return interaction.reply({ content: `❌ Playlist **${name}** not found.`, ephemeral: true });
      delete playlists[name];
      saveUserPlaylists(client, userId, playlists);
      return interaction.reply(`🗑️ Deleted playlist **${name}**`);
    }

    // ── rename ──
    if (sub === 'rename') {
      const name = interaction.options.getString('name');
      const newName = interaction.options.getString('newname');
      if (!playlists[name]) return interaction.reply({ content: `❌ Playlist **${name}** not found.`, ephemeral: true });
      if (playlists[newName]) return interaction.reply({ content: `❌ **${newName}** already exists.`, ephemeral: true });
      playlists[newName] = playlists[name];
      delete playlists[name];
      saveUserPlaylists(client, userId, playlists);
      return interaction.reply(`✅ Renamed **${name}** → **${newName}**`);
    }
  },
};

function fmt(seconds) {
  if (!seconds) return 'Live';
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

module.exports = { playlist: playlistCmd };
