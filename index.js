const express = require('express');
const { Deezer } = require('deezer-public-api');
const SpotifyWebApi = require('spotify-web-api-node');
const axios = require('axios');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');

const app = express();
app.use(express.json());

// Configuración de APIs
const YOUTUBE_API_URL = process.env.YOUTUBE_API_URL || "https://your-youtube-api.com";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "your-api-key";
const DEEZER_APP_ID = process.env.DEEZER_APP_ID || "your-deezer-app-id";
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "your-spotify-client-id";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "your-spotify-client-secret";

// Inicialización de clientes
const deezer = new Deezer();
const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIFY_CLIENT_ID,
  clientSecret: SPOTIFY_CLIENT_SECRET
});

// Middleware para autenticación de Spotify
async function authenticateSpotify() {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body['access_token']);
    console.log('Spotify authenticated successfully');
  } catch (err) {
    console.error('Error authenticating with Spotify:', err.message);
  }
}

// Autenticar al iniciar
authenticateSpotify();
setInterval(authenticateSpotify, 55 * 60 * 1000); // Refrescar token cada 55 minutos

// Función para buscar en múltiples plataformas
app.get('/search', async (req, res) => {
  try {
    const { query, limit = 5, platforms = 'youtube,spotify,deezer' } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const platformList = platforms.split(',');
    const results = await multiPlatformSearch(query, parseInt(limit), platformList);

    res.json({
      success: true,
      results: results.map(item => ({
        ...item,
        platform_icon: getPlatformIcon(item.platform)
      }))
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// Función principal de búsqueda
async function multiPlatformSearch(query, limit, platforms) {
  const results = [];

  for (const platform of platforms) {
    try {
      switch (platform.toLowerCase()) {
        case 'youtube':
          const ytResults = await searchYouTube(query, limit);
          results.push(...ytResults.map(r => ({ ...r, platform: 'youtube' })));
          break;
        case 'spotify':
          const spResults = await searchSpotify(query, limit);
          results.push(...spResults.map(r => ({ ...r, platform: 'spotify' })));
          break;
        case 'deezer':
          const dzResults = await searchDeezer(query, limit);
          results.push(...dzResults.map(r => ({ ...r, platform: 'deezer' })));
          break;
      }
    } catch (err) {
      console.error(`Error searching ${platform}:`, err.message);
    }
  }

  // Ordenar por relevancia (simplificado)
  return results.sort((a, b) => b.popularity - a.popularity).slice(0, limit);
}

// Iconos para cada plataforma
function getPlatformIcon(platform) {
  const icons = {
    youtube: '▶️',
    spotify: '🟢',
    deezer: '🔷'
  };
  return icons[platform.toLowerCase()] || '🎵';
}

// Búsqueda en YouTube usando tu API
async function searchYouTube(query, limit) {
  try {
    const response = await axios.get(`${YOUTUBE_API_URL}/search`, {
      params: {
        q: query,
        maxResults: limit,
        key: YOUTUBE_API_KEY,
        type: 'video',
        part: 'snippet'
      }
    });

    return response.data.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      url: `https://youtube.com/watch?v=${item.id.videoId}`,
      thumbnail: item.snippet.thumbnails?.medium?.url,
      description: item.snippet.description,
      channel: item.snippet.channelTitle,
      popularity: 100 // Valor ficticio para ordenamiento
    }));
  } catch (err) {
    throw new Error(`YouTube search failed: ${err.message}`);
  }
}

// Búsqueda en Spotify
async function searchSpotify(query, limit) {
  try {
    const response = await spotifyApi.searchTracks(query, { limit });
    return response.body.tracks.items.map(track => ({
      id: track.id,
      title: track.name,
      url: track.external_urls.spotify,
      thumbnail: track.album.images[0]?.url,
      artist: track.artists.map(a => a.name).join(', '),
      duration: track.duration_ms / 1000,
      popularity: track.popularity
    }));
  } catch (err) {
    throw new Error(`Spotify search failed: ${err.message}`);
  }
}

// Búsqueda en Deezer (no requiere API key pública)
async function searchDeezer(query, limit) {
  try {
    const response = await axios.get(`https://api.deezer.com/search`, {
      params: { q: query, limit }
    });

    return response.data.data.map(track => ({
      id: track.id,
      title: track.title,
      url: track.link,
      thumbnail: track.album.cover_medium,
      artist: track.artist.name,
      duration: track.duration,
      popularity: track.rank
    }));
  } catch (err) {
    throw new Error(`Deezer search failed: ${err.message}`);
  }
}

// Endpoint para obtener información de un video
app.get('/video/:id', async (req, res) => {
  try {
    const videoId = req.params.id;
    const videoInfo = await getVideoInfo(videoId);
    res.json({ success: true, data: videoInfo });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get video info', details: err.message });
  }
});

async function getVideoInfo(videoId) {
  try {
    // Usar tu API de YouTube
    const response = await axios.get(`${YOUTUBE_API_URL}/videos/${videoId}?key=${YOUTUBE_API_KEY}`);
    return formatVideoData(response.data);
  } catch (err) {
    // Fallback a ytdl-core si tu API falla
    console.log('Falling back to ytdl-core');
    const info = await ytdl.getInfo(videoId);
    return {
      id: info.videoDetails.videoId,
      title: info.videoDetails.title,
      url: info.videoDetails.video_url,
      duration: parseInt(info.videoDetails.lengthSeconds),
      thumbnail: info.videoDetails.thumbnails.pop().url,
      channel: info.videoDetails.author.name
    };
  }
}

// Endpoint para streaming de audio
app.get('/stream/:id', async (req, res) => {
  try {
    const videoId = req.params.id;
    const quality = req.query.quality || 'highestaudio';
    
    // Configurar headers para streaming
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    
    // Crear stream de audio
    const audioStream = ytdl(videoId, {
      filter: 'audioonly',
      quality: quality
    });
    
    // Convertir a MP3 usando ffmpeg
    const ffmpegStream = ffmpeg(audioStream)
      .audioBitrate(128)
      .format('mp3')
      .on('error', err => {
        console.error('FFmpeg error:', err);
        if (!res.headersSent) {
          res.status(500).end();
        }
      });
    
    // Pipe al response
    const stream = new PassThrough();
    ffmpegStream.pipe(stream).pipe(res);
    
    // Manejar errores
    audioStream.on('error', err => {
      console.error('YouTube stream error:', err);
      if (!res.headersSent) {
        res.status(500).end();
      }
    });
    
  } catch (err) {
    console.error('Stream error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream failed', details: err.message });
    }
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Supported platforms: YouTube, Spotify, Deezer`);
});

// Exportar para testing
module.exports = {
  app,
  multiPlatformSearch,
  searchYouTube,
  searchSpotify,
  searchDeezer
};
