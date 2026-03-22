const express = require('express');
const cors = require('cors');
const { execFile, spawn } = require('child_process');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Health Check ────────────────────────────────────────────────
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', name: 'ReproMusic Cloud', version: '3.0' });
});

// ── Get raw audio URL ───────────────────────────────────────────
app.get('/api/audio-url/:videoId', (req, res) => {
  const { videoId } = req.params;
  execFile('yt-dlp', [
    `https://www.youtube.com/watch?v=${videoId}`,
    '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
    '--get-url', '--no-playlist', '--quiet', '--no-warnings'
  ], { timeout: 25000 }, (err, stdout) => {
    if (err) return res.status(500).json({ error: 'Failed' });
    const audioUrl = stdout.trim().split('\n')[0];
    if (!audioUrl) return res.status(500).json({ error: 'No URL' });
    res.json({ url: audioUrl, videoId });
  });
});

// ── YouTube Search ──────────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing q' });

  execFile('yt-dlp', [
    `ytsearch10:${query}`, '--dump-json', '--default-search', 'ytsearch',
    '--no-playlist', '--flat-playlist', '--skip-download', '--quiet', '--no-warnings'
  ], { maxBuffer: 1024 * 1024 * 10, timeout: 30000 }, (err, stdout) => {
    if (err) return res.status(500).json({ error: 'Search failed' });
    try {
      const results = stdout.trim().split('\n').filter(l => l.trim()).map(line => {
        const data = JSON.parse(line);
        return {
          id: data.id, title: data.title || 'Unknown',
          artist: data.uploader || data.channel || 'Unknown',
          duration: data.duration || 0,
          thumbnail: data.thumbnail || data.thumbnails?.[data.thumbnails.length - 1]?.url || '',
        };
      });
      res.json(results);
    } catch (e) { res.status(500).json({ error: 'Parse failed' }); }
  });
});

// ── Audio streaming (yt-dlp pipe, no ffmpeg needed) ─────────────
// yt-dlp downloads and pipes audio bytes directly to the response.
// ExoPlayer can handle m4a/webm natively.
app.get('/api/stream/:videoId', (req, res) => {
  const { videoId } = req.params;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  console.log(`Stream: ${videoId}`);

  // Use yt-dlp to pipe audio directly to stdout (no ffmpeg!)
  const ytdlp = spawn('yt-dlp', [
    url,
    '-f', 'bestaudio[ext=m4a]/bestaudio',
    '-o', '-',
    '--no-playlist',
    '--quiet',
    '--no-warnings',
    '--no-part'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  let headersSent = false;
  let stderrData = '';

  ytdlp.stderr.on('data', (chunk) => {
    stderrData += chunk.toString();
  });

  ytdlp.stdout.on('data', (chunk) => {
    if (!headersSent) {
      headersSent = true;
      res.setHeader('Content-Type', 'audio/mp4');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('Access-Control-Allow-Origin', '*');
      console.log(`Streaming ${videoId}...`);
    }
    res.write(chunk);
  });

  ytdlp.on('close', (code) => {
    if (!headersSent) {
      console.error(`yt-dlp failed (${code}): ${stderrData}`);
      res.status(500).json({ error: 'Stream failed', details: stderrData.substring(0, 200) });
    } else {
      res.end();
      console.log(`Done streaming ${videoId}`);
    }
  });

  ytdlp.on('error', (err) => {
    console.error('yt-dlp spawn error:', err.message);
    if (!headersSent) res.status(500).json({ error: 'Spawn failed' });
  });

  req.on('close', () => {
    ytdlp.kill('SIGTERM');
  });
});

// ── Root ─────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'ReproMusic Cloud Server', version: '3.0',
    endpoints: ['/api/ping', '/api/search?q=', '/api/audio-url/:videoId', '/api/stream/:videoId']
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 ReproMusic Cloud v3.0 on port ${PORT}`);
});
