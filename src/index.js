require('dotenv').config();
const http = require('http');
http.createServer((req, res) => {
  res.write('Bot bezi!');
  res.end();
}).listen(process.env.PORT || 10000);
const {
  Client,
  GatewayIntentBits,
  Collection,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { resolve } = require('./resolver');
const log = require('./logger');
const { initPlayDlAuth } = require('./playDlAuth');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

initPlayDlAuth().catch(err => {
  log.warn('play-dl-auth', `Initialization finished with warning: ${err.message}`);
});

// ── Load commands ────────────────────────────────────────────────────────────
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const mod = require(path.join(commandsPath, file));
  if (mod.data && mod.execute) { client.commands.set(mod.data.name, mod); continue; }
  for (const [, cmd] of Object.entries(mod)) {
    if (cmd?.data && cmd?.execute) client.commands.set(cmd.data.name, cmd);
  }
}

client.queues = new Map();

// ── Playlist file ─────────────────────────────────────────────────────────────
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const playlistFile = path.join(dataDir, 'playlists.json');
if (!fs.existsSync(playlistFile)) fs.writeFileSync(playlistFile, '{}');
client.playlistFile = playlistFile;

// ── Blocked songs file ────────────────────────────────────────────────────────
const blockedFile = path.join(dataDir, 'blocked.json');
if (!fs.existsSync(blockedFile)) fs.writeFileSync(blockedFile, '{"urls":[],"names":[]}');

function loadBlocked() {
  try { return JSON.parse(fs.readFileSync(blockedFile, 'utf8')); } catch { return { urls: [], names: [] }; }
}
// Reload blocked list into memory on every interaction (cheap file read)
function refreshBlocked() { client.blocked = loadBlocked(); }
refreshBlocked();

// ── Playlist helpers ──────────────────────────────────────────────────────────
function loadPlaylists() {
  try { return JSON.parse(fs.readFileSync(playlistFile, 'utf8')); } catch { return {}; }
}
function savePlaylists(data) {
  fs.writeFileSync(playlistFile, JSON.stringify(data, null, 2));
}
function ensureUserPlaylists(all, userId) {
  if (!all[userId]) all[userId] = {};
  return all[userId];
}
function normalizePlaylist(pl) {
  if (Array.isArray(pl)) return { public: false, tracks: pl };
  return pl;
}

async function safeInteractionErrorReply(interaction) {
  const msg = { content: 'Something went wrong.', ephemeral: true };
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  } catch (replyErr) {
    // 10062 = Unknown interaction (expired/invalid token)
    // 40060 = Interaction already acknowledged
    if (replyErr?.code === 10062 || replyErr?.code === 40060) {
      log.warn('interaction', 'Could not send error reply:', replyErr.code);
      return;
    }
    log.error('interaction', 'Error reply failed:', replyErr);
  }
}

client.once('clientReady', () => {
  log.info('startup', `Logged in as ${client.user.tag}`);
  log.info('startup', `DEBUG_LOGS=${String(process.env.DEBUG_LOGS || 'false')}`);
});

// ── Slash commands ─────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  log.debug('interaction', `/${interaction.commandName} by ${interaction.user?.id} in guild ${interaction.guildId}`);

  refreshBlocked(); // keep blocked list fresh

  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction, client);
  } catch (err) {
    log.error('command', `Error in /${interaction.commandName}:`, err);
    await safeInteractionErrorReply(interaction);
  }
});

client.on('error', err => {
  log.error('client', err);
});

process.on('unhandledRejection', reason => {
  const message = String(reason?.message || reason || '');
  if (message.includes('Got 429 from the request')) {
    log.warn('process', 'play-dl received a 429 rate-limit from provider.');
    return;
  }
  log.error('process', 'unhandledRejection:', reason);
});

