const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

const LYRICS_SELECTION_TTL_MS = 5 * 60 * 1000;

function parseSyncedLyrics(syncedLyrics) {
  if (!syncedLyrics) return [];
  const lines = syncedLyrics.split('\n');
  const parsed = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/);
    if (!match) continue;
    const min = Number(match[1] || 0);
    const sec = Number(match[2] || 0);
    const ms = Number((match[3] || '0').padEnd(3, '0').slice(0, 3));
    const text = (match[4] || '').trim();
    if (!text) continue;
    parsed.push({ time: (min * 60) + sec + (ms / 1000), text });
  }
  return parsed;
}

function buildFallbackTimedLyrics(plainLyrics, trackDurationSec = 0) {
  const lines = plainLyrics.split('\n').map(l => l.trim());
  const nonEmptyCount = lines.filter(Boolean).length;
  const step = (trackDurationSec > 0 && nonEmptyCount > 0)
    ? Math.max(1.2, trackDurationSec / Math.max(1, nonEmptyCount))
    : 3;
  let t = 0;
  return lines.map(line => {
    const entry = { text: line, time: t };
    if (line) t += step;
    return entry;
  });
}

function resolveLyricsPostChannel(interaction, queue) {
  const forcedLyricsChannel = interaction.member?.voice?.channel || null;
  return (
    forcedLyricsChannel &&
    typeof forcedLyricsChannel.isTextBased === 'function' &&
    forcedLyricsChannel.isTextBased() &&
    typeof forcedLyricsChannel.send === 'function'
  )
    ? forcedLyricsChannel
    : (queue?.textChannel || interaction.channel);
}

async function sendFullLyricsToChannel(channel, songQuery, artistQuery, plainLyrics) {
  const lines = plainLyrics.split('\n').map(l => l.trim());
  const header = `📜 **${songQuery}${artistQuery ? ` — ${artistQuery}` : ''}**\n\n`;
  const body = lines.join('\n');
  const full = header + body;
  if (full.length <= 2000) {
    await channel.send(full);
  } else {
    await channel.send(header + body.slice(0, 1900 - header.length) + '\n…*(lyrics truncated)*');
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Fetch lyrics for current song or custom song')
    .addStringOption(o =>
      o.setName('mode')
        .setDescription('Turn live lyrics on or off')
        .addChoices(
          { name: 'On', value: 'on' },
          { name: 'Off', value: 'off' }
        )
    )
    .addStringOption(o =>
      o.setName('song').setDescription('Song name (leave blank to use current track)')
    )
    .addStringOption(o =>
      o.setName('artist').setDescription('Artist name')
    ),

  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const queue = client.queues.get(interaction.guildId);
    const mode = interaction.options.getString('mode');
    if (mode) {
      if (!queue) return interaction.editReply('❌ Nothing is playing.');
      queue.setLyricsEnabled(mode === 'on');
      return interaction.editReply(`✅ Live lyrics are now **${mode === 'on' ? 'ON' : 'OFF'}**.`);
    }

    let songQuery = interaction.options.getString('song');
    let artistQuery = interaction.options.getString('artist');

    // Auto-detect from current track
    if (!songQuery && queue?.currentTrack) {
      const title = queue.currentTrack.title
        .replace(/\(.*?\)|\[.*?\]/g, '')
        .replace(/ft\..*/i, '')
        .trim();

      const parts = title.split(/[-–|]/).map(p => p.trim());
      if (parts.length >= 2) {
        artistQuery = artistQuery || parts[0];
        songQuery = parts[1];
      } else {
        songQuery = parts[0];
        artistQuery = artistQuery || queue.currentTrack.author;
      }
    }

    if (!songQuery) {
      return interaction.editReply('❌ Provide a song name or play something first.');
    }

    // Clean up artist (remove "- Topic" suffix common on YouTube)
    if (artistQuery) {
      artistQuery = artistQuery.replace(/\s*-\s*topic$/i, '').trim();
    }

    console.log(`[lyrics] Searching: "${songQuery}" by "${artistQuery}"`);

    let plainLyrics = null;
    let timedLyrics = [];

    // API 1: lyrics.ovh
    try {
      const artist = encodeURIComponent(artistQuery || 'unknown');
      const song = encodeURIComponent(songQuery);
      const res = await fetch(`https://api.lyrics.ovh/v1/${artist}/${song}`);
      const data = await res.json();
      if (data.lyrics && data.lyrics.trim().length > 20) {
        plainLyrics = data.lyrics;
        console.log('[lyrics] Found via lyrics.ovh');
      }
    } catch (e) {
      console.log('[lyrics] lyrics.ovh failed:', e.message);
    }

    // API 2: lrclib.net
    if (!plainLyrics) {
      try {
        const params = new URLSearchParams({ q: `${artistQuery || ''} ${songQuery}`.trim() });
        const res = await fetch(`https://lrclib.net/api/search?${params}`);
        const results = await res.json();
        if (results?.length > 0) {
          const best = results[0];
          timedLyrics = parseSyncedLyrics(best.syncedLyrics || '');
          plainLyrics = best.plainLyrics
            || best.syncedLyrics?.replace(/\[\d+:\d+(?:\.\d+)?\]\s*/g, '')
            || null;
          console.log('[lyrics] Found via lrclib.net:', best.trackName);
        }
      } catch (e) {
        console.log('[lyrics] lrclib failed:', e.message);
      }
    }

    if (!plainLyrics) {
      return interaction.editReply(
        `❌ No lyrics found for **${songQuery}**${artistQuery ? ` by **${artistQuery}**` : ''}.\n` +
        `Try using \`/lyrics song:Song Name artist:Artist Name\` with the exact names.`
      );
    }

    const timed = timedLyrics.length
      ? timedLyrics
      : buildFallbackTimedLyrics(plainLyrics, queue?.currentTrack?.duration || 0);
    const textChannel = resolveLyricsPostChannel(interaction, queue);
    const hasCurrentTrack = Boolean(queue?.currentTrack);

    if (hasCurrentTrack && !interaction.options.getString('song') && !interaction.options.getString('artist')) {
      client.pendingLyricsSelections = client.pendingLyricsSelections || new Map();
      const token = `${interaction.guildId}:${interaction.user.id}:${Date.now()}`;
      client.pendingLyricsSelections.set(token, {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        songQuery,
        artistQuery,
        plainLyrics,
        timedLyrics: timed,
        expiresAt: Date.now() + LYRICS_SELECTION_TTL_MS,
      });

      const select = new StringSelectMenuBuilder()
        .setCustomId(`lyrics_mode_select:${token}`)
        .setPlaceholder('How should I send lyrics?')
        .addOptions(
          { label: 'Live lyrics + full text', value: 'live' },
          { label: 'Only full lyrics text', value: 'text' }
        );

      const row = new ActionRowBuilder().addComponents(select);
      return interaction.editReply({
        content: 'Choose lyrics mode for the currently playing track:',
        components: [row],
      });
    }

    if (queue?.currentTrack) {
      queue.currentTrack.lyrics = timed;
      queue._startLyricsDisplay(queue.getElapsedPlaybackSeconds());
    }
    await sendFullLyricsToChannel(textChannel, songQuery, artistQuery, plainLyrics);
    await interaction.editReply(`✅ Lyrics posted${queue?.currentTrack ? ' + live display activated!' : '.'}`);
  },
};