require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const play = require('play-dl');
const yts = require('yt-search');
const express = require('express');

// 1. Configuración inicial
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages
  ],
  rest: { timeout: 30_000 } // Aumenta timeout a 30 segundos
});

// 2. Estructuras de datos
const queues = new Map();
const players = new Map();
const connections = new Map();

// 3. Configuración mejorada de play-dl con manejo de rate limits
play.setToken({
  youtube: {
    cookie: process.env.YOUTUBE_COOKIE || '',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
  },
  retry: 5,
  delay: 3000
});

// 4. Servidor web para keep-alive
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.status(200).json({ status: 'active', timestamp: Date.now() }));
app.listen(process.env.PORT || 3000, () => console.log('🟢 Keep-alive activo'));

// 5. Eventos del cliente
client.once('ready', () => {
  console.log(`✅ ${client.user.tag} listo!`);
  client.user.setActivity('/play | Música', { type: 'LISTENING' });
  
  // Heartbeat para mantener conexión
  setInterval(() => client.ws.ping, 30_000);
});

// 6. Manejo de interacciones (actualizado para usar MessageFlags)
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'play') {
      await handlePlayCommand(interaction);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error en interacción:`, error);
    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({ 
        content: '❌ Error al procesar el comando', 
        flags: MessageFlags.Ephemeral 
      }).catch(console.error);
    }
  }
});

// 7. Función para manejar /play (actualizada)
async function handlePlayCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(console.error);

  const query = interaction.options.getString('query');
  const voiceChannel = interaction.member?.voice?.channel;

  if (!voiceChannel) {
    return interaction.editReply({ 
      content: '🔇 Debes unirte a un canal de voz primero',
      flags: MessageFlags.Ephemeral 
    }).catch(console.error);
  }

  try {
    const song = await getSongInfo(query);
    if (!song) return;

    if (!queues.has(interaction.guild.id)) {
      queues.set(interaction.guild.id, []);
    }
    queues.get(interaction.guild.id).push(song);

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🎵 Añadido a la cola')
      .setDescription(`[${song.title}](${song.url})`)
      .setFooter({ text: `Duración: ${song.duration}` });

    await interaction.editReply({ embeds: [embed] }).catch(console.error);

    if (!players.has(interaction.guild.id)) {
      await playMusic(interaction.guild.id, voiceChannel);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error en /play:`, error);
    await interaction.editReply({ 
      content: '❌ Error: ' + (error.message || 'Intenta nuevamente'),
      flags: MessageFlags.Ephemeral 
    }).catch(console.error);
  }
}

// 8. Obtener información de canción con delay
async function getSongInfo(query) {
  await new Promise(resolve => setTimeout(resolve, 1000)); // Delay para evitar rate limits
  
  const isUrl = play.yt_validate(query);
  
  if (isUrl) {
    const info = await play.video_info(query);
    return {
      title: info.video_details.title,
      url: info.video_details.url,
      duration: info.video_details.durationRaw
    };
  } else {
    const { videos } = await yts(query);
    if (!videos.length) return null;
    const info = await play.video_info(videos[0].url);
    return {
      title: info.video_details.title,
      url: info.video_details.url,
      duration: info.video_details.durationRaw
    };
  }
}

// 9. Función principal de reproducción
async function playMusic(guildId, voiceChannel) {
  try {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();
    players.set(guildId, player);
    connections.set(guildId, connection);
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => handleIdlePlayer(guildId));
    player.on('error', error => {
      console.error(`[${new Date().toISOString()}] Error en player:`, error);
      cleanup(guildId);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
        ]);
      } catch (error) {
        cleanup(guildId);
      }
    });

    await playNextTrack(guildId, player);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error en playMusic:`, error);
    cleanup(guildId);
  }
}

// 10. Reproducir siguiente canción con mejor manejo de rate limits
async function playNextTrack(guildId, player) {
  try {
    const queue = queues.get(guildId);
    if (!queue?.length) return cleanup(guildId);

    // Delay aleatorio entre 1-3 segundos
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));

    const stream = await play.stream(queue[0].url, {
      quality: 'lowestaudio',
      discordPlayerCompatibility: true,
      retry: 3
    });

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true
    });

    player.play(resource);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error en playNextTrack:`, error);
    if (error.message.includes('429')) {
      await new Promise(resolve => setTimeout(resolve, 30_000));
      return playNextTrack(guildId, player);
    }
    handleIdlePlayer(guildId);
  }
}

// 11. Manejar reproductor inactivo
async function handleIdlePlayer(guildId) {
  const queue = queues.get(guildId);
  if (queue?.length) {
    queue.shift();
    if (queue.length > 0) {
      await playNextTrack(guildId, players.get(guildId));
      return;
    }
  }

  setTimeout(() => {
    if (players.get(guildId)?.state.status === AudioPlayerStatus.Idle) {
      cleanup(guildId);
    }
  }, 300_000);
}

// 12. Limpieza de recursos
function cleanup(guildId) {
  try {
    connections.get(guildId)?.destroy();
    players.get(guildId)?.stop();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error en cleanup:`, error);
  } finally {
    connections.delete(guildId);
    players.delete(guildId);
    queues.delete(guildId);
  }
}

// 13. Manejo mejorado de errores globales
process.on('unhandledRejection', error => {
  console.error(`[${new Date().toISOString()}] Unhandled Rejection:`, error);
});

process.on('uncaughtException', error => {
  console.error(`[${new Date().toISOString()}] Uncaught Exception:`, error);
  process.exit(1);
});

// 14. Iniciar bot
client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error(`[${new Date().toISOString()}] Error al iniciar sesión:`, error);
  process.exit(1);
});