FROM node:lts-alpine AS builder
WORKDIR /app

COPY ./package.json ./package-lock.json ./tsconfig.json ./

COPY src ./src
RUN npm install && npm run build

FROM node:lts-alpine

RUN npm ci --ignore-scripts
WORKDIR /app

COPY --from=builder /app/build ./build

COPY package.json ./

RUN npm install --production --ignore-scripts

ENTRYPOINT ["node", "build/index.js"]