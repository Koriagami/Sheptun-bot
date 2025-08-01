/*
 Sheptun: A Discord.js bot for private voice channels with auto-deletion.
 Requirements:
 - JS (discord.js v14)
 - Global slash command: /dnd <timeout> <members...>
 - In-memory tracking, no persistence across restarts
 - Bot must have its own role; created roles go under bot's role
 - Limit tagged users to 10, only user mentions
 - Fallback: if invoking channel has no category, create at bottom
 - Ephemeral success/error messages
*/

require("dotenv").config();
const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, SlashCommandBuilder, Routes, ChannelType } = require("discord.js");
const { REST } = require("@discordjs/rest");

// Load configuration from environment variables
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

// Validate required environment variables
if (!token) {
  console.error("Error: DISCORD_TOKEN environment variable is required");
  process.exit(1);
}
if (!clientId) {
  console.error("Error: CLIENT_ID environment variable is required");
  process.exit(1);
}

// Create the Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  partials: [Partials.Channel],
});

// In-memory map: roleId -> { channelId, timeoutObject, timeoutMinutes }
const dndMap = new Map();

// Utility: generate random alphanumeric string
function genId(length = 5) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join("");
}

// Register slash command
async function registerCommands() {
  const commandBuilder = new SlashCommandBuilder()
    .setName("dnd")
    .setDescription("Create a private voice channel")
    .addIntegerOption((opt) =>
      opt
        .setName("timeout")
        .setDescription("Delete after no activity (minutes)")
        .setRequired(true)
        .addChoices(
          { name: "Immediately", value: 0 },
          { name: "1 minute", value: 1 },
          { name: "5 minutes", value: 5 },
          { name: "15 minutes", value: 15 },
          { name: "30 minutes", value: 30 },
          { name: "60 minutes", value: 60 }
        )
    )
    .addUserOption((opt) => opt.setName("user1").setDescription("First user to invite").setRequired(true))
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Connect);

  // Add optional user options 2-10
  for (let i = 2; i <= 10; i++) {
    commandBuilder.addUserOption((opt) => opt.setName(`user${i}`).setDescription(`User ${i} to invite (optional)`).setRequired(false));
  }

  const commands = [commandBuilder];

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log("Slash commands registered");
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "dnd") return;

  // Check if interaction is already replied to or deferred
  if (interaction.replied || interaction.deferred) {
    console.log("Interaction already handled, skipping...");
    return;
  }

  // Defer reply immediately to prevent timeout
  try {
    await interaction.deferReply({ flags: 64 }); // 64 = ephemeral flag
  } catch (error) {
    console.error("Error deferring reply:", error);
    return; // Exit if we can't defer the reply
  }

  const timeoutMinutes = interaction.options.getInteger("timeout");

  // Collect all invited users (user1 is required, user2-10 are optional)
  const members = [];
  for (let i = 1; i <= 10; i++) {
    const user = interaction.options.getUser(`user${i}`);
    if (user) {
      const member = interaction.guild.members.cache.get(user.id);
      if (member) members.push(member);
    }
  }

  // Check bot permissions before proceeding
  const botMember = await interaction.guild.members.fetch(client.user.id);
  const requiredPermissions = [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ViewChannel];

  const missingPermissions = requiredPermissions.filter((perm) => !botMember.permissions.has(perm));
  if (missingPermissions.length > 0) {
    const permNames = missingPermissions
      .map((perm) => {
        switch (perm) {
          case PermissionFlagsBits.ManageRoles:
            return "Manage Roles";
          case PermissionFlagsBits.ManageChannels:
            return "Manage Channels";
          case PermissionFlagsBits.ViewChannel:
            return "View Channels";
          default:
            return "Unknown";
        }
      })
      .join(", ");

    try {
      return await interaction.editReply({
        content: `❌ **Missing Permissions**: The bot needs these permissions to work:\n\`${permNames}\`\n\nPlease ask a server admin to grant these permissions to the bot.`,
      });
    } catch (replyError) {
      console.error("Error sending permission error message:", replyError);
      return;
    }
  }

  // Generate role name
  const roleName = `dnd-${genId()}`;

  try {
    // Create role under the bot's highest role
    const botRolePos = botMember.roles.highest.position;
    const role = await interaction.guild.roles.create({
      name: roleName,
      mentionable: false,
      position: botRolePos - 1,
    });

    // Assign role to invoking user & tagged members
    await role.setMentionable(false);
    const assignTo = [interaction.member, ...members];
    await Promise.all(assignTo.map((m) => m.roles.add(role)));

    // Determine category or fallback
    const parent = interaction.channel.parentId ? interaction.channel.parent : null;

    // Create voice channel
    const channel = await interaction.guild.channels.create({
      name: roleName,
      type: ChannelType.GuildVoice,
      parent: parent,
      permissionOverwrites: [
        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] },
        ...assignTo.map((m) => ({ id: m.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] })),
        { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
      ],
    });

    // Schedule deletion logic
    const setupTimeout = () => {
      if (dndMap.has(role.id) && dndMap.get(role.id).timeoutObj) {
        clearTimeout(dndMap.get(role.id).timeoutObj);
      }
      const to = setTimeout(
        async () => {
          // re-check empty or if channel no longer exists
          const vc = interaction.guild.channels.cache.get(channel.id);
          if (!vc || vc.members.size === 0) {
            // Channel is gone or empty, clean up both channel and role
            if (vc) await vc.delete().catch(() => {});
            await role.delete().catch(() => {});
            dndMap.delete(role.id);
          }
        },
        timeoutMinutes === 0 ? 1000 : timeoutMinutes * 60 * 1000
      );
      dndMap.set(role.id, { channelId: channel.id, timeoutObj: to, timeoutMinutes });
    };

    // Initial timeout
    setupTimeout();

    // Success message
    try {
      await interaction.editReply({ content: `🔒 Your private channel **${roleName}** is ready!` });
    } catch (replyError) {
      console.error("Error sending success message:", replyError);
    }
  } catch (err) {
    console.error("Error creating DND channel:", err);

    // Provide specific error messages based on error type
    let errorMessage = "⚠️ Something went wrong creating your channel.";
    if (err.code === 50013) {
      errorMessage =
        "❌ **Missing Permissions**: The bot doesn't have permission to create channels or roles in this server. Please ask a server admin to grant the bot proper permissions.";
    } else if (err.code === 50001) {
      errorMessage = "❌ **Access Denied**: The bot doesn't have access to this channel or category. Please check the bot's permissions.";
    }

    try {
      await interaction.editReply({ content: errorMessage });
    } catch (replyError) {
      console.error("Error sending error message:", replyError);
    }
  }
});

