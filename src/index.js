require('dotenv').config();
const http = require('http');
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

http.createServer((req, res) => {
  if (req.url === '/health') {
    const ready = client.isReady();
    const payload = JSON.stringify({
      ok: ready,
      status: ready ? 'ready' : 'starting',
      uptimeSec: Math.floor(process.uptime()),
      queues: client.queues?.size || 0,
    });
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(payload);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Bot bezi!');
}).listen(process.env.PORT || 10000);

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
client.pendingLyricsSelections = new Map();

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
    if (err?.code === 10062 || err?.code === 40060) {
      log.warn('interaction', `Command interaction expired/already acknowledged (${err.code}) for /${interaction.commandName}`);
      return;
    }
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
    // Ignore noisy upstream provider throttling events.
    return;
  }
  log.error('process', 'unhandledRejection:', reason);
});

// ── Button: open playlist picker (add to playlist from now-playing message) ───
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith('npctl:')) {
    const queue = client.queues.get(interaction.guildId);
    if (!queue || !queue.currentTrack) {
      return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
    }

    const action = interaction.customId.slice('npctl:'.length);
    if (action === 'toggle_pause') {
      if (queue.isPaused()) {
        queue.resume();
        return interaction.reply({ content: '▶️ Resumed.', ephemeral: true });
      }
      if (queue.isPlaying()) {
        queue.pause();
        return interaction.reply({ content: '⏸️ Paused.', ephemeral: true });
      }
      return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
    }

    if (action === 'next') {
      const skipped = queue.currentTrack?.title || 'current track';
      queue.skip();
      return interaction.reply({ content: `⏭️ Skipped **${skipped}**`, ephemeral: true });
    }

    if (action === 'previous') {
      const ok = queue.playPrevious();
      if (!ok) {
        return interaction.reply({ content: '❌ No previous track in history yet.', ephemeral: true });
      }
      return interaction.reply({ content: '⏮️ Playing previous track.', ephemeral: true });
    }

    if (action === 'shuffle') {
      if (queue.tracks.length < 2) {
        return interaction.reply({ content: '❌ Not enough tracks to shuffle.', ephemeral: true });
      }
      queue.shuffleQueue();
      return interaction.reply({ content: `🔀 Queue shuffled! (${queue.tracks.length} tracks)`, ephemeral: true });
    }

    if (action === 'show_queue') {
      return interaction.reply({
        content: queue.buildQueuePreview(10),
        ephemeral: true,
      });
    }

    return;
  }

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
  if (interaction.customId.startsWith('lyrics_mode_select:')) {
    await interaction.deferUpdate();
    const token = interaction.customId.slice('lyrics_mode_select:'.length);
    const selected = interaction.values[0];
    const payload = client.pendingLyricsSelections?.get(token);

    if (!payload || payload.expiresAt < Date.now()) {
      if (payload) client.pendingLyricsSelections.delete(token);
      return interaction.editReply({
        content: '❌ Lyrics selection expired. Run `/lyrics` again.',
        components: [],
      });
    }
    if (payload.userId !== interaction.user.id) {
      return interaction.followUp({
        content: '❌ This selection menu is not for you.',
        ephemeral: true,
      });
    }

    const queue = client.queues.get(payload.guildId);
    const voiceChannel = interaction.member?.voice?.channel || null;
    const targetChannel = (
      voiceChannel &&
      typeof voiceChannel.isTextBased === 'function' &&
      voiceChannel.isTextBased() &&
      typeof voiceChannel.send === 'function'
    )
      ? voiceChannel
      : (queue?.textChannel || interaction.channel);

    const header = `📜 **${payload.songQuery}${payload.artistQuery ? ` — ${payload.artistQuery}` : ''}**\n\n`;
    const body = payload.plainLyrics.split('\n').map(l => l.trim()).join('\n');
    if ((header + body).length <= 2000) {
      await targetChannel.send(header + body);
    } else {
      await targetChannel.send(header + body.slice(0, 1900 - header.length) + '\n…*(lyrics truncated)*');
    }

    if (selected === 'live' && queue?.currentTrack) {
      queue.currentTrack.lyrics = payload.timedLyrics;
      queue._startLyricsDisplay(queue.getElapsedPlaybackSeconds());
      await interaction.editReply({ content: '✅ Live lyrics enabled and lyrics posted.', components: [] });
    } else {
      await interaction.editReply({ content: '✅ Lyrics posted (text only).', components: [] });
    }

    client.pendingLyricsSelections.delete(token);
    return;
  }

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