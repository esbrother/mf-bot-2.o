// [Parte inicial del código se mantiene igual hasta handlePlayCommand...]

async function handlePlayCommand(interaction) {
  await interaction.deferReply();

  const query = interaction.options.getString('query');
  const voiceChannel = interaction.member?.voice?.channel;

  if (!voiceChannel) {
    return interaction.editReply('🔇 Debes estar en un canal de voz primero.');
  }

  // Verificar si es un link directo
  if (play.yt_validate(query) || query.includes('youtube.com') || query.includes('youtu.be')) {
    // Es YouTube, procesar directamente
    try {
      const song = await getYoutubeSong(query);
      if (!song) return interaction.editReply('❌ No se encontró el video en YouTube.');
      
      return addToQueue(interaction, song, 'youtube');
    } catch (error) {
      return interaction.editReply('❌ Error al procesar el link de YouTube.');
    }
  }

  // Mostrar selector solo para búsquedas
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('youtube')
      .setLabel('YouTube')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('spotify')
      .setLabel('Spotify')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!process.env.SPOTIFY_TOKEN) // Deshabilitar si no hay token
  );

  const platformMessage = await interaction.editReply({
    content: '🎵 Selecciona la plataforma para buscar:',
    components: [row]
  });

  const collector = platformMessage.createMessageComponentCollector({ time: 15000 });

  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: '❌ Solo quien ejecutó el comando puede seleccionar.', ephemeral: true });
    }

    try {
      let song;
      if (i.customId === 'youtube') {
        song = await getYoutubeSong(query);
      } else if (i.customId === 'spotify' && process.env.SPOTIFY_TOKEN) {
        song = await getSpotifySong(query);
      }

      if (!song) {
        return i.update({ content: '❌ No se encontró la canción.', components: [] });
      }

      await addToQueue(interaction, song, i.customId);
      i.update({ content: '', components: [] });
    } catch (error) {
      console.error('Error:', error);
      i.update({ content: `❌ Error: ${error.message}`, components: [] });
    }
  });

  collector.on('end', collected => {
    if (collected.size === 0) {
      interaction.editReply({ content: '⏰ Tiempo agotado.', components: [] });
    }
  });
}

// Función auxiliar para añadir a la cola
async function addToQueue(interaction, song, platform) {
  if (!queues.has(interaction.guild.id)) {
    queues.set(interaction.guild.id, []);
  }
  queues.get(interaction.guild.id).push(song);

  const embed = new EmbedBuilder()
    .setColor(platform === 'youtube' ? '#FF0000' : '#1DB954')
    .setTitle(`🎵 Añadido a la cola (${platform.toUpperCase()})`)
    .setDescription(`[${song.title}](${song.url})`)
    .setThumbnail(song.thumbnail || null)
    .setFooter({ text: `Duración: ${song.duration}` });

  await interaction.editReply({ embeds: [embed], components: [] });

  if (!players.has(interaction.guild.id)) {
    await playMusic(interaction.guild.id, interaction.member.voice.channel);
  }
}

// [Las funciones getYoutubeSong y getSpotifySong se mantienen igual]

// Función de reproducción (faltante en la versión anterior)
async function playMusic(guildId, voiceChannel) {
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
    console.error('Player error:', error);
    cleanup(guildId);
  });

  await playNextTrack(guildId, player);
}

async function playNextTrack(guildId, player) {
  const queue = queues.get(guildId);
  if (!queue?.length) return cleanup(guildId);

  try {
    const song = queue[0];
    let stream;

    if (song.platform === 'spotify' && process.env.SPOTIFY_TOKEN) {
      // Convertir Spotify a YouTube
      const youtubeQuery = `${song.title} ${song.artist || ''}`.trim();
      const youtubeSong = await getYoutubeSong(youtubeQuery);
      if (!youtubeSong) throw new Error('No se pudo convertir a YouTube');
      
      stream = await play.stream(youtubeSong.url, {
        quality: 'lowestaudio',
        discordPlayerCompatibility: true
      });
    } else {
      // Reproducción normal de YouTube
      stream = await play.stream(song.url, {
        quality: 'lowestaudio',
        discordPlayerCompatibility: true
      });
    }

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true
    });

    player.play(resource);
  } catch (error) {
    console.error('PlayNext error:', error);
    if (error.message.includes('429')) {
      await new Promise(resolve => setTimeout(resolve, 30000));
      return playNextTrack(guildId, player);
    }
    handleIdlePlayer(guildId);
  }
}

async function handleIdlePlayer(guildId) {
  const queue = queues.get(guildId);
  if (queue?.length) {
    queue.shift();
    if (queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      await playNextTrack(guildId, players.get(guildId));
      return;
    }
  }
  setTimeout(() => cleanup(guildId), 180000); // 3 minutos de inactividad
}

function cleanup(guildId) {
  try {
    connections.get(guildId)?.destroy();
    players.get(guildId)?.stop();
  } finally {
    connections.delete(guildId);
    players.delete(guildId);
    queues.delete(guildId);
  }
}

// [El resto del código se mantiene igual]