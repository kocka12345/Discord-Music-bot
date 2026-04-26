/**
 * deploy-commands.js
 * Run once (or after changes) to register slash commands with Discord.
 *
 * Global:  node deploy-commands.js
 * Guild:   GUILD_ID=your_id node deploy-commands.js   (faster, ~instant)
 */
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // optional

if (!token || !clientId) {
  console.error('❌  DISCORD_TOKEN and CLIENT_ID must be set in .env');
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, 'src', 'commands');

for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const mod = require(path.join(commandsPath, file));
  if (mod.data) { commands.push(mod.data.toJSON()); continue; }
  for (const [, cmd] of Object.entries(mod)) {
    if (cmd?.data) commands.push(cmd.data.toJSON());
  }
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`🔄  Registering ${commands.length} command(s)…`);

    let data;
    if (guildId) {
      data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log(`✅  Registered ${data.length} guild command(s) in ${guildId}`);
    } else {
      data = await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log(`✅  Registered ${data.length} global command(s) (may take up to 1 hour to appear)`);
    }
  } catch (err) {
    console.error('❌  Registration failed:', err);
  }
})();
