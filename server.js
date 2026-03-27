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
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  // Try multiple clients - some bypass YouTube bot detection better than others
  const tryClient = (clients, idx) => {
    if (idx >= clients.length) {
      return res.status(500).json({ error: 'All clients failed' });
    }
    const client = clients[idx];
    const args = [
      url,
      '-f', 'bestaudio[ext=m4a]/bestaudio',
      '--get-url',
      '--no-playlist',
      '--quiet',
      '--no-warnings',
      '--extractor-args', `youtube:player_client=${client}`
    ];
    execFile('yt-dlp', args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err || !stdout.trim()) {
        console.warn(`Client '${client}' failed: ${stderr?.substring(0,100)}, trying next...`);
        return tryClient(clients, idx + 1);
      }
      const audioUrl = stdout.trim().split('\n')[0];
      console.log(`Got URL via '${client}' for ${videoId}`);
      res.json({ url: audioUrl, videoId });
    });
  };

  tryClient(['ios', 'android', 'android_embedded', 'web_creator'], 0);
});


// ── Debug endpoint ──────────────────────────────────────────────
app.get('/api/debug/:videoId', (req, res) => {
  const { videoId } = req.params;
  execFile('yt-dlp', [
    `https://www.youtube.com/watch?v=${videoId}`,
    '--get-title', '--quiet',
    '--extractor-args', 'youtube:player_client=android'
  ], { timeout: 30000 }, (err, stdout, stderr) => {
    res.json({ success: !err, stdout: stdout?.trim(), stderr: stderr?.substring(0,500), code: err?.code });
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

// ── Audio proxy (Native Node stream, fixes 416 & 403 errors) ───
const https = require('https');

app.get('/api/stream/:videoId', (req, res) => {
  const { videoId } = req.params;
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  console.log(`\n▶️ Proxy stream requested for: ${videoId}`);

  // 1. Get raw URL via yt-dlp (fast) with robust iOS client bypass
  // iOS client bypasses the HTTP 429 Too Many Requests bot block
  const args = [
    url,
    '-f', 'bestaudio',
    '--get-url',
    '--no-playlist',
    '--quiet',
    '--no-warnings'
  ];

  execFile('yt-dlp', args, { timeout: 25000 }, (err, stdout, stderr) => {
    if (err || !stdout.trim()) {
      console.error('yt-dlp proxy error:', stderr?.substring(0, 150));
      return res.status(500).send(`Extractor failed: ${err?.message} | ${stderr}`);
    }

    const audioUrl = stdout.trim().split('\n')[0];
    if (!audioUrl.startsWith('http')) return res.status(500).send('Invalid URL');
    
    console.log(`✅ Got audio URL for ${videoId}, initiating native pipe...`);

    // 2. Set up headers for ExoPlayer
    const options = {
      headers: {}
    };
    
    // Pass the Range header perfectly to support seek/partial load in ExoPlayer
    if (req.headers.range) {
      options.headers['Range'] = req.headers.range;
    }

    // 3. Pipe the audio natively via HTTP GET
    const proxyReq = https.get(audioUrl, options, (proxyRes) => {
      // Pass crucial ExoPlayer HTTP headers back
      const headersToForward = [
        'content-type', 'content-length', 'content-range', 
        'accept-ranges', 'transfer-encoding'
      ];
      
      headersToForward.forEach(h => {
        if (proxyRes.headers[h]) res.setHeader(h, proxyRes.headers[h]);
      });

      res.status(proxyRes.statusCode);

      // Pipe data natively
      proxyRes.pipe(res);
      
      proxyRes.on('end', () => console.log(`⏩ Finished streaming ${videoId}`));
    });

    proxyReq.on('error', (e) => {
      console.error(`Proxy Request Error for ${videoId}:`, e.message);
      if (!res.headersSent) res.status(500).send('Proxy failed');
    });

    // Handle client disconnects to kill the proxy upstream
    req.on('close', () => {
      proxyReq.destroy();
    });
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
