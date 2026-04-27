const { SlashCommandBuilder } = require('discord.js');

const stopCmd = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback and clear the queue'),

  async execute(interaction, client) {
    const queue = client.queues.get(interaction.guildId);
    if (!queue) return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });

    queue.destroy();
    client.queues.delete(interaction.guildId);
    await interaction.reply({ content: '⏹️ Stopped and cleared the queue. Goodbye! 👋', ephemeral: true });
  },
};

const skipCmd = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current track'),

  async execute(interaction, client) {
    const queue = client.queues.get(interaction.guildId);
    if (!queue || !queue.currentTrack) {
      return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
    }
    const skipped = queue.currentTrack.title;
    queue.skip();
    await interaction.reply({ content: `⏭️ Skipped **${skipped}**`, ephemeral: true });
  },
};

const pauseCmd = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current track'),

  async execute(interaction, client) {
    const queue = client.queues.get(interaction.guildId);
    if (!queue || !queue.currentTrack) {
      return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
    }
    if (queue.isPaused()) {
      return interaction.reply({ content: '❌ Track is already paused.', ephemeral: true });
    }
    queue.pause();
    await interaction.reply({ content: '⏸️ Paused.', ephemeral: true });
  },
};

const resumeCmd = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume the paused track'),

  async execute(interaction, client) {
    const queue = client.queues.get(interaction.guildId);
    if (!queue || !queue.currentTrack) {
      return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
    }
    if (!queue.isPaused()) {
      return interaction.reply({ content: '❌ Nothing is paused.', ephemeral: true });
    }
    queue.resume();
    await interaction.reply({ content: '▶️ Resumed.', ephemeral: true });
  },
};

module.exports = { stop: stopCmd, skip: skipCmd, pause: pauseCmd, resume: resumeCmd };