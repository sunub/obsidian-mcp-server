# === STAGE 1: Builder ===
# 빌드에 필요한 모든 의존성을 설치하고 코드를 컴파일합니다.
FROM node:lts-alpine AS builder

WORKDIR /app

# 1. 의존성 관련 파일만 먼저 복사하여 Docker 캐시를 최대한 활용합니다.
COPY package.json package-lock.json ./

# 2. package-lock.json을 기반으로 모든 의존성(dev 포함)을 설치합니다.
RUN npm ci --ignore-scripts

# 3. 소스 코드와 설정 파일을 복사합니다.
COPY ./src ./src
COPY ./tsconfig.json ./

# 4. TypeScript 코드를 JavaScript로 빌드합니다.
RUN npm run build

# === STAGE 2: Final Image ===
# 빌드된 결과물과 운영에 필요한 의존성만 포함하여 이미지를 가볍게 만듭니다.
FROM node:lts-alpine

WORKDIR /app

# 5. Builder 스테이지에서 빌드된 결과물만 가져옵니다.
COPY --from=builder /app/build ./build

# 6. 의존성 설치에 필요한 파일을 다시 복사합니다.
COPY --from=builder /app/package.json /app/package-lock.json ./

# 7. 개발용 의존성을 제외하고, 운영용(production) 의존성만 설치합니다.
RUN npm ci --omit=dev --ignore-scripts

# 8. 애플리케이션을 실행합니다.
ENTRYPOINT ["node", "build/index.js"]