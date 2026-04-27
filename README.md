# 🎵 Discord Music Bot

A full-featured Discord music bot that plays YouTube audio in voice channels, with queue management, personal playlists, and live lyrics.

---

## ✨ Features

| Command | Description |
|---|---|
| `/play <url or search>` | Play a YouTube video, playlist, or search term |
| `/stop` | Stop music and clear the queue |
| `/skip` | Skip the current track |
| `/pause` / `/resume` | Pause and resume playback |
| `/queue` | Show the current queue (paginated) |
| `/nowplaying` | Show what's currently playing (ephemeral) |
| `/volume <0–150>` | Set volume |
| `/loop <off/track/queue>` | Set loop mode |
| `/shuffle` | Shuffle the queue |
| `/remove <position>` | Remove a track from the queue |
| `/lyrics [song] [artist]` | Fetch lyrics and enable live synced lyrics for current track |
| `/bio` | Show basic bot profile |
| `/setup show` | Show guild setup (admin role + test mode) |
| `/setup set ...` | Configure admin role, test mode, /play cooldown, max tracks, default volume, auto live lyrics |
| `/playlist create <name>` | Create a personal playlist |
| `/playlist add <name> <url>` | Add a song to a playlist |
| `/playlist remove <name> <position>` | Remove a song |
| `/playlist list [name]` | List playlists or tracks |
| `/playlist play <name>` | Queue an entire playlist |
| `/playlist delete <name>` | Delete a playlist |
| `/playlist rename <name> <newname>` | Rename a playlist |

---

## 🚀 Setup Guide

### 1. Prerequisites

- **Node.js 18+** — https://nodejs.org
- **ffmpeg** — https://ffmpeg.org/download.html  
  - Windows: `winget install ffmpeg` or download from gyan.dev
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`

### 2. Create a Discord Bot

1. Go to https://discord.com/developers/applications
2. Click **New Application** → give it a name
3. Go to **Bot** → click **Add Bot** → confirm
4. Under **Privileged Gateway Intents**, enable:
   - **Server Members Intent**
   - **Message Content Intent**
5. Copy the **Token** (you'll need it in step 4)
6. Go to **OAuth2 → General** → copy the **Client ID**

### 3. Invite the Bot to Your Server

Go to **OAuth2 → URL Generator**, select:
- Scopes: `bot`, `applications.commands`
- Bot Permissions: `Connect`, `Speak`, `Send Messages`, `Use Slash Commands`

Open the generated URL and add the bot to your server.

### 4. Configure Environment

Create a `.env` file in the project root and add:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id_here
GUILD_ID=your_server_id_here
DEBUG_LOGS=false
```

To get your Server ID (Guild ID): right-click your server icon → **Copy Server ID** (you need Developer Mode on in Discord settings).

### 5. Install Dependencies

```bash
npm install
```

### 6. Register Slash Commands

```bash
node deploy-commands.js
```

- With `GUILD_ID` set: commands appear **instantly** in that server
- Without `GUILD_ID`: global registration takes **up to 1 hour**

### 7. Start the Bot

```bash
node src/index.js
```

For production, use PM2:
```bash
npm install -g pm2
pm2 start src/index.js --name music-bot
pm2 save
```

---

## 🗂 Project Structure

```
discord-music-bot/
├── src/
│   ├── index.js          # Bot entry point
│   ├── GuildQueue.js     # Per-server queue & player
│   ├── resolver.js       # YouTube URL/search resolver
│   └── commands/
│       ├── play.js       # /play
│       ├── controls.js   # /stop /skip /pause /resume
│       ├── queue.js      # /queue
│       ├── extras.js     # /nowplaying /volume /loop /shuffle /remove
│       ├── playlist.js   # /playlist (all subcommands)
│       └── lyrics.js     # /lyrics
├── data/
│   └── playlists.json    # Auto-created — stores user playlists
├── deploy-commands.js    # One-time command registration
├── .env.example
└── package.json
```

---

## 🎛 Lyrics & channel behavior

- `/lyrics` now uses live lyrics mode directly (no dropdown).
- Live lyric timing prefers synced timestamps from `lrclib` when available.
- If synced timestamps are unavailable, fallback timing is distributed by track duration (better than fixed 3s line steps).
- Lyrics and now-playing embed are routed to the voice-related output channel (not command spam), while `/play` only confirms start in the command reply.
- Now-playing panel includes a **More features** menu (queue, shuffle, loop modes, live lyrics, stop) without premium-only features.

## 📘 Quick usage guide

1. Join a voice channel.
2. Run `/play query:<song or URL>`.
3. Run `/lyrics` for current song to fetch + sync live lyrics.
4. Use `/queue`, `/pause`, `/resume`, `/skip` for control.
5. Use `/nowplaying` when you want an on-demand status card visible only to you.