// ── Button: open playlist picker (add to playlist from now-playing message) ───
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  // ── "Add to playlist" button on now-playing message ──
  if (interaction.customId.startsWith('add_to_playlist:')) {
    await interaction.deferReply({ ephemeral: true });

    const trackUrl = interaction.customId.slice('add_to_playlist:'.length);
    const userId = interaction.user.id;

    const all = loadPlaylists();
    const playlists = ensureUserPlaylists(all, userId);
    savePlaylists(all);
    const playlistEntries = Object.entries(playlists);

    if (playlistEntries.length === 0) {
      await interaction.editReply({
        content: 'You have no playlists yet. Create one with `/playlist create` first.',
        components: [],
      });
      return;
    }

    const options = playlistEntries.map(([n, pl]) => {
      const norm = normalizePlaylist(pl);
      return {
        label: n,
        description: `${norm.tracks.length} tracks · ${norm.public ? 'Public' : 'Private'}`,
        value: n,
      };
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId(`playlist_select:${trackUrl}`)
      .setPlaceholder('Choose a playlist...')
      .addOptions(options);

    await interaction.editReply({
      content: 'Which playlist do you want to add this track to?',
      components: [new ActionRowBuilder().addComponents(select)],
    });
    return;
  }

  // ── Playlist settings: toggle visibility ──
  if (interaction.customId.startsWith('pl_settings_vis:')) {
    const [, userId, ...nameParts] = interaction.customId.split(':');
    const name = nameParts.join(':');

    if (interaction.user.id !== userId) {
      return interaction.reply({ content: '❌ This is not your playlist.', ephemeral: true });
    }

    const all = loadPlaylists();
    if (!all[userId]?.[name]) return interaction.reply({ content: '❌ Playlist not found.', ephemeral: true });

    const pl = normalizePlaylist(all[userId][name]);
    pl.public = !pl.public;
    all[userId][name] = pl;
    savePlaylists(all);

    await interaction.update({
      content: [
        `⚙️ **Settings for playlist: ${name}**`,
        `📊 Tracks: **${pl.tracks.length}**`,
        `👁️ Visibility: **${pl.public ? 'Public 🌍' : 'Private 🔒'}** *(updated)*`,
        '',
        'Use the buttons below to make changes:',
      ].join('\n'),
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`pl_settings_rename:${userId}:${name}`)
          .setLabel('✏️ Rename')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`pl_settings_vis:${userId}:${name}`)
          .setLabel(pl.public ? '🔒 Make Private' : '🌍 Make Public')
          .setStyle(pl.public ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`pl_settings_delete:${userId}:${name}`)
          .setLabel('🗑️ Delete Playlist')
          .setStyle(ButtonStyle.Danger),
      )],
    });
    return;
  }

  // ── Playlist settings: rename (opens modal) ──
  if (interaction.customId.startsWith('pl_settings_rename:')) {
    const [, userId, ...nameParts] = interaction.customId.split(':');
    const name = nameParts.join(':');

    if (interaction.user.id !== userId) {
      return interaction.reply({ content: '❌ This is not your playlist.', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId(`pl_rename_modal:${userId}:${name}`)
      .setTitle(`Rename playlist "${name}"`);

    const nameInput = new TextInputBuilder()
      .setCustomId('new_name')
      .setLabel('New name')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(64)
      .setPlaceholder(name);

    modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
    await interaction.showModal(modal);
    return;
  }

  // ── Playlist settings: delete ──
  if (interaction.customId.startsWith('pl_settings_delete:')) {
    const [, userId, ...nameParts] = interaction.customId.split(':');
    const name = nameParts.join(':');

    if (interaction.user.id !== userId) {
      return interaction.reply({ content: '❌ This is not your playlist.', ephemeral: true });
    }

    const all = loadPlaylists();
    if (!all[userId]?.[name]) return interaction.reply({ content: '❌ Playlist not found.', ephemeral: true });

    delete all[userId][name];
    savePlaylists(all);

    await interaction.update({
      content: `🗑️ Playlist **${name}** has been deleted.`,
      components: [],
    });
    return;
  }
});

// ── Modal submit: rename playlist ─────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return;

  if (interaction.customId.startsWith('pl_rename_modal:')) {
    const [, userId, ...nameParts] = interaction.customId.split(':');
    const oldName = nameParts.join(':');
    const newName = interaction.fields.getTextInputValue('new_name').trim();

    if (interaction.user.id !== userId) {
      return interaction.reply({ content: '❌ This is not your playlist.', ephemeral: true });
    }

    const all = loadPlaylists();
    if (!all[userId]?.[oldName]) {
      return interaction.reply({ content: '❌ Playlist not found.', ephemeral: true });
    }
    if (all[userId][newName]) {
      return interaction.reply({ content: `❌ A playlist named **${newName}** already exists.`, ephemeral: true });
    }

    all[userId][newName] = all[userId][oldName];
    delete all[userId][oldName];
    savePlaylists(all);

    await interaction.reply({
      content: `✅ Renamed **${oldName}** → **${newName}**`,
      ephemeral: true,
    });
  }
});

// ── Select menu: add track to chosen playlist ──────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction.customId.startsWith('playlist_select:')) return;

  await interaction.deferUpdate();

  const trackUrl = interaction.customId.slice('playlist_select:'.length);
  const playlistName = interaction.values[0];
  const userId = interaction.user.id;

  const all = loadPlaylists();
  const playlists = ensureUserPlaylists(all, userId);

  if (!playlists[playlistName]) {
    return interaction.editReply({ content: `Playlist **${playlistName}** not found.`, components: [] });
  }

  let tracks;
  try {
    tracks = await resolve(trackUrl, userId);
  } catch (err) {
    const queue = client.queues.get(interaction.guildId);
    const now = queue?.currentTrack;
    if (now && (now.url === trackUrl || now.streamUrl === trackUrl)) {
      tracks = [{
        title: now.title || 'Unknown Title',
        url: now.url || trackUrl,
        author: now.author || 'Unknown Artist',
        duration: now.duration || 0,
        requestedBy: userId,
        lyrics: null,
      }];
    } else {
      return interaction.editReply({ content: `Could not resolve track: ${err.message}`, components: [] });
    }
  }

  const norm = normalizePlaylist(playlists[playlistName]);
  norm.tracks.push(...tracks.map(t => ({ title: t.title, url: t.url, author: t.author, duration: t.duration })));
  playlists[playlistName] = norm;
  all[userId] = playlists;
  savePlaylists(all);

  const added = tracks.length === 1 ? `**${tracks[0].title}**` : `**${tracks.length} tracks**`;
  await interaction.editReply({ content: `Added ${added} to **${playlistName}**!`, components: [] });
});

client.login(process.env.DISCORD_TOKEN);