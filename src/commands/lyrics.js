const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Fetch lyrics, or toggle live lyrics on/off')
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

    let lyrics = null;

    // API 1: lyrics.ovh
    try {
      const artist = encodeURIComponent(artistQuery || 'unknown');
      const song = encodeURIComponent(songQuery);
      const res = await fetch(`https://api.lyrics.ovh/v1/${artist}/${song}`);
      const data = await res.json();
      if (data.lyrics && data.lyrics.trim().length > 20) {
        lyrics = data.lyrics;
        console.log('[lyrics] Found via lyrics.ovh');
      }
    } catch (e) {
      console.log('[lyrics] lyrics.ovh failed:', e.message);
    }

    // API 2: lrclib.net
    if (!lyrics) {
      try {
        const params = new URLSearchParams({ q: `${artistQuery || ''} ${songQuery}`.trim() });
        const res = await fetch(`https://lrclib.net/api/search?${params}`);
        const results = await res.json();
        if (results?.length > 0) {
          const best = results[0];
          lyrics = best.plainLyrics || best.syncedLyrics?.replace(/\[\d+:\d+\.\d+\]\s*/g, '') || null;
          console.log('[lyrics] Found via lrclib.net:', best.trackName);
        }
      } catch (e) {
        console.log('[lyrics] lrclib failed:', e.message);
      }
    }

    if (!lyrics) {
      return interaction.editReply(
        `❌ No lyrics found for **${songQuery}**${artistQuery ? ` by **${artistQuery}**` : ''}.\n` +
        `Try using \`/lyrics song:Song Name artist:Artist Name\` with the exact names.`
      );
    }

    // Store timed lyrics on current track for live display in voice channel chat
    const lines = lyrics.split('\n').map(l => l.trim());

    if (queue?.currentTrack) {
      let t = 0;
      queue.currentTrack.lyrics = lines.map(line => {
        const entry = { text: line, time: t };
        if (line.trim()) t += 3;
        return entry;
      });
      // If lyrics are loaded mid-track, align display with current playback progress.
      queue._startLyricsDisplay(queue.getElapsedPlaybackSeconds());
    }

    // Send full lyrics publicly to the channel so everyone can see
    const header = `📜 **${songQuery}${artistQuery ? ` — ${artistQuery}` : ''}**\n\n`;
    const body = lines.join('\n');
    const full = header + body;

    // Post publicly (not ephemeral) to the text channel associated with the queue
    const textChannel = queue?.textChannel || interaction.channel;
    if (full.length <= 2000) {
      await textChannel.send(full);
    } else {
      await textChannel.send(header + body.slice(0, 1900 - header.length) + '\n…*(lyrics truncated)*');
    }

    // Confirm to the user who ran the command (ephemeral)
    await interaction.editReply(`✅ Lyrics posted${queue?.currentTrack ? ' + live display activated!' : '.'}`);
  },
};