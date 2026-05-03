# 대량 데이터 입력 및 전송 최적화 아키텍처 설계서 (상세 고도화)

프로젝트명: obsidian-mcp-server

## 설계 목적 (Intent)

1. 터미널의 Raw Mode 특성으로 인해 발생하는 '붙여넣기 시 다중 Enter 트리거(Input Storm)' 현상을 시스템(OS) 레벨에서 원천 차단.
2. 대량의 텍스트를 UI 렌더링 사이클에서 배제하여 프레임 드랍 및 메모리 누수 방지.
3. 로컬 파일 시스템(Obsidian Vault)의 강점을 활용하여 LLM 컨텍스트 윈도우 낭비를 막고 능동적 RAG 유도.

## 1.아키텍처 파이프라인 개요 (Pipeline Overview)

입력부터 전송까지 데이터는 다음 4단계를 거칩니다.
[터미널 스트림 캡처 (Phase 1)] ➔ [원자적 UI 상태 관리 (Phase 2)] ➔ [Vault 디스크 오프로딩 (Phase 3)] ➔ [최종 LLM 프롬프트 전송 및 GC (Phase 4)]

## 2. 상세 구현 계획 및 메서드 명세 (Detailed Plan)

### Phase 1: 터미널 프로토콜 동기화 (Bracketed Paste Guard)

의도: 단순히 입력 속도나 \n 포함 여부로 붙여넣기를 "추측"하지 않습니다. 터미널 표준 시퀀스를 이용해 붙여넣기의 시작과 끝을 100% 확실하게(Deterministic) 캡처합니다.

관련 파일: src/cli/utils/terminal.ts (신규/수정), src/cli/key/input.ts

구현 명세:

Bracketed Paste 모드 제어 유틸리티 (terminal.ts)

export const BracketedPaste = {
  enable: () => process.stdout.write('\x1b[?2004h'),
  disable: () => process.stdout.write('\x1b[?2004l'),
  START: '\x1b[200~',
  END: '\x1b[201~'
};

스트림 인터셉터 (State Machine in input.ts 또는 Context)
Ink의 useInput 이전에 원시 데이터를 가로채기 위해 stdin 이벤트 리스너를 강화합니다.

let isPasting = false;
let pasteBuffer = '';

process.stdin.on('data', (data: Buffer) => {
  const str = data.toString('utf-8');

  if (str.includes(BracketedPaste.START)) {
    isPasting = true;
    pasteBuffer = str.replace(BracketedPaste.START, ''); // 시작 태그 제거 후 버퍼링 시작
    return;
  }

  if (isPasting) {
    if (str.includes(BracketedPaste.END)) {
      isPasting = false;
      pasteBuffer += str.replace(BracketedPaste.END, '');

      // 완료된 버퍼를 Reducer로 일괄 디스패치 (단일 액션)
      dispatch({ type: 'PASTE_COMPLETE', payload: pasteBuffer });
      pasteBuffer = '';
    } else {
      pasteBuffer += str; // 중간 데이터는 개행(\n) 상관없이 무조건 축적
    }
    return; // isPasting 중에는 일반 키 이벤트(Enter 등) 처리 중단
  }
});

### Phase 2: 원자적 UI 상태 및 인터랙션 (Atomic Buffer)

의도: 축약된 Placeholder가 백스페이스나 커서 이동 시 일반 텍스트처럼 쪼개져서 원본 매핑(Map)과 불일치해지는 상태 오염(State Corruption)을 막습니다.

관련 파일: src/cli/key/text-buffer.ts

구현 명세:

상태 인터페이스 및 식별자 설계

export interface PastedChunk {
  id: string;          // 예: "[[paste:1701234567]]" (정규식 매칭을 위해 명확한 형태 사용)
  display: string;     // 예: " 📝 [Pasted Data: 50 lines] "
  content: string;     // 원본 데이터
}

export interface TextBufferState {
  lines: string[];
  cursor: Position;
  pastedChunks: Record<string, PastedChunk>; // Map 대신 직렬화 용이한 Record 사용
}

원자적 백스페이스 로직 (textBufferReducer 내부)

case 'BACKSPACE': {
  const currentLine = state.lines[state.cursor.y];
  const textBeforeCursor = currentLine.slice(0, state.cursor.x);

  // 커서 바로 앞이 Placeholder 식별자로 끝나는지 확인 (원자적 삭제 검증)
  const pasteTokenMatch = textBeforeCursor.match(/\[\[paste:\d+\]\]$/);

  if (pasteTokenMatch) {
    const tokenId = pasteTokenMatch[0];
    // 1. 해당 토큰을 lines에서 완전히 제거
    const newTextBefore = textBeforeCursor.slice(0, -tokenId.length);
    // 2. pastedChunks 레코드에서 삭제 (메모리 해제)
    const { [tokenId]: _, ...remainingChunks } = state.pastedChunks;

    return {
      ...state,
      lines: updateLine(state.lines, state.cursor.y, newTextBefore + textAfterCursor),
      cursor: { ...state.cursor, x: state.cursor.x - tokenId.length },
      pastedChunks: remainingChunks
    };
  }
  // 일반 백스페이스 로직...
}