// Listen for joins / leaves to reset timeout
client.on("voiceStateUpdate", (oldState, newState) => {
  const channelId = oldState.channelId || newState.channelId;
  if (!channelId) return;

  // Find matching role entry
  for (const [roleId, data] of dndMap.entries()) {
    if (data.channelId === channelId) {
      const vc = oldState.guild.channels.cache.get(channelId);

      // If channel no longer exists, immediately clean up the role
      if (!vc) {
        console.log(`Channel ${channelId} no longer exists, cleaning up role ${roleId}`);
        clearTimeout(data.timeoutObj);
        oldState.guild.roles.cache
          .get(roleId)
          ?.delete()
          .catch(() => {});
        dndMap.delete(roleId);
        return;
      }

      if (vc.members.size === 0) {
        // start/reset timeout
        const to = setTimeout(
          async () => {
            // double check - channel might be deleted by now
            const vcCheck = oldState.guild.channels.cache.get(channelId);
            if (!vcCheck || vcCheck.members.size === 0) {
              if (vcCheck) await vcCheck.delete().catch(() => {});
              const role = oldState.guild.roles.cache.get(roleId);
              if (role) await role.delete().catch(() => {});
              dndMap.delete(roleId);
            }
          },
          data.timeoutMinutes === 0 ? 1000 : data.timeoutMinutes * 60 * 1000
        );
        clearTimeout(data.timeoutObj);
        dndMap.set(roleId, { ...data, timeoutObj: to });
      } else {
        // occupied: clear any existing timeout
        clearTimeout(data.timeoutObj);
      }
    }
  }
});

// Listen for channel deletions to clean up associated roles
client.on("channelDelete", (channel) => {
  // Only handle voice channels
  if (channel.type !== 2) return; // 2 = GUILD_VOICE

  // Find and clean up associated role
  for (const [roleId, data] of dndMap.entries()) {
    if (data.channelId === channel.id) {
      console.log(`DND channel ${channel.id} was deleted, cleaning up role ${roleId}`);
      clearTimeout(data.timeoutObj);

      // Delete the associated role
      channel.guild.roles.cache
        .get(roleId)
        ?.delete()
        .catch((err) => {
          console.error(`Failed to delete role ${roleId}:`, err);
        });

      dndMap.delete(roleId);
      break; // Only one role per channel
    }
  }
});

client.login(token);
