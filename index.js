const { FFmpeg } = require('ffmpeg-static');
process.env.FFMPEG_PATH = FFmpeg;
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const yts = require('yt-search');
const play = require('play-dl');
const express = require('express');
const app = express();
const port = 1995;

// Configura play-dl para evitar bloqueos
play.setToken({
  youtube: {
    cookie: process.env.YOUTUBE_COOKIE || ''
  }
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

// Configuración
const queues = new Map();
const audioPlayers = new Map();
const connections = new Map();

// Servidor web para UptimeRobot
app.get('/', (req, res) => res.send('Bot activo'));
app.listen(port, () => console.log(`Servidor en puerto ${port}`));

// Eventos del bot
client.once('ready', () => {
  console.log(`✅ ${client.user.tag} listo!`);
  client.user.setActivity('/play | YouTube Music', { type: 'LISTENING' });
});

// Funciones auxiliares
async function searchYouTube(query) {
  try {
    const { videos } = await yts(query);
    return videos.slice(0, 5);
  } catch (error) {
    console.error('Error en YouTube:', error);
    return [];
  }
}

async function playMusic(guildId, voiceChannel, song) {
  try {
    let connection = connections.get(guildId);
    
    if (!connection || connection.state.status === VoiceConnectionStatus.Disconnected) {
      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });
      connections.set(guildId, connection);
    }

    const player = createAudioPlayer();
    audioPlayers.set(guildId, player);
    connection.subscribe(player);

    // Configuración mejorada para play-dl
    const stream = await play.stream(song.url, {
      discordPlayerCompatibility: true,
      quality: 'lowestaudio',
      htmldata: false,
      precache: 1000,
      retry: 3
    });
    
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true
    });

    player.play(resource);

    player.on(AudioPlayerStatus.Idle, () => {
      const queue = queues.get(guildId);
      if (queue?.length > 0) {
        playMusic(guildId, voiceChannel, queue.shift());
      } else {
        setTimeout(() => {
          if (player.state.status === AudioPlayerStatus.Idle) {
            connection.destroy();
            connections.delete(guildId);
            audioPlayers.delete(guildId);
            queues.delete(guildId);
          }
        }, 300000);
      }
    });

    player.on('error', error => {
      console.error('Error en el reproductor:', error);
      const queue = queues.get(guildId);
      if (queue?.length > 0) {
        playMusic(guildId, voiceChannel, queue.shift());
      } else {
        connection.destroy();
        connections.delete(guildId);
        audioPlayers.delete(guildId);
        queues.delete(guildId);
      }
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch (error) {
        connection.destroy();
        connections.delete(guildId);
        audioPlayers.delete(guildId);
        queues.delete(guildId);
      }
    });

  } catch (error) {
    console.error('Error al reproducir:', error);
    const connection = connections.get(guildId);
    if (connection) {
      connection.destroy();
      connections.delete(guildId);
    }
    audioPlayers.delete(guildId);
  }
}

// Comandos (mantener igual que en la versión anterior)
// ... [El resto del código de comandos permanece igual]

client.login(process.env.DISCORD_TOKEN);