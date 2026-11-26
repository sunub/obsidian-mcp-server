# obsidian-mcp-server

Obsidian vault용 MCP 서버와 Claude Code 플러그인. TypeScript(ESM), Vitest, Biome.

## 명령어

- `npm run build`: `tsc` + `tsc-alias`. 타입 검사를 겸한다.
- `npm test`: Vitest. 단일 파일은 `npx vitest run tests/unit/<name>.test.ts`.
- `npm run check`: Biome format, lint, import 정렬을 한 번에 적용한다.

import alias는 `@/*`(src), `@shared/*`이다.

## 코드 규칙

### 코드에 주석을 쓰지 않는다

주석은 코드가 바뀌어도 함께 갱신되지 않아 곧 사실과 어긋난다. 의도는 이름, 타입, 함수 분리로 드러낸다. 설명이 꼭 필요하면 커밋 메시지나 `docs/`에 쓴다.

예외는 도구가 읽는 지시문(`biome-ignore`, `@ts-expect-error`)뿐이며, 이유를 한 줄로 붙인다. 기존 주석은 해당 코드를 수정할 때 함께 지운다.

### 기능마다 폴더 하나

한 기능의 코드, 타입, 파라미터 스키마, 보조 함수는 그 기능의 폴더 안에 둔다. `src/tools/<tool>/`이 기준 형태다. 기능을 지우려면 폴더 하나만 지우면 되는 상태를 유지한다. 테스트는 `tests/unit/`에 둔다.

여러 기능이 쓰는 코드는 기능 폴더에 두지 않고 아래 `shared`로 옮긴다. shared는 `src/shared/<역할>/` 폴더로 나눈다. 역할이 드러나지 않는 `utils` 같은 폴더를 만들지 않는다.

### import 금지 규칙은 엄격하게 지킨다

기능 폴더가 import할 수 있는 대상은 세 가지뿐이다.

- 자기 폴더 안의 파일
- `@shared/*`
- 외부 패키지

다른 기능 폴더를 import하지 않는다. 그럴 필요가 생기면 필요한 코드를 `src/shared/`로 옮겨 양쪽이 `@shared/*`로 쓰게 한다. 기능 사이를 직접 잇는 편이 짧아 보여도, 그렇게 쌓인 의존이 순환과 삭제 불가능한 코드를 만든다.

- `src/shared/`는 기능 폴더를 import하지 않는다. 의존 방향은 기능, 그다음 shared 한 방향이다.
- 옮길 때는 두 번째 사용처가 실제로 생긴 시점에 옮긴다. 쓸 일이 생길지 모르는 코드를 미리 shared에 넣지 않는다.
- shared에 추가한 코드는 순환이 생기지 않았는지 `npm run build`로 확인한다.

기존 코드의 도구 간 직접 import는 이 규칙 이전에 만들어졌다. 건드리는 파일에서만 규칙에 맞게 고치고, 규칙 때문에 관련 없는 파일을 대규모로 바꾸지 않는다.
