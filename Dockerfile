FROM oven/bun:1 AS builder
WORKDIR /app

# 루트 및 패키지 설정 파일 복사
COPY package.json bun.lock ./
COPY packages/core/package.json ./packages/core/
COPY packages/cli/package.json ./packages/cli/
COPY packages/server/package.json ./packages/server/

RUN bun install --frozen-lockfile

COPY . .

# 빌드 전 테스트 수행 (실패 시 빌드 중단)
# 테스트에 필요한 최소한의 환경 변수를 주입합니다.
RUN VAULT_PATH=/tmp/test-vault bun test

RUN bun run build

# === STAGE 2: Final Image ===
FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production

# 모노레포 워크스페이스 구조 유지를 위해 설정 파일 복사
COPY --from=builder /app/package.json /app/bun.lock ./
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/server/package.json ./packages/server/
COPY --from=builder /app/packages/cli/package.json ./packages/cli/

# 실제 실행에 필요한 빌드 결과물만 복사
COPY --from=builder /app/packages/core/build ./packages/core/build/
COPY --from=builder /app/packages/server/build ./packages/server/build/

# 운영 의존성 설치 (Debian 환경으로 네이티브 모듈 호환성 확보)
RUN bun install --production --frozen-lockfile

ENTRYPOINT ["bun", "packages/server/build/index.js"]
