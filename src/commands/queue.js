const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current queue')
    .addIntegerOption(o =>
      o.setName('page').setDescription('Page number').setMinValue(1)
    ),

  async execute(interaction, client) {
    const queue = client.queues.get(interaction.guildId);

    if (!queue || (!queue.currentTrack && queue.tracks.length === 0)) {
      return interaction.reply({ content: '📭 Queue is empty.', ephemeral: true });
    }

    const PAGE_SIZE = 10;
    const page = (interaction.options.getInteger('page') || 1) - 1;
    const totalPages = Math.ceil(queue.tracks.length / PAGE_SIZE) || 1;

    const lines = [];

    if (queue.currentTrack) {
      lines.push(`▶️  **Now Playing:**`);
      lines.push(`   ${queue.currentTrack.title} — \`${fmt(queue.currentTrack.duration)}\``);
      lines.push('');
    }

    if (queue.tracks.length === 0) {
      lines.push('*No tracks in queue.*');
    } else {
      lines.push(`**Queue** (${queue.tracks.length} track${queue.tracks.length !== 1 ? 's' : ''}):`);
      const slice = queue.tracks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      slice.forEach((t, i) => {
        lines.push(`\`${page * PAGE_SIZE + i + 1}.\` ${t.title} — \`${fmt(t.duration)}\``);
      });

      if (totalPages > 1) {
        lines.push(`\nPage ${page + 1}/${totalPages}  •  Use \`/queue page:N\` to navigate`);
      }
    }

    const loopLabel = queue.loopMode !== 'none' ? `🔁 Loop: **${queue.loopMode}**` : '';
    if (loopLabel) lines.push(loopLabel);

    await interaction.reply({ content: lines.join('\n').slice(0, 2000), ephemeral: true });
  },
};

function fmt(seconds) {
  if (!seconds) return 'Live';
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}