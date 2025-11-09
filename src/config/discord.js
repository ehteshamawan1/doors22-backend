const { Client, GatewayIntentBits } = require('discord.js');
const logger = require('../utils/logger');

/**
 * Initialize Discord client for Midjourney interaction
 */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.on('ready', () => {
  logger.info('✅ Discord bot connected');
  logger.info(`Logged in as ${client.user.tag}`);
});

client.on('error', (error) => {
  logger.error('Discord client error:', error);
});

// Login to Discord
if (process.env.DISCORD_BOT_TOKEN) {
  client.login(process.env.DISCORD_BOT_TOKEN)
    .catch(err => logger.error('Failed to login to Discord:', err));
} else {
  logger.warn('⚠️  DISCORD_BOT_TOKEN not configured');
}

module.exports = client;
