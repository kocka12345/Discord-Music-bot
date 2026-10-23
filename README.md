# 🎵 Discord Music Bot

A full-featured Discord music bot that plays YouTube audio in voice channels, with queue management, personal playlists, and live lyrics.

*Self-Driven Development (SDD) Project*

---

## ✨ Features

### 🎧 Core Commands

| Command | Description |
| :--- | :--- |
| `/play <url or search>` | Play a YouTube video, playlist, or search term |
| `/stop` | Stop music and clear the queue |
| `/skip` | Skip the current track |
| `/pause` / `/resume` | Pause and resume playback |
| `/queue` | Show the current queue (paginated with interactive controls) |
| `/nowplaying` | Show what's currently playing (ephemeral status card) |
| `/volume <0–150>` | Set playback volume |
| `/loop <off/track/queue>` | Set loop mode |
| `/shuffle` | Shuffle the current queue |
| `/remove <position>` | Remove a track from the queue |
| `/lyrics [song] [artist]` | Fetch lyrics and enable live synced lyrics for current track |

### 🛠 System & Admin Commands

| Command | Description |
| :--- | :--- |
| `/bio` | Show basic bot profile, uptime, and system statistics |
| `/setup show` | Show guild configuration (admin role + test mode status) |
| `/setup set ...` | Configure admin role, test mode, `/play` cooldown, max tracks, default volume, auto live lyrics |

### 📜 Playlist Management

| Command | Description |
| :--- | :--- |
| `/playlist create <name>` | Create a personal playlist |
| `/playlist add <name> <url>` | Add a song or track to a playlist |
| `/playlist remove <name> <position>` | Remove a song from a playlist |
| `/playlist list [name]` | List all your playlists or tracks inside a specific playlist |
| `/playlist play <name>` | Queue an entire personal playlist |
| `/playlist delete <name>` | Delete a personal playlist |
| `/playlist rename <name> <newname>` | Rename an existing playlist |

### 🔥 Extras & Performance Tips

- **Hosting & Proxying:** If you have your own server or have some money to spare (to buy a proxy if you are using free cloud hosting), you can use `node-ytdl-core` or proxy configurations.
- **SoundCloud Fallback:** With proxy and fallback support, you can directly input YouTube links and stream YouTube videos directly without relying solely on SoundCloud streams.
- **Rate-Limit Resilience:** Automatic failover strategy when cloud host IPs hit YouTube limits.

---

## 🚀 Setup Guide

### 1. Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **ffmpeg** — [ffmpeg.org/download.html](https://ffmpeg.org/download.html)
  - **Windows:** `winget install ffmpeg` or download from gyan.dev
  - **macOS:** `brew install ffmpeg`
  - **Linux:** `sudo apt install ffmpeg`
  - *Note:* Render or Railway are recommended cloud providers for hosting.

### 2. Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** and give it a name.
3. Go to **Bot** $\rightarrow$ click **Add Bot** $\rightarrow$ confirm.
4. Under **Privileged Gateway Intents**, enable:
   - Server Members Intent
   - Message Content Intent
