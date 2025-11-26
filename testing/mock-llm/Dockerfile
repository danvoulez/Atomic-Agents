FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --production

# Copy source
COPY src/ ./src/
COPY scenarios/ ./scenarios/

EXPOSE 8000

CMD ["node", "src/server.js"]

