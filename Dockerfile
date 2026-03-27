FROM node:20-slim

# Install dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip curl ca-certificates ffmpeg && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp directly from GitHub (always latest version)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Verify
RUN yt-dlp --version

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY server.js .

EXPOSE 3000

CMD ["node", "server.js"]