5. Copy the **Bot Token** (you'll need it in step 4).
6. Go to **OAuth2** $\rightarrow$ **General** $\rightarrow$ copy the **Client ID**.

### 3. Invite the Bot to Your Server

Go to **OAuth2** $\rightarrow$ **URL Generator**, select:
- **Scopes:** `bot`, `applications.commands`
- **Bot Permissions:** `Connect`, `Speak`, `Send Messages`, `Use Slash Commands`

Open the generated URL and add the bot to your server.

### 4. Configure Environment Variables

Create a `.env` file in the project root directory and populate it with:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id_here
GUILD_ID=your_server_id_here
DEBUG_LOGS=false
```

> 💡 **Tip:** To get your Server ID (`GUILD_ID`), enable Developer Mode in Discord settings (**Settings** $\rightarrow$ **Advanced** $\rightarrow$ **Developer Mode**), then right-click your server icon $\rightarrow$ **Copy Server ID**.

### 5. Install Dependencies

Run the following command in your terminal:

```bash
npm install
```

### 6. Register Slash Commands

Register slash commands with Discord:

```bash
node deploy-commands.js
```

- **With `GUILD_ID` set:** Commands appear instantly in that specific server (great for development).
- **Without `GUILD_ID`:** Global registration takes up to 1 hour to propagate.

### 7. Start the Bot

**Development Mode:**
```bash
node src/index.js
```

**Production Mode (using PM2):**
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
│   ├── index.js          # Bot entry point & client initialization
│   ├── GuildQueue.js     # Per-server queue, playback manager & audio player
│   ├── resolver.js       # YouTube URL/search resolver & stream dispatcher
│   └── commands/
│       ├── play.js       # /play logic & argument parsing
│       ├── controls.js   # /stop, /skip, /pause, /resume
│       ├── queue.js      # /queue pagination & visual state
│       ├── extras.js     # /nowplaying, /volume, /loop, /shuffle, /remove, /bio
│       ├── playlist.js   # /playlist subcommands handler
│       └── lyrics.js     # /lyrics live sync engine
├── data/
│   └── playlists.json    # Auto-created storage file for user playlists
├── deploy-commands.js    # One-time slash command deployment script
├── .env.example          # Environment variables template
├── package.json          # Node.js dependencies and scripts
└── README.md             # Project documentation
```

---

## 🎛 Lyrics & Channel Behavior

- `/lyrics`: Uses live lyrics mode directly without needing dropdown selection.
- **Sync Engine:** Prefers synced timestamp data from `lrclib` when available.
- **Smart Fallback Timing:** If synced timestamps are unavailable, fallback timing distributes lyrics progressively based on track duration (much smoother than static 3-second line steps).
- **Clean Output Channels:** Lyrics and Now-Playing embeds are routed to the designated voice-related text channel to prevent command spam. `/play` only returns a concise confirmation reply.
- **Interactive Now-Playing Card:** Includes a *More features* drop-down menu (queue access, shuffle, loop toggles, live lyrics, stop) available for all users without premium restrictions.

---

## 📘 Quick Usage Guide

1. **Join Voice Channel:** Connect to any voice channel on your server.
2. **Start Music:** Run `/play query:<song title, YouTube URL, or playlist link>`.
3. **Show Lyrics:** Run `/lyrics` during playback to fetch and display synchronized lyrics.
4. **Playback Control:** Use `/queue`, `/pause`, `/resume`, `/skip`, or `/shuffle` to manage playback.
5. **On-Demand Status:** Run `/nowplaying` to get an instant, ephemeral playback card.

---

## 💡 Pro-Tips & Server Configuration

- **Per-User Playlists:** Saved globally in `data/playlists.json`. Every user maintains their independent list.
- **Lyrics Sources:** Primary synchronization fetched via `lrclib.net` and `lyrics.ovh`.
- **Role Permissions & Moderation:** Protect sensitive commands using `/setup set admin_role:<role>`.
- **Testing:** Toggling `/setup set test_mode:true` limits response output to testing environments.
- **Custom Server Settings:**
  - **Cooldowns:** `/setup set play_cooldown_sec:<0-30>`
  - **Queue limits:** `/setup set max_tracks_per_play:<1-100>`
  - **Audio defaults:** `/setup set default_volume:<0-150>`
  - **Auto Lyrics:** `/setup set auto_live_lyrics:<true|false>`
- **Loop Modes:**
  - `off`: Plays through the queue once.
  - `track`: Repeats the currently playing track endlessly.
  - `queue`: Loops the entire queue indefinitely.
- **Playlist Support:** Full YouTube playlist links are parsed automatically to queue all tracks at once.

---

## 🌐 Cloud Hosting & Render Deployment Notes

This architecture utilizes `play-dl` as its primary resolver and does not require bundling a separate `yt-dlp` binary on basic setups.

**Recommended Render Settings:**
- **Build Command:** `npm install`
- **Start Command:** `node src/index.js`
- **Environment Variables:**
  - `DISCORD_TOKEN`
  - `CLIENT_ID`
  - `GUILD_ID` *(optional, for fast command updates)*
  - `DEBUG_LOGS=true` *(optional, verbose logs)*
  - `LAVALINK_URL` *(recommended, e.g., http://your-lavalink-host:2333)*
  - `LAVALINK_PASSWORD` *(recommended)*
  - `PLAYDL_YOUTUBE_COOKIE_B64` *(recommended for cloud deployments)*

> ⚠️ **Voice Connection Troubleshooting:** If voice playback fails on Render, verify that UDP connections are open and that the bot has both **Connect** and **Speak** permissions in Discord.

### YouTube 429 (Rate Limit) Mitigation

Cloud providers (Render, AWS, DigitalOcean) frequently face YouTube 429 rate-limiting. This bot supports passing YouTube authentication cookies directly into `play-dl`:
- `PLAYDL_YOUTUBE_COOKIE` — Raw cookie header string (`k1=v1; k2=v2; ...`)
- `PLAYDL_YOUTUBE_COOKIE_B64` — Base64 encoded Netscape `cookies.txt` file (recommended)

Additionally, on startup, the bot initializes an automated SoundCloud client ID fallback to ensure seamless music playback even during YouTube rate limits.

### Advanced: yt-dlp Fallback & Proxy Configuration

#### A) Adding yt-dlp (Optional Fallback Tooling)

1. Install `yt-dlp` on your host:
   - **Windows:** Download `yt-dlp.exe` and place it in the project root or system `PATH`.
   - **Linux/macOS:** `python -m pip install -U yt-dlp`
2. Verify installation: `yt-dlp --version`
3. Specify binary path in env (optional): `YTDLP_PATH=/absolute/path/to/yt-dlp`

#### B) Configuring YouTube Proxying

To prevent IP blocks altogether, route YouTube requests through a proxy:

```env
HTTP_PROXY=http://user:pass@host:port
HTTPS_PROXY=http://user:pass@host:port
ALL_PROXY=socks5://user:pass@host:port
```

**Best Practices:**
- Always keep proxy credentials stored securely in `.env`.
- Use static residential proxies for high reliability with YouTube.
- Restart your bot process whenever environment variables change.

---

## 🧰 Backend Architecture

- **Resolver Backend:** `play-dl` (`src/resolver.js`)
- **Streaming Engine:** `play-dl` audio stream source (`src/GuildQueue.js`)
- **Voice Output Engine:** `@discordjs/voice`
- **Provider Fallback Strategy:** Text-based search prioritizes SoundCloud first to avoid YouTube rate limits, falling back to YouTube when necessary.
- **Automatic Failover:** When YouTube returns a 429 Too Many Requests error, the bot automatically retries and streams the track via SoundCloud search.
- **Custom YouTube Link Handling:**
  - `watch?v=...&list=...`: Resolves full playlist automatically.
  - `watch?v=...`: Generates a dynamic "Mix" queue based on seed track & related media.

---

## 🙌 Credits & Acknowledgments

- **Discord API Framework:** [discord.js](https://discord.js.org/)
- **Audio Engine:** [@discordjs/voice](https://github.com/discordjs/discord.js/tree/main/packages/voice)
- **Media Resolver & Streamer:** [play-dl](https://github.com/play-dl/play-dl)
- **Lyrics APIs:** [lrclib.net](https://lrclib.net) & [lyrics.ovh](https://lyrics.ovh)
