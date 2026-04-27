const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure this server (admin role + test mode)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s =>
      s.setName('show')
        .setDescription('Show current setup for this server')
    )
    .addSubcommand(s =>
      s.setName('set')
        .setDescription('Set admin role and server behavior')
        .addRoleOption(o =>
          o.setName('admin_role')
            .setDescription('Role allowed to use admin commands like /block')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('test_mode')
            .setDescription('Enable test mode in this server')
            .setRequired(false)
        )
        .addIntegerOption(o =>
          o.setName('play_cooldown_sec')
            .setDescription('Cooldown for /play per user (0-30 sec)')
            .setMinValue(0)
            .setMaxValue(30)
            .setRequired(false)
        )
        .addIntegerOption(o =>
          o.setName('max_tracks_per_play')
            .setDescription('Max tracks accepted from one /play call (1-100)')
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(false)
        )
        .addIntegerOption(o =>
          o.setName('default_volume')
            .setDescription('Default volume for new queue (0-150)')
            .setMinValue(0)
            .setMaxValue(150)
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('auto_live_lyrics')
            .setDescription('Start live lyrics automatically when available')
            .setRequired(false)
        )
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    if (!guildId) return interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });

    if (sub === 'show') {
      const settings = getGuildSettings(client, guildId);
      const roleText = settings.adminRoleId ? `<@&${settings.adminRoleId}>` : 'Not set';
      return interaction.reply({
        content: [
          '⚙️ **Server setup**',
          `- Admin role for protected commands: ${roleText}`,
          `- Test mode: **${settings.testMode ? 'ON' : 'OFF'}**`,
          `- /play cooldown: **${settings.playCooldownSec}s**`,
          `- Max tracks per /play: **${settings.maxTracksPerPlay}**`,
          `- Default volume: **${settings.defaultVolume}%**`,
          `- Auto live lyrics: **${settings.autoLiveLyrics ? 'ON' : 'OFF'}**`,
          '',
          'Use `/setup set` to update.',
        ].join('\n'),
        ephemeral: true,
      });
    }

    const adminRole = interaction.options.getRole('admin_role');
    const testMode = interaction.options.getBoolean('test_mode');
    const playCooldownSec = interaction.options.getInteger('play_cooldown_sec');
    const maxTracksPerPlay = interaction.options.getInteger('max_tracks_per_play');
    const defaultVolume = interaction.options.getInteger('default_volume');
    const autoLiveLyrics = interaction.options.getBoolean('auto_live_lyrics');

    if (
      !adminRole &&
      testMode === null &&
      playCooldownSec === null &&
      maxTracksPerPlay === null &&
      defaultVolume === null &&
      autoLiveLyrics === null
    ) {
      return interaction.reply({
        content: '❌ Provide at least one option to update.',
        ephemeral: true,
      });
    }

    const patch = {};
    if (adminRole) patch.adminRoleId = adminRole.id;
    if (testMode !== null) patch.testMode = testMode;
    if (playCooldownSec !== null) patch.playCooldownSec = playCooldownSec;
    if (maxTracksPerPlay !== null) patch.maxTracksPerPlay = maxTracksPerPlay;
    if (defaultVolume !== null) patch.defaultVolume = defaultVolume;
    if (autoLiveLyrics !== null) patch.autoLiveLyrics = autoLiveLyrics;
    const saved = setGuildSettings(client, guildId, patch);

    return interaction.reply({
      content: [
        '✅ Setup updated',
        `- Admin role: ${saved.adminRoleId ? `<@&${saved.adminRoleId}>` : 'Not set'}`,
        `- Test mode: **${saved.testMode ? 'ON' : 'OFF'}**`,
        `- /play cooldown: **${saved.playCooldownSec}s**`,
        `- Max tracks per /play: **${saved.maxTracksPerPlay}**`,
        `- Default volume: **${saved.defaultVolume}%**`,
        `- Auto live lyrics: **${saved.autoLiveLyrics ? 'ON' : 'OFF'}**`,
      ].join('\n'),
      ephemeral: true,
    });
  },
};
