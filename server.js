const express = require('express');
const cors = require('cors');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Temporary downloads directory (cloud ephemeral storage)
const DOWNLOADS_DIR = path.join(os.tmpdir(), 'repromusic-downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

app.use(cors());
app.use(express.json());

// ── Health Check ────────────────────────────────────────────────
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', name: 'ReproMusic Cloud', version: '2.0' });
});

// ── Get raw audio URL (for Android app ExoPlayer) ───────────────
app.get('/api/audio-url/:videoId', (req, res) => {
  const { videoId } = req.params;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const args = [
    url,
    '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
    '--get-url',
    '--no-playlist',
    '--quiet',
    '--no-warnings'
  ];

  execFile('yt-dlp', args, { timeout: 25000 }, (err, stdout) => {
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

  const args = [
    `ytsearch10:${query}`,
    '--dump-json',
    '--default-search', 'ytsearch',
    '--no-playlist',
    '--flat-playlist',
    '--skip-download',
    '--quiet',
    '--no-warnings'
  ];

  execFile('yt-dlp', args, { maxBuffer: 1024 * 1024 * 10, timeout: 30000 }, (err, stdout) => {
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
    } catch (parseErr) {
      console.error('Parse error:', parseErr.message);
      res.status(500).json({ error: 'Failed to parse results' });
    }
  });
});

// ── Audio streaming (proxy) ─────────────────────────────────────
app.get('/api/stream/:videoId', (req, res) => {
  const { videoId } = req.params;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const args = [
    url,
    '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
    '--get-url',
    '--no-playlist',
    '--quiet',
    '--no-warnings'
  ];

  execFile('yt-dlp', args, { timeout: 20000 }, (err, stdout) => {
    if (err) {
      console.error('Stream URL error:', err.message);
      return res.status(500).json({ error: 'Failed to get stream URL' });
    }

    const audioUrl = stdout.trim().split('\n')[0];
    if (!audioUrl) return res.status(500).json({ error: 'No audio URL found' });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    const ffmpeg = spawn('ffmpeg', [
      '-i', audioUrl,
      '-vn',
      '-acodec', 'libmp3lame',
      '-ab', '192k',
      '-f', 'mp3',
      '-'
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    ffmpeg.stdout.pipe(res);
    ffmpeg.stderr.on('data', () => {});

    ffmpeg.on('error', (err) => {
      console.error('FFmpeg error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Stream failed' });
    });

    req.on('close', () => ffmpeg.kill('SIGTERM'));
  });
});

// ── Root ─────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'ReproMusic Cloud Server',
    version: '2.0',
    endpoints: ['/api/ping', '/api/search?q=', '/api/audio-url/:videoId', '/api/stream/:videoId']
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 ReproMusic Cloud running on port ${PORT}`);
});
