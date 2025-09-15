FROM node:alpine@sha256:be4d5e92ac68483ec71440bf5934865b4b7fcb93588f17a24d411d15f0204e4f AS builder

RUN apk add --no-cache openssl=3.5.2-r0

WORKDIR /app

COPY ./package.json ./package.json
COPY ./package-lock.json ./package-lock.json

RUN npm ci --ignore-scripts

COPY ./src ./src
COPY ./tsconfig.json ./tsconfig.json

RUN npm run build

FROM node:alpine@sha256:be4d5e92ac68483ec71440bf5934865b4b7fcb93588f17a24d411d15f0204e4f AS release

RUN apk add --no-cache openssl=3.5.2-r0

WORKDIR /app

COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/package-lock.json /app/package-lock.json

ENV NODE_ENV=production

RUN npm ci --ignore-scripts --omit-dev

USER node

CMD ["node", "./build/index.js"]
