const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available commands'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🎵 Music Bot — Commands')
      .setColor(0x5865F2)
      .addFields(
        {
          name: '▶️ Playback',
          value: [
            '`/play <query>` — Play a YouTube URL or search',
            '`/stop` — Stop and clear the queue',
            '`/skip` — Skip the current track',
            '`/pause` — Pause playback',
            '`/resume` — Resume playback',
          ].join('\n'),
        },
        {
          name: '🎛️ Controls',
          value: [
            '`/volume <0-150>` — Set volume',
            '`/loop <off|track|queue>` — Set loop mode',
            '`/shuffle` — Shuffle the queue',
            '`/remove <position>` — Remove a track from queue',
          ].join('\n'),
        },
        {
          name: '📋 Queue & Info',
          value: [
            '`/queue [page]` — Show the queue',
            '`/nowplaying` — Show current track info',
            '`/lyrics [song] [artist]` — Fetch lyrics (also displays live in chat)',
            '`/lyrics mode:<on|off>` — Toggle live lyrics display',
          ].join('\n'),
        },
        {
          name: '🎧 Playlists',
          value: [
            '`/playlist create <name>` — Create a playlist',
            '`/playlist add <name> <url>` — Add a track',
            '`/playlist remove <name> <pos>` — Remove a track',
            '`/playlist list [name]` — List playlists or tracks',
            '`/playlist play <name>` — Queue a playlist',
            '`/playlist delete <name>` — Delete a playlist',
            '`/playlist rename <name> <newname>` — Rename',
          ].join('\n'),
        },
        {
          name: '🛡️ Admin',
          value: [
            '`/block add <url|name>` — Block a song by URL or title',
            '`/block remove <url|name>` — Unblock a song',
            '`/block list` — Show blocked songs',
          ].join('\n'),
        },
      )
      .setFooter({ text: 'Most bot replies are ephemeral (only visible to you). Lyrics and now-playing are visible to everyone.' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
