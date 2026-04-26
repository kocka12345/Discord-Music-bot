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

```bash
cp .env.example .env
```

Edit `.env`:
```
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id_here
GUILD_ID=your_server_id_here   # optional, for instant command registration during dev
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
