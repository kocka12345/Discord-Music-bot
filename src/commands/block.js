const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

function getBlockedFile(client) {
  return path.join(path.dirname(client.playlistFile), 'blocked.json');
}

function loadBlocked(client) {
  try {
    return JSON.parse(fs.readFileSync(getBlockedFile(client), 'utf8'));
  } catch {
    return { urls: [], names: [] };
  }
}

function saveBlocked(client, data) {
  fs.writeFileSync(getBlockedFile(client), JSON.stringify(data, null, 2));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('block')
    .setDescription('Block/unblock songs (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s =>
      s.setName('add')
        .setDescription('Block a song by URL or title keyword')
        .addStringOption(o =>
          o.setName('value').setDescription('URL or title keyword to block').setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('remove')
        .setDescription('Unblock a song')
        .addStringOption(o =>
          o.setName('value').setDescription('URL or title keyword to unblock').setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('list')
        .setDescription('Show all blocked songs')
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const blocked = loadBlocked(client);

    if (sub === 'add') {
      const value = interaction.options.getString('value').trim();
      const isUrl = value.startsWith('http://') || value.startsWith('https://');
      const list = isUrl ? 'urls' : 'names';

      if (blocked[list].includes(value)) {
        return interaction.reply({ content: `⚠️ Already blocked: **${value}**`, ephemeral: true });
      }
      blocked[list].push(value);
      saveBlocked(client, blocked);
      return interaction.reply({ content: `🔒 Blocked ${isUrl ? 'URL' : 'title keyword'}: **${value}**`, ephemeral: true });
    }

    if (sub === 'remove') {
      const value = interaction.options.getString('value').trim();
      const isUrl = value.startsWith('http://') || value.startsWith('https://');
      const list = isUrl ? 'urls' : 'names';

      const idx = blocked[list].indexOf(value);
      if (idx === -1) {
        return interaction.reply({ content: `❌ Not found in block list: **${value}**`, ephemeral: true });
      }
      blocked[list].splice(idx, 1);
      saveBlocked(client, blocked);
      return interaction.reply({ content: `✅ Unblocked: **${value}**`, ephemeral: true });
    }

    if (sub === 'list') {
      const lines = [];
      if (blocked.urls.length) {
        lines.push('**Blocked URLs:**');
        blocked.urls.forEach(u => lines.push(`  • \`${u}\``));
      }
      if (blocked.names.length) {
        lines.push('**Blocked title keywords:**');
        blocked.names.forEach(n => lines.push(`  • ${n}`));
      }
      if (!lines.length) {
        return interaction.reply({ content: '✅ No songs are currently blocked.', ephemeral: true });
      }
      return interaction.reply({ content: lines.join('\n').slice(0, 2000), ephemeral: true });
    }
  },
};
