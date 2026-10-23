FROM node:18-slim

# Instalace FFmpeg pro přehrávání zvuku
RUN apt-get update && apt-get install -y ffmpeg python3 build-essential && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Spuštění registrace příkazů a následně bota
CMD node deploy-commands.js && node src/index.js
