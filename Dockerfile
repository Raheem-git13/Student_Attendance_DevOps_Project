FROM node:22-bookworm-slim

WORKDIR /app

# Install tools required to compile SQLite
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Compile SQLite for this Linux environment
RUN npm_config_build_from_source=true npm install --omit=dev

# Copy application files
COPY . .

EXPOSE 3000

CMD ["npm", "start"]