---

## 💡 Tips

- **Playlists are per-user** — each Discord user has their own playlists saved in `data/playlists.json`
- **Lyrics** are fetched from [lyrics.ovh](https://lyrics.ovh) and [lrclib.net](https://lrclib.net), with synced timing when available
- **Protected commands** (`/block`) can be limited to a role configured via `/setup set admin_role:<role>`
- **Test mode** can be toggled per server with `/setup set test_mode:true`
- **Rate limiting and UX tuning** can be configured per server:
  - `/setup set play_cooldown_sec:<0-30>`
  - `/setup set max_tracks_per_play:<1-100>`
  - `/setup set default_volume:<0-150>`
  - `/setup set auto_live_lyrics:<true|false>`
- **Loop modes**: `off` = play once, `track` = repeat current song, `queue` = repeat entire queue
- You can `/play` while something is already playing — it just adds to the queue
- YouTube playlists are supported — paste the playlist URL and all tracks are added

---

## 🌐 Render deployment notes

This version uses a `play-dl` resolver and does not require shipping a `yt-dlp` binary.

Recommended Render settings:

- Start command: `node src/index.js`
- Build command: `npm install`
- Environment variables:
  - `DISCORD_TOKEN`
  - `CLIENT_ID`
  - `GUILD_ID` (optional, for fast guild command updates)
  - `DEBUG_LOGS=true` (optional, enables verbose logs)
  - `LAVALINK_URL` (recommended, e.g. `http://your-lavalink-host:2333`)
  - `LAVALINK_PASSWORD` (recommended)
  - `PLAYDL_YOUTUBE_COOKIE_B64` (recommended for YouTube on cloud hosts)

If voice playback fails on Render, make sure your service can open UDP voice connections and your bot has `Connect` + `Speak` permissions in Discord.

### YouTube 429 mitigation for play-dl

Cloud IPs can get rate-limited by YouTube (`429`).  
This bot now supports passing YouTube cookies directly to `play-dl`.

Use one of these env vars:

- `PLAYDL_YOUTUBE_COOKIE` — cookie header string (`k1=v1; k2=v2; ...`)
- `PLAYDL_YOUTUBE_COOKIE_B64` — base64 of a Netscape `cookies.txt` file (recommended)

On startup, the bot also initializes a free SoundCloud client ID for search/stream fallback.

### Extra: yt-dlp/ytdl fallback + proxy

If your host blocks YouTube aggressively, you can optionally run with a `yt-dlp` fallback path and/or a proxy.

#### A) Add yt-dlp (optional fallback tooling)

1. Install `yt-dlp` on the server:
   - Windows: download `yt-dlp.exe` and place it in project root (or PATH)
   - Linux/macOS:
     - `python -m pip install -U yt-dlp`
     - or system package manager
2. Verify installation:
   - `yt-dlp --version`
3. If needed, expose path via env var:
   - `YTDLP_PATH=/absolute/path/to/yt-dlp`

> Note: This bot currently uses `play-dl` as the primary backend. `yt-dlp` is optional for advanced/fallback setups.

#### B) Add proxy for YouTube requests

Set one of these environment variables (depends on your host/provider):

- `HTTP_PROXY=http://user:pass@host:port`
- `HTTPS_PROXY=http://user:pass@host:port`
- `ALL_PROXY=socks5://user:pass@host:port`

Recommended:

- Keep proxy credentials in env vars only (never hardcode into source files)
- Use residential/static proxy for better YouTube stability
- Restart bot after env var changes

Quick check after deploy:

1. Start bot
2. Run `/play` with a known YouTube track
3. If 429 persists, add cookie env (`PLAYDL_YOUTUBE_COOKIE_B64`) + proxy together

---

## 🧰 Backend architecture

- **Resolver backend:** `play-dl` (`src/resolver.js`)
- **Stream backend:** `play-dl` stream source (`src/GuildQueue.js`)
- **Voice output:** `@discordjs/voice`
- **Provider strategy:** text search prefers SoundCloud first (YouTube fallback)
- **Rate-limit fallback:** when YouTube returns `429` on cloud hosts, playback automatically retries via SoundCloud search for the same track query
- **Custom YouTube watch-link handling:** `/play` now supports:
  - `watch?v=...&list=...` links by automatically resolving the `list` playlist ID
  - `watch?v=...` links without `list` as a "mix" (seed track + related tracks queue)

---

## 🙌 Credits

- Discord framework: [discord.js](https://github.com/discordjs/discord.js)
- Voice engine: [@discordjs/voice](https://github.com/discordjs/discord.js/tree/main/packages/voice)
- Media resolver/streaming: [play-dl](https://github.com/play-dl/play-dl)
- Lyrics API: [lyrics.ovh](https://lyrics.ovh)
