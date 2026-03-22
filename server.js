const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const https = require('https');
const http = require('http');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Health Check ────────────────────────────────────────────────
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', name: 'ReproMusic Cloud', version: '2.1' });
});

// ── Get raw audio URL ───────────────────────────────────────────
app.get('/api/audio-url/:videoId', (req, res) => {
  const { videoId } = req.params;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  execFile('yt-dlp', [
    url, '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
    '--get-url', '--no-playlist', '--quiet', '--no-warnings'
  ], { timeout: 25000 }, (err, stdout) => {
    if (err) {
      console.error('Audio URL error:', err.message);
      return res.status(500).json({ error: 'Failed to get audio URL' });
    }
    const audioUrl = stdout.trim().split('\n')[0];
    if (!audioUrl) return res.status(500).json({ error: 'No audio URL found' });
    res.json({ url: audioUrl, videoId });
  });
});

// ── YouTube Search ──────────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing query parameter q' });

  execFile('yt-dlp', [
    `ytsearch10:${query}`, '--dump-json', '--default-search', 'ytsearch',
    '--no-playlist', '--flat-playlist', '--skip-download', '--quiet', '--no-warnings'
  ], { maxBuffer: 1024 * 1024 * 10, timeout: 30000 }, (err, stdout) => {
    if (err) {
      console.error('Search error:', err.message);
      return res.status(500).json({ error: 'Search failed' });
    }
    try {
      const results = stdout.trim().split('\n').filter(l => l.trim()).map(line => {
        const data = JSON.parse(line);
        return {
          id: data.id,
          title: data.title || 'Unknown',
          artist: data.uploader || data.channel || 'Unknown',
          duration: data.duration || 0,
          thumbnail: data.thumbnail || data.thumbnails?.[data.thumbnails.length - 1]?.url || '',
        };
      });
      res.json(results);
    } catch (e) {
      res.status(500).json({ error: 'Failed to parse results' });
    }
  });
});

// ── Audio streaming (raw proxy, NO ffmpeg) ──────────────────────
// Pipes raw audio bytes from YouTube through the server.
// ExoPlayer handles m4a/webm natively, no conversion needed.
app.get('/api/stream/:videoId', (req, res) => {
  const { videoId } = req.params;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  console.log(`Stream request: ${videoId}`);

  execFile('yt-dlp', [
    url, '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
    '--get-url', '--no-playlist', '--quiet', '--no-warnings'
  ], { timeout: 25000 }, (err, stdout) => {
    if (err) {
      console.error('Stream error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to get stream URL' });
      return;
    }

    const audioUrl = stdout.trim().split('\n')[0];
    if (!audioUrl) {
      if (!res.headersSent) res.status(500).json({ error: 'No audio URL found' });
      return;
    }

    console.log(`Proxying audio for ${videoId}...`);

    // Proxy raw bytes from YouTube → phone (no ffmpeg, no conversion)
    const getter = audioUrl.startsWith('https') ? https : http;
    const proxyHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'identity'
    };
    // Only forward Range header if client sent one
    if (req.headers.range) {
      proxyHeaders['Range'] = req.headers.range;
    }
    const proxyReq = getter.get(audioUrl, {
      headers: proxyHeaders
    }, (proxyRes) => {
      console.log(`YouTube responded: ${proxyRes.statusCode}, content-type: ${proxyRes.headers['content-type']}`);

      // Forward relevant headers
      const headers = {
        'Content-Type': proxyRes.headers['content-type'] || 'audio/mp4',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      };
      if (proxyRes.headers['content-length']) headers['Content-Length'] = proxyRes.headers['content-length'];
      if (proxyRes.headers['content-range']) headers['Content-Range'] = proxyRes.headers['content-range'];

      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (e) => {
      console.error('Proxy error:', e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Proxy failed' });
    });

    req.on('close', () => proxyReq.destroy());
  });
});

// ── Root ─────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'ReproMusic Cloud Server',
    version: '2.1',
    endpoints: ['/api/ping', '/api/search?q=', '/api/audio-url/:videoId', '/api/stream/:videoId']
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 ReproMusic Cloud running on port ${PORT}`);
});
