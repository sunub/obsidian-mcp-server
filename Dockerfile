# === STAGE 1: Builder ===
# devDependencies까지 설치해 TypeScript를 컴파일하는 단계입니다.
# 최종 이미지에는 포함되지 않으므로 빌드 도구 용량을 신경 쓰지 않습니다.
FROM oven/bun:1.3-debian AS builder

WORKDIR /app

# 1. 의존성 기술 파일만 먼저 복사해 Docker 레이어 캐시를 활용합니다.
#    소스만 바뀐 경우 아래 install 레이어를 재사용합니다.
COPY package.json bun.lock ./

# 2. 락파일에 고정된 버전 그대로 설치합니다(재현 가능한 빌드).
#    --ignore-scripts: 이 시점에는 src/가 아직 없으므로 package.json의
#    prepare 스크립트(format && build)가 돌면 실패합니다. 빌드는 4번에서 명시적으로 수행합니다.
RUN bun install --frozen-lockfile --ignore-scripts

# 3. 컴파일에 필요한 소스와 설정만 복사합니다.
COPY tsconfig.json tsconfig.base.json ./
COPY ./src ./src

# 4. tsc + tsc-alias로 build/ 산출물을 만듭니다.
RUN bun run build

# === STAGE 2: Production dependencies ===
# 런타임에 필요한 의존성만 별도로 설치해 builder의 devDependencies와 분리합니다.
FROM oven/bun:1.3-debian AS deps

WORKDIR /app

COPY package.json bun.lock ./

# --production: devDependencies(typescript, vitest, biome 등) 제외
# --ignore-scripts: 소스가 없는 단계이므로 prepare 스크립트를 실행하지 않습니다.
RUN bun install --frozen-lockfile --production --ignore-scripts

# === STAGE 3: Runtime ===
# 실행에는 bun이 필요 없으므로 node slim 이미지를 사용합니다.
# lancedb / onnxruntime 등 네이티브 모듈이 glibc 기반이라 alpine(musl)은 피합니다.
FROM node:22-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

# 5. 빌드 산출물과 운영 의존성만 가져옵니다.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY package.json ./

# 6. 이 이미지(linux/x64, glibc)에서 절대 쓰이지 않는 타 플랫폼 네이티브 바이너리를 제거합니다.
#    bun/npm은 optionalDependencies로 여러 플랫폼 바이너리를 함께 설치하므로
#    런타임 이미지에서는 불필요한 용량입니다.
RUN rm -rf \
	node_modules/@lancedb/lancedb-linux-x64-musl \
	node_modules/onnxruntime-node/bin/napi-v6/darwin \
	node_modules/onnxruntime-node/bin/napi-v6/win32

# 7. root로 실행하지 않습니다. 모델 캐시는 이 사용자의 홈 디렉터리에 생성됩니다.
#    (src/utils/constants.ts의 MODELS_DIR = ~/.obsidian-mcp-server/models)
RUN useradd --create-home --shell /usr/sbin/nologin --uid 10001 mcp \
	&& mkdir -p /home/mcp/.obsidian-mcp-server/models \
	&& chown -R mcp:mcp /home/mcp/.obsidian-mcp-server

USER mcp

# HOME을 명시하지 않으면 os.homedir()가 런타임에 따라 다른 경로를 반환할 수 있어
# 모델 캐시 위치(MODELS_DIR)가 흔들립니다. 명시적으로 고정합니다.
ENV HOME=/home/mcp

# 8. 임베딩/리랭커 모델 캐시는 재시작해도 유지되도록 볼륨으로 분리합니다.
#    이미지에 모델을 굽지 않기 때문에 이미지 크기가 작게 유지됩니다.
VOLUME ["/home/mcp/.obsidian-mcp-server"]

# 9. Vault 경로는 실행 시 마운트해서 주입합니다.
#    docker run -i --rm -v /path/to/vault:/vault -e VAULT_DIR_PATH=/vault <image>
ENV VAULT_DIR_PATH=/vault

# stdio 기반 MCP 서버이므로 포트를 열지 않고 stdin/stdout으로 통신합니다.
ENTRYPOINT ["node", "build/index.js"]
