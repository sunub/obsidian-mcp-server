refactor: 프로젝트 구조 모노레포 전환 및 코드 품질 개선

변경 배경:
- 단일 패키지 구조에서 CLI와 서버 간의 의존성이 복잡해지고 공통 코드(타입, 유틸리티 등) 관리가 어려워짐에 따라, 모듈성을 강화하고 유지보수 효율을 높이기 위해 모노레포로 전환을 수행했습니다.
- Node.js ESM 환경에서의 모듈 해석 이슈를 해결하고, 프로젝트 전반의 타입 안정성과 코드 품질을 확보하기 위해 수행되었습니다.

주요 변경 사항:

1. 프로젝트 구조 모노레포 재편
- packages/cli: Ink 프레임워크 기반의 인터랙티브 CLI 에이전트 로직을 분리했습니다.
- packages/server: Obsidian 금고 관리 및 RAG(Retrieval-Augmented Generation) 엔진을 담당하는 MCP 서버 로직을 분리했습니다.
- packages/core: 공통 설정 스키마(Zod), 디버그 로거, 공통 타입 정의 등 패키지 간 공유가 필요한 핵심 로직을 별도 패키지로 추출했습니다.

2. 의존성 및 빌드 설정 최적화
- 루트 package.json에 workspaces를 설정하여 패키지 간 의존성 관리를 자동화했습니다.
- tsconfig.base.json을 도입하여 공통 TS 설정을 관리하고, @cli, @server, @sunub/core 등의 경로 별칭(Path Alias)을 설정하여 임포트 구조를 개선했습니다.
- 각 패키지의 tsconfig.json에 @sunub/core 등 워크스페이스 패키지명에 대한 경로 매핑을 추가하여 빌드 시 모듈 해석 오류를 해결했습니다.
- packages/server의 prepare 스크립트를 제거하여 의존성 패키지 빌드 전 install 단계에서 발생하는 빌드 오류를 방지했습니다.
- Node.js ESM의 모듈 해석 방식에 따른 ERR_MODULE_NOT_FOUND 이슈를 분석하고 패키지 구조를 조정했습니다.

3. 코드 품질 개선 및 린트 수정 (Biome 도입)
- 타입 안정성 확보: any 타입을 제거하고 RagPayload, RagDocument, DispatchResult 등 명시적인 인터페이스를 정의하여 타입 체크를 강화했습니다.
- 안정성 강화: Non-null assertion(!)을 제거하고 명시적인 에러 체크 루틴을 추가하여 런타임 에러 가능성을 줄였습니다.
- UI 버그 수정: React 컴포넌트(InputPrompt-bestcase.tsx)에서 배열 인덱스를 key로 사용하여 발생하던 린트 오류를 고유 식별자 조합으로 수정했습니다.
- 코드 일관성: Biome을 통해 프로젝트 전반의 린트 오류를 해결하고 포맷팅을 통일했습니다.

4. CI/CD 및 테스트 환경 개선
- .github/workflows/ci.yml을 모노레포 구조에 맞게 수정하여 패키지별 빌드 및 배포가 가능하도록 개선했습니다.
- 테스트 시 발생하는 자원 경합 문제를 해결하기 위해 고유한 테스트 금고 경로를 사용하도록 수정하고 타임아웃을 조정했습니다.
- CLI 테스트에서 발생하던 'configSchema.safeParse is not a function' 오류를 해결하기 위해 Vitest 모킹 로직을 최신 인터페이스에 맞게 업데이트했습니다.
- packages/core의 순환 참조(Circular Export) 문제를 해결하여 런타임 및 테스트 환경에서의 모듈 해석 안정성을 높였습니다.
