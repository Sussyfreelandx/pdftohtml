# ── PDF Engine — Production Dockerfile ──────────────────────────────
# Uses system-installed Chromium (via apt-get) + puppeteer-core.
# This is the industry-standard approach for running Puppeteer on any
# cloud platform (Render, Railway, Fly.io, AWS, GCP, etc.).
# ────────────────────────────────────────────────────────────────────

FROM node:22-slim

# Install Chromium and its dependencies via apt-get.
# This is 100% reliable — no Puppeteer download issues, no cache path
# problems, no version mismatches.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
  && rm -rf /var/lib/apt/lists/*

# Tell puppeteer-core where Chromium lives
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files first (better Docker layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the rest of the application
COPY . .

# Expose the server port (Render sets PORT automatically)
EXPOSE 3000

CMD ["node", "src/start.js"]
