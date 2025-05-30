// Polyfill para ReadableStream
if (typeof ReadableStream === 'undefined') {
  global.ReadableStream = require('stream/web').ReadableStream;
}
require('dotenv').config(); // Asegúrate de tener el paquete dotenv instalado
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const play = require('play-dl');
const yts = require('yt-search');
const express = require('express');

// Configuración inicial
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
const audioPlayers = new Map();
const voiceConnections = new Map();

// Configuración de play-dl
play.setToken({
  youtube: {
    cookie: process.env.YOUTUBE_COOKIE || ''
  }
});

// Servidor web para keep-alive
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.status(200).json({ status: 'ok' }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🟢 Keep-alive en puerto ${PORT}`));

// Eventos del cliente
client.once('ready', () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
  client.user.setActivity('/play | Música', { type: 'LISTENING' });

  // Heartbeat para mantener la conexión
  setInterval(() => client.ws.ping, 30000);
});

// Manejo de comandos
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'play') {
      await handlePlayCommand(interaction);
    }
  } catch (error) {
    console.error('Error en interacción:', error);
    await interaction.reply({ content: '❌ Ocurrió un error al procesar el comando', ephemeral: true }).catch(console.error);
  }
});

// Función para manejar el comando /play
async function handlePlayCommand(interaction) {
  await interaction.deferReply();

  const query = interaction.options.getString('query');
  const voiceChannel = interaction.member?.voice?.channel;

  if (!voiceChannel) {
    return interaction.editReply('🔇 Debes unirte a un canal de voz primero');
  }

  try {
    let song;

    // Validar si es URL o búsqueda
    if (play.yt_validate(query) === 'video') {
      const info = await play.video_info(query);
      song = {
        title: info.video_details.title,
        url: info.video_details.url,
        duration: info.video_details.durationRaw
      };
    } else {
      const { videos } = await yts(query);
      if (!videos.length) {
        return interaction.editReply('🔍 No se encontraron resultados');
      }
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

    const queue = queues.get(interaction.guild.id);
    queue.push(song);

    // Respuesta al usuario
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🎵 Añadido a la cola')
      .setDescription(`[${song.title}](${song.url})`)
      .setFooter({ text: `Duración: ${song.duration}` });

    await interaction.editReply({ embeds: [embed] });

    // Reproducir si no hay nada sonando
    if (!audioPlayers.has(interaction.guild.id)) {
      await playMusic(interaction.guild.id, voiceChannel);
    }
  } catch (error) {
    console.error('Error en handlePlayCommand:', error);
    await interaction.editReply('❌ Error al procesar la solicitud').catch(console.error);
  }
}

// Función principal de reproducción
async function playMusic(guildId, voiceChannel) {
  try {
    // Crear conexión de voz
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    voiceConnections.set(guildId, connection);

    // Crear reproductor de audio
    const player = createAudioPlayer();
    audioPlayers.set(guildId, player);
    connection.subscribe(player);

    // Manejar eventos del reproductor
    player.on('error', error => {
      console.error('Error en el reproductor:', error);
      cleanup(guildId);
    });

    player.on(AudioPlayerStatus.Idle, () => {
      handleIdlePlayer(guildId, voiceChannel);
    });

    // Manejar eventos de conexión
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

// Función para manejar el estado Idle
async function handleIdlePlayer(guildId, voiceChannel) {
  const queue = queues.get(guildId);
  if (queue?.length) {
    queue.shift();
    if (queue.length > 0) {
      await playNextTrack(guildId, audioPlayers.get(guildId));
      return;
    }
  }

  // Desconectar después de 5 minutos de inactividad
  setTimeout(() => {
    if (audioPlayers.get(guildId)?.state?.status === AudioPlayerStatus.Idle) {
      cleanup(guildId);
    }
  }, 300_000);
}

// Función para reproducir la siguiente canción
async function playNextTrack(guildId, player) {
  try {
    const queue = queues.get(guildId);
    if (!queue?.length) {
      cleanup(guildId);
      return;
    }

    const song = queue[0];
    const stream = await play.stream(song.url, {
      quality: 2,
      discordPlayerCompatibility: true
    });

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true
    });

    player.play(resource);
  } catch (error) {
    console.error('Error en playNextTrack:', error);
    handleIdlePlayer(guildId);
  }
}

// Función para limpieza
function cleanup(guildId) {
  try {
    voiceConnections.get(guildId)?.destroy();
    audioPlayers.get(guildId)?.stop();
  } catch (error) {
    console.error('Error en cleanup:', error);
  } finally {
    voiceConnections.delete(guildId);
    audioPlayers.delete(guildId);
    queues.delete(guildId);
  }
}

// Manejo de errores no capturados
process.on('unhandledRejection', error => {
  console.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('Uncaught Exception:', error);
});

// Iniciar el bot
client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error('Error al iniciar sesión:', error);
  process.exit(1);
});