### Phase 3: Vault 기반 능동적 오프로딩 (Active RAG Offloading)

의도: 5만 자의 코드를 붙여넣고 엔터를 쳤을 때, 이를 LLM에 그대로 보내면 컨텍스트가 초과되거나 비용이 폭증합니다. 이를 옵시디언 .obsidian/mcp-tmp/ 폴더에 임시 저장하고, LLM에는 "링크"만 전달합니다.

관련 파일: src/cli/hooks/usePromptCompletion.ts (제출 직전 처리), src/utils/VaultManger/VaultManager.ts

구현 명세:

오프로딩 서비스 (src/cli/utils/OffloadService.ts 신규)

export class InputOffloadService {
  private static readonly THRESHOLD = 2000; // 2000자 이상 시 오프로딩

  static async processPastedContent(
    rawInput: string,
    pastedChunks: Record<string, PastedChunk>,
    vaultManager: VaultManager
  ): Promise<string> {
    let finalPrompt = rawInput;

    for (const [tokenId, chunk] of Object.entries(pastedChunks)) {
      if (chunk.content.length > this.THRESHOLD) {
        // 1. 디스크 저장
        const fileName = `.obsidian/mcp-tmp/paste_${tokenId.replace(/\W/g, '')}.md`;
        await vaultManager.write(fileName, chunk.content);

        // 2. 능동적 RAG 지시문으로 치환
        const preview = chunk.content.substring(0, 150).replace(/\n/g, ' ') + '...';
        const maskInstruction = `

<user_input_masked>
[System: 사용자가 대량의 데이터를 제공하여 디스크에 안전하게 저장되었습니다.]

파일 경로: ${fileName}

내용 미리보기: "${preview}"
※ Action Required: 이 데이터의 분석이 필요하다면 반드시 'read_specific' 도구를 사용하여 위 파일 경로의 내용을 직접 읽으십시오.
</user_input_masked>`;

     finalPrompt = finalPrompt.replace(tokenId, maskInstruction);
   } else {
     // 임계값 미만은 원본 텍스트로 단순 치환
     finalPrompt = finalPrompt.replace(tokenId, chunk.content);
   }
 }
 return finalPrompt;

}
}

제출 핸들러 연동 (InputPrompt.tsx 또는 usePromptCompletion.ts)

const handleFinalSubmit = async (submittedText: string) => {
  // LLM 전송 직전 오프로딩 파이프라인 실행
  const optimizedPrompt = await InputOffloadService.processPastedContent(
    submittedText,
    bufferState.pastedChunks,
    vaultManager
  );

  // 버퍼 초기화 및 전송
  dispatch({ type: 'CLEAR_BUFFER' });
  sendToLLM(optimizedPrompt);
};

### Phase 4: 생명주기 및 가비지 컬렉션 (Lifecycle GC)

의도: 시스템 종료 또는 오류 발생 시 임시 파일이 Vault 내에 쓰레기로 남지 않도록 보장합니다.

관련 파일: src/cli/utils/cleanup.ts

구현 명세:

import { getVaultManager } from '../../utils/getVaultManager';

export async function performCleanup() {
  // 1. Bracketed Paste 모드 해제
  BracketedPaste.disable();

  // 2. 임시 파일 정리 (VaultManager 활용)
  const vaultManager = getVaultManager();
  try {
    const files = await vaultManager.list('.obsidian/mcp-tmp/');
    for (const file of files) {
      if (file.name.startsWith('paste_')) {
         await vaultManager.delete(`.obsidian/mcp-tmp/${file.name}`);
      }
    }
  } catch (e) {
    // 디렉토리가 없거나 삭제 실패 시 무시 (안전 종료 우선)
  }

  process.exit(0);
}

// 프로세스 종료 시그널에 바인딩
process.on('SIGINT', performCleanup);
process.on('SIGTERM', performCleanup);

## 3. 기대 효과 (Expected Outcomes)

붙여넣기 버그의 영구적 종식: \x1b[200~ 시퀀스를 통해 터미널이 직접 "여기서부터 복사된 텍스트야"라고 알려주므로, 중간에 포함된 개행문자(\n)가 handleFinalSubmit을 트리거하는 일이 구조적으로 불가능해집니다.

UI와 로직의 완벽한 분리: 사용자는 수만 줄의 코드를 붙여넣어도 화면에는 1줄의 [[paste:123]] 태그만 보이며 렉이 전혀 발생하지 않습니다. 커서 조작 중 토큰이 훼손되는 일도 차단됩니다.

MCP 서버 아키텍처에 완벽하게 부합: 사용자의 대형 입력값을 모델에게 강제로 먹이지 않고 로컬 환경(Vault)에 저장한 후 모델이 스스로 도구를 호출해 탐색(RAG)하게 만들므로, 토큰 사용량을 90% 이상 절감하면서도 더 정확한 분석 결과를 얻어냅니다.
