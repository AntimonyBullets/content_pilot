FROM node:22-bookworm

# Install FFmpeg and FFprobe
RUN apt-get update \
    && apt-get install -y ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better Docker layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy backend source
COPY . .

ENV NODE_ENV=production

EXPOSE 5000

CMD ["npm", "start"]