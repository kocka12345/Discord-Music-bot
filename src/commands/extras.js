const { SlashCommandBuilder } = require('discord.js');

const nowplayingCmd = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show info about the current track'),

  async execute(interaction, client) {
    const queue = client.queues.get(interaction.guildId);
    if (!queue?.currentTrack) {
      return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
    }

    const t = queue.currentTrack;
    const status = queue.isPlaying() ? '▶️ Playing' : '⏸️ Paused';
    const lines = [
      `${status} — **${t.title}**`,
      `👤 ${t.author}  •  ⏱️ ${fmt(t.duration)}`,
      t.requestedBy ? `Requested by <@${t.requestedBy}>` : '',
      `🔗 ${t.url}`,
    ].filter(Boolean);

    // Now Playing is public (not ephemeral), everyone should see it
    await interaction.reply(lines.join('\n'));
  },
};

const volumeCmd = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set the playback volume (0–150)')
    .addIntegerOption(o =>
      o.setName('level')
        .setDescription('Volume level (0–150, default 50)')
        .setMinValue(0)
        .setMaxValue(150)
        .setRequired(true)
    ),

  async execute(interaction, client) {
    const queue = client.queues.get(interaction.guildId);
    if (!queue) return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });

    const level = interaction.options.getInteger('level');
    queue.setVolume(level);
    await interaction.reply({ content: `🔊 Volume set to **${level}%**`, ephemeral: true });
  },
};

const loopCmd = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set loop mode')
    .addStringOption(o =>
      o.setName('mode')
        .setDescription('Loop mode')
        .setRequired(true)
        .addChoices(
          { name: 'Off', value: 'none' },
          { name: 'Current track', value: 'track' },
          { name: 'Entire queue', value: 'queue' },
        )
    ),

  async execute(interaction, client) {
    const queue = client.queues.get(interaction.guildId);
    if (!queue) return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });

    const mode = interaction.options.getString('mode');
    queue.loopMode = mode;
    const labels = { none: 'Off', track: 'Current track 🔂', queue: 'Entire queue 🔁' };
    await interaction.reply({ content: `🔁 Loop mode: **${labels[mode]}**`, ephemeral: true });
  },
};

const shuffleCmd = {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the queue'),

  async execute(interaction, client) {
    const queue = client.queues.get(interaction.guildId);
    if (!queue || queue.tracks.length < 2) {
      return interaction.reply({ content: '❌ Not enough tracks to shuffle.', ephemeral: true });
    }
    queue.shuffleQueue();
    await interaction.reply({ content: `🔀 Queue shuffled! (${queue.tracks.length} tracks)`, ephemeral: true });
  },
};

const removeCmd = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a track from the queue by position')
    .addIntegerOption(o =>
      o.setName('position').setDescription('Queue position (1 = next)').setMinValue(1).setRequired(true)
    ),

  async execute(interaction, client) {
    const queue = client.queues.get(interaction.guildId);
    if (!queue || queue.tracks.length === 0) {
      return interaction.reply({ content: '❌ Queue is empty.', ephemeral: true });
    }
    const pos = interaction.options.getInteger('position') - 1;
    const removed = queue.removeTrack(pos);
    if (!removed) return interaction.reply({ content: '❌ Invalid position.', ephemeral: true });
    await interaction.reply({ content: `🗑️ Removed **${removed.title}** from queue.`, ephemeral: true });
  },
};

function fmt(seconds) {
  if (!seconds) return 'Live';
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

module.exports = { nowplaying: nowplayingCmd, volume: volumeCmd, loop: loopCmd, shuffle: shuffleCmd, remove: removeCmd };