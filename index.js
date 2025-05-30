const { FFmpeg } = require('ffmpeg-static');
process.env.FFMPEG_PATH = FFmpeg;
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const yts = require('yt-search');
const play = require('play-dl');
const express = require('express');
const app = express();
const port = 1995;

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

    const stream = await play.stream(song.url, {
      discordPlayerCompatibility: true,
      quality: 2
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

// Comandos
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'play') {
    await interaction.deferReply();
    const query = interaction.options.getString('query');

    if (!query) {
      return interaction.editReply('Usa: /play <nombre o enlace de YouTube>');
    }

    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      return interaction.editReply('¡Entra a un canal de voz primero!');
    }

    // Verificar si es una URL válida
    let isUrl = false;
    try {
      new URL(query);
      isUrl = true;
    } catch (e) {
      isUrl = false;
    }

    // Manejo de enlaces directos
    if (isUrl) {
      try {
        if (!query.includes('youtube.com') && !query.includes('youtu.be')) {
          return interaction.editReply('❌ Solo se aceptan enlaces de YouTube');
        }

        const songInfo = await play.video_info(query);
        const song = {
          title: songInfo.video_details?.title || 'Canción de YouTube',
          url: query,
          platform: 'youtube'
        };

        if (!queues.has(interaction.guild.id)) {
          queues.set(interaction.guild.id, []);
        }

        queues.get(interaction.guild.id).push(song);

        if (!audioPlayers.has(interaction.guild.id) || 
            audioPlayers.get(interaction.guild.id).state.status === AudioPlayerStatus.Idle) {
          playMusic(interaction.guild.id, voiceChannel, song);
        }

        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#FF0000')
              .setTitle('🎵 Añadido a la cola')
              .setDescription(`[${song.title}](${query})`)
              .setFooter({ text: 'Plataforma: YOUTUBE 🔴' })
          ]
        });
      } catch (error) {
        console.error('Error al procesar enlace:', error);
        return interaction.editReply('❌ Error al procesar el enlace de YouTube');
      }
    }

    // Búsqueda por texto
    const results = await searchYouTube(query);
    if (results.length === 0) {
      return interaction.editReply('No encontré resultados en YouTube 😢');
    }

    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle(`🔍 Resultados de YouTube para "${query}"`)
      .setDescription('Elige una canción:');

    results.forEach((result, index) => {
      embed.addFields({
        name: `${index + 1}. ${result.title}`,
        value: `Duración: ${result.duration.timestamp || 'N/A'} | [Ver](${result.url})`,
        inline: false
      });
    });

    const row = new ActionRowBuilder().addComponents(
      ...results.slice(0, 5).map((_, index) =>
        new ButtonBuilder()
          .setCustomId(`play_${index}`)
          .setLabel(`Opción ${index + 1}`)
          .setStyle(ButtonStyle.Primary)
      )
    );

    await interaction.editReply({ embeds: [embed], components: [row] });

    const filter = i => i.customId.startsWith('play_') && i.user.id === interaction.user.id;
    const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

    collector.on('collect', async i => {
      const index = parseInt(i.customId.split('_')[1]);
      const selected = results[index];

      const song = {
        title: selected.title,
        url: selected.url,
        platform: 'youtube'
      };

      if (!queues.has(interaction.guild.id)) {
        queues.set(interaction.guild.id, []);
      }

      queues.get(interaction.guild.id).push(song);

      if (!audioPlayers.has(interaction.guild.id) || 
          audioPlayers.get(interaction.guild.id).state.status === AudioPlayerStatus.Idle) {
        playMusic(interaction.guild.id, voiceChannel, song);
      }

      await i.update({
        embeds: [
          new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Añadido a la cola')
            .setDescription(`[${selected.title}](${selected.url})`)
        ],
        components: []
      });
      collector.stop();
    });

    collector.on('end', collected => {
      if (collected.size === 0) {
        interaction.editReply({ content: 'Tiempo agotado', components: [] });
      }
    });
  }
});

client.login(process.env.DISCORD_TOKEN);