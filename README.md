# Discord Bot

A Discord bot built with discord.js v14 that provides various utility commands and features.

## Features

- **Slash Commands**: Modern Discord slash command system
- **Modular Structure**: Organized command and event system
- **Error Handling**: Robust error handling for commands
- **Environment Configuration**: Secure configuration management

## Commands

- `/dnd [timeout], [user1]` - Create a private timed voice channel for the mentioned users. Channel gets deleted after set ammount of time in the timeout variable

## Prerequisites

- Node.js 16.9.0 or higher
- A Discord bot token
- Discord application with bot permissions

## Setup

1. **Clone or download this repository**

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   - Copy `env.example` to `.env`
   - Fill in your Discord bot credentials:
     ```
     DISCORD_TOKEN=your_bot_token_here
     CLIENT_ID=your_client_id_here
     GUILD_ID=your_guild_id_here
     ```

4. **Create a Discord Application**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application
   - Go to the "Bot" section and create a bot
   - Copy the bot token to your `.env` file
   - Copy the application ID to `CLIENT_ID` in your `.env` file

5. **Invite the Bot to Your Server**
   - Go to OAuth2 > URL Generator in your Discord application
   - Select "bot" scope
   - Select the permissions you want (at minimum: Send Messages, Use Slash Commands)
   - Use the generated URL to invite the bot to your server
   - Copy your server (guild) ID to `GUILD_ID` in your `.env` file

6. **Deploy Commands**
   ```bash
   node src/deploy-commands.js
   ```

7. **Start the Bot**
   ```bash
   # Development mode (with auto-restart)
   npm run dev
   
   # Production mode
   npm start
   ```

## Project Structure

```
discord-bot/
├── src/
│   ├── commands/          # Slash command files
│   │   ├── ping.js
│   │   └── info.js
│   ├── events/            # Discord event handlers
│   │   ├── ready.js
│   │   └── interactionCreate.js
│   ├── deploy-commands.js # Command deployment script
│   └── index.js          # Main bot file
├── package.json
├── env.example
└── README.md
```

## Adding New Commands

1. Create a new file in `src/commands/`
2. Export an object with `data` (SlashCommandBuilder) and `execute` (function)
3. Run `node src/deploy-commands.js` to register the command

Example command structure:
```javascript
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('example')
    .setDescription('An example command'),
  async execute(interaction) {
    await interaction.reply('This is an example command!');
  },
};
```

## Troubleshooting

- **Bot not responding**: Check that the bot token is correct and the bot has proper permissions
- **Commands not showing**: Run the deploy-commands script and ensure the bot has "Use Slash Commands" permission
- **Permission errors**: Make sure the bot has the necessary permissions in your server

## Contributing

Feel free to add new commands, events, or features to this bot!

## License

MIT License - feel free to use this project as a starting point for your own Discord bot. 
