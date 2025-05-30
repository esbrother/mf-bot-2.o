require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const play = require('play-dl');
const yts = require('yt-search');
const express = require('express');

// Configuración avanzada de play-dl
play.setToken({
  youtube: {
    cookie: process.env.YOUTUBE_COOKIE || '',
    userAgent: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'AppleWebKit/537.36 (KHTML, like Gecko)',
      'Chrome/114.0.0.0 Safari/537.36'
    ].join(' ')
  }
});

// Control de tasa de solicitudes
const requestDelay = process.env.REQUEST_DELAY_MS ? parseInt(process.env.REQUEST_DELAY_MS) : 2000;
let lastRequest = Date.now();

async function safeRequest(url) {
  const now = Date.now();
  const elapsed = now - lastRequest;
  
  if (elapsed < requestDelay) {
    await new Promise(resolve => setTimeout(resolve, requestDelay - elapsed));
  }
  
  lastRequest = Date.now();
  return play.stream(url, {
    quality: 'lowestaudio',
    discordPlayerCompatibility: true,
    retry: 3
  });
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Estructuras de datos
const queues = new Map();
const players = new Map();
const connections = new Map();

// Servidor web para keep-alive
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.status(200).json({ status: 'active', timestamp: Date.now() }));
app.listen(process.env.PORT || 3000, () => console.log('🟢 Keep-alive activo'));

// Eventos del cliente
client.once('ready', () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
  client.user.setActivity('/play | Música', { type: 'LISTENING' });
  
  // Heartbeat
  setInterval(() => client.ws.ping, 30000);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'play') {
      await handlePlayCommand(interaction);
    }
  } catch (error) {
    console.error('Error en interacción:', error);
    await interaction.reply({ content: '❌ Error al procesar el comando', ephemeral: true }).catch(console.error);
  }
});

// Manejo del comando /play
async function handlePlayCommand(interaction) {
  await interaction.deferReply();

  const query = interaction.options.getString('query');
  const voiceChannel = interaction.member?.voice?.channel;

  if (!voiceChannel) {
    return interaction.editReply('🔇 Debes unirte a un canal de voz primero');
  }

  try {
    let song;

    if (play.yt_validate(query) {
      const info = await play.video_info(query);
      song = {
        title: info.video_details.title,
        url: info.video_details.url,
        duration: info.video_details.durationRaw
      };
    } else {
      const { videos } = await yts(query);
      if (!videos.length) return interaction.editReply('🔍 No se encontraron resultados');
      const info = await play.video_info(videos[0].url);
      song = {
        title: info.video_details.title,
        url: info.video_details.url,
        duration: info.video_details.durationRaw
      };
    }

    // Manejo de la cola
    if (!queues.has(interaction.guild.id)) {
      queues.set(interaction.guild.id, []);
    }
    queues.get(interaction.guild.id).push(song);

    // Respuesta al usuario
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🎵 Añadido a la cola')
      .setDescription(`[${song.title}](${song.url})`)
      .setFooter({ text: `Duración: ${song.duration}` });

    await interaction.editReply({ embeds: [embed] });

    // Iniciar reproducción si no hay nada sonando
    if (!players.has(interaction.guild.id)) {
      await playMusic(interaction.guild.id, voiceChannel);
    }
  } catch (error) {
    console.error('Error en handlePlayCommand:', error);
    if (error.message.includes('429')) {
      await interaction.editReply('⚠️ YouTube está limitando las solicitudes. Intenta de nuevo en unos segundos');
    } else {
      await interaction.editReply('❌ Error al procesar la solicitud');
    }
  }
}

// Función principal de reproducción
async function playMusic(guildId, voiceChannel) {
  try {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();
    players.set(guildId, player);
    connections.set(guildId, connection);
    connection.subscribe(player);

    // Manejadores de eventos
    player.on('error', error => {
      console.error('Error en el reproductor:', error);
      cleanup(guildId);
    });

    player.on(AudioPlayerStatus.Idle, () => {
      handleIdlePlayer(guildId);
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

    // Reproducir primera canción
    await playNextTrack(guildId, player);

  } catch (error) {
    console.error('Error en playMusic:', error);
    cleanup(guildId);
  }
}

// Manejo de estado Idle
async function handleIdlePlayer(guildId) {
  const queue = queues.get(guildId);
  if (queue?.length) {
    queue.shift();
    if (queue.length > 0) {
      await playNextTrack(guildId, players.get(guildId));
      return;
    }
  }

  // Desconexión después de 5 minutos de inactividad
  setTimeout(() => {
    if (players.get(guildId)?.state?.status === AudioPlayerStatus.Idle) {
      cleanup(guildId);
    }
  }, 300_000);
}

// Reproducir siguiente canción
async function playNextTrack(guildId, player) {
  try {
    const queue = queues.get(guildId);
    if (!queue?.length) return cleanup(guildId);

    const stream = await safeRequest(queue[0].url);
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true
    });

    player.play(resource);
  } catch (error) {
    console.error('Error en playNextTrack:', error);
    if (error.message.includes('429')) {
      console.log('⚠️ Esperando 10 segundos por límite de YouTube...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      return playNextTrack(guildId, player);
    }
    handleIdlePlayer(guildId);
  }
}

// Limpieza de recursos
function cleanup(guildId) {
  try {
    connections.get(guildId)?.destroy();
    players.get(guildId)?.stop();
  } catch (error) {
    console.error('Error en cleanup:', error);
  } finally {
    connections.delete(guildId);
    players.delete(guildId);
    queues.delete(guildId);
  }
}

// Manejo de errores globales
process.on('unhandledRejection', error => {
  console.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('Uncaught Exception:', error);
});

// Iniciar bot
client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error('Error al iniciar sesión:', error);
  process.exit(1);
});