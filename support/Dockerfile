FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

ENV TZ=Europe/Paris
CMD ["node", "src/index.js"]
