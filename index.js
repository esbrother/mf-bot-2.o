require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const play = require('play-dl');
const yts = require('yt-search');
const express = require('express');

// 1. Configuración inicial con mejores timeouts
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages
  ],
  rest: { 
    timeout: 30_000,
    globalRateLimit: 50 // Limita solicitudes globales
  }
});

// 2. Estructuras de datos con cooldowns
const queues = new Map();
const players = new Map();
const connections = new Map();
const cooldowns = new Map();

// 3. Configuración optimizada de play-dl
play.setToken({
  youtube: {
    cookie: process.env.YOUTUBE_COOKIE || '',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
  },
  retry: 3,
  delay: 5000,
  timeout: 30000
});

// 4. Servidor web mejorado
const app = express();
app.use(express.json());
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    guilds: client.guilds.cache.size,
    uptime: process.uptime() 
  });
});
app.listen(process.env.PORT || 3000, () => console.log('🟢 Keep-alive optimizado'));

// 5. Eventos del cliente con heartbeat mejorado
client.once('ready', () => {
  console.log(`✅ ${client.user.tag} listo en ${client.guilds.cache.size} servidores!`);
  client.user.setActivity('/play | Música sin lag', { type: 'LISTENING' });
  
  setInterval(() => {
    client.ws.ping;
    console.log('🫀 Heartbeat enviado');
  }, 30000);
});

// 6. Manejo de interacciones con cooldown
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // Sistema de cooldown
  if (!cooldowns.has(interaction.commandName)) {
    cooldowns.set(interaction.commandName, new Map());
  }

  const now = Date.now();
  const timestamps = cooldowns.get(interaction.commandName);
  const cooldownAmount = 3000; // 3 segundos de cooldown

  if (timestamps.has(interaction.user.id)) {
    const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;
    if (now < expirationTime) {
      const timeLeft = (expirationTime - now) / 1000;
      return interaction.reply({
        content: `⏳ Espera ${timeLeft.toFixed(1)} segundos antes de usar \`/${interaction.commandName}\` de nuevo.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }

  timestamps.set(interaction.user.id, now);
  setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    if (interaction.commandName === 'play') {
      await handlePlayCommand(interaction);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error en ${interaction.commandName}:`, error);
    await interaction.editReply({
      content: '❌ Error interno. Por favor, intenta nuevamente.',
      flags: MessageFlags.Ephemeral
    }).catch(console.error);
  }
});

// 7. Función para manejar /play con mejoras
async function handlePlayCommand(interaction) {
  const query = interaction.options.getString('query');
  const voiceChannel = interaction.member?.voice?.channel;

  if (!voiceChannel) {
    return interaction.editReply({ 
      content: '🔇 Debes estar en un canal de voz primero.',
      flags: MessageFlags.Ephemeral 
    });
  }

  try {
    // Delay para evitar rate limits
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const song = await getSongInfo(query);
    if (!song) {
      return interaction.editReply({
        content: '❌ No se encontró la canción.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (!queues.has(interaction.guild.id)) {
      queues.set(interaction.guild.id, []);
    }
    queues.get(interaction.guild.id).push(song);

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🎵 Añadido a la cola')
      .setDescription(`[${song.title}](${song.url})`)
      .setFooter({ text: `Duración: ${song.duration} | Posición en cola: ${queues.get(interaction.guild.id).length}` });

    await interaction.editReply({ embeds: [embed] });

    if (!players.has(interaction.guild.id)) {
      await playMusic(interaction.guild.id, voiceChannel);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error en /play:`, error);
    await interaction.editReply({
      content: '⚠️ YouTube está limitando las solicitudes. Intenta nuevamente en 30 segundos.',
      flags: MessageFlags.Ephemeral
    });
  }
}

// 8. Función optimizada para obtener info de canciones
async function getSongInfo(query) {
  try {
    await new Promise(resolve => setTimeout(resolve, 2000)); // Delay adicional
    
    const isUrl = play.yt_validate(query);
    let info;

    if (isUrl) {
      info = await play.video_info(query);
    } else {
      const { videos } = await yts(query);
      if (!videos.length) return null;
      info = await play.video_info(videos[0].url);
    }

    return {
      title: info.video_details.title,
      url: info.video_details.url,
      duration: info.video_details.durationRaw || 'N/A'
    };
  } catch (error) {
    console.error('Error en getSongInfo:', error);
    return null;
  }
}

// 9. Función principal de reproducción con manejo mejorado
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
      console.error('Error en player:', error);
      cleanup(guildId);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch (error) {
        cleanup(guildId);
      }
    });

    await playNextTrack(guildId, player);
  } catch (error) {
    console.error('Error en playMusic:', error);
    cleanup(guildId);
  }
}

// 10. Función optimizada para playNextTrack
async function playNextTrack(guildId, player) {
  const queue = queues.get(guildId);
  if (!queue?.length) return cleanup(guildId);

  try {
    // Delay aleatorio entre 3-6 segundos
    await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 3000));

    const stream = await play.stream(queue[0].url, {
      quality: 'lowestaudio',
      discordPlayerCompatibility: true,
      retry: 2
    });

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true
    });

    player.play(resource);
  } catch (error) {
    console.error('Error en playNextTrack:', error);
    if (error.message.includes('429')) {
      await new Promise(resolve => setTimeout(resolve, 30000));
      return playNextTrack(guildId, player);
    }
    handleIdlePlayer(guildId);
  }
}

// 11. Función para manejar idle player
async function handleIdlePlayer(guildId) {
  const queue = queues.get(guildId);
  if (queue?.length) {
    queue.shift();
    if (queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await playNextTrack(guildId, players.get(guildId));
      return;
    }
  }

  setTimeout(() => {
    if (players.get(guildId)?.state.status === AudioPlayerStatus.Idle) {
      cleanup(guildId);
    }
  }, 180000); // Desconectar después de 3 minutos inactivo
}

// 12. Función de limpieza optimizada
function cleanup(guildId) {
  try {
    const connection = connections.get(guildId);
    const player = players.get(guildId);
    
    if (connection) {
      connection.destroy();
      console.log(`🔌 Desconectado del servidor ${guildId}`);
    }
    
    if (player) {
      player.stop();
      console.log(`⏹ Reproductor detenido en ${guildId}`);
    }
  } catch (error) {
    console.error('Error en cleanup:', error);
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

// 14. Inicio seguro del bot
client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error('Error al iniciar sesión:', error);
  process.exit(1);
});