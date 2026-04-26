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
| `/nowplaying` | Show what's currently playing |
| `/volume <0–150>` | Set volume |
| `/loop <off/track/queue>` | Set loop mode |
| `/shuffle` | Shuffle the queue |
| `/remove <position>` | Remove a track from the queue |
| `/lyrics [song] [artist]` | Fetch lyrics + live chat display |
| `/playlist create <name>` | Create a personal playlist |
| `/playlist add <name> <url>` | Add a song to a playlist |
| `/playlist remove <name> <position>` | Remove a song |
| `/playlist list [name]` | List playlists or tracks |
| `/playlist play <name>` | Queue an entire playlist |
| `/playlist delete <name>` | Delete a playlist |
| `/playlist rename <name> <newname>` | Rename a playlist |

---

## 🔥Extras
If you have your own server or have some money to spare(to buy an proxy if you are using free hosting), you can use [node-ytdl-core](https://github.com/fent/node-ytdl-core) 
With that, you can directly input youtube links and use the youtube videos and not the audio from Sound Cloud.
I will add guid for this later


## 🚀 Setup Guide

### 1. Prerequisites

- **Node.js 18+** — https://nodejs.org
- **ffmpeg** — https://ffmpeg.org/download.html  
  - Windows: `winget install ffmpeg` or download from gyan.dev
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`
  - Note: Recommend using Render for hosting

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

## 💡 Tips

- **Playlists are per-user** — each Discord user has their own playlists saved in `data/playlists.json`
- **Lyrics** are fetched from the free [lyrics.ovh](https://lyrics.ovh) API and optionally displayed line-by-line in chat
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
