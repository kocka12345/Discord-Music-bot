const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bio')
    .setDescription('Show a short bot profile'),

  async execute(interaction, client) {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🤖 Bot Bio')
      .setDescription('Music bot for Discord with queue management, playlists, and live lyrics.')
      .addFields(
        { name: 'Features', value: 'Playback, pause/resume, queue, playlists, lyrics, admin song blocklist' },
        { name: 'Guild Queues', value: String(client.queues?.size || 0), inline: true },
        { name: 'Uptime', value: `${Math.floor(process.uptime() / 60)} min`, inline: true }
      )
      .setFooter({ text: 'discord-music-bot' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
