FROM node:20-slim

# Install yt-dlp, ffmpeg, python3
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 python3-pip curl && \
    pip3 install --break-system-packages yt-dlp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY server.js .

EXPOSE 3000

CMD ["node", "server.js"]
