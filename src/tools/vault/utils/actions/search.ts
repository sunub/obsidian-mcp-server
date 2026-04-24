import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { VaultManager } from "../../../../utils/VaultManger/VaultManager.js";
import type { ObsidianContentQueryParams } from "../../params.js";
import { formatDocument, getDocumentContent } from "../document.js";
import {
  ACTION_DEFAULT_MAX_OUTPUT_CHARS,
  finalizePayloadWithCompression,
  jsonCharLength,
  resolveCompressionMode,
  SEARCH_DEFAULT_EXCERPT,
} from "../shared.js";

function clampSearchPayloadByOutputChars<
  T extends {
    found: number;
    documents: Array<{
      content:
      | { full: string; excerpt: string }
      | { preview: string; note: string };
    }>;
  },
>(payload: T, maxOutputChars: number): { payload: T; clamped: boolean } {
  const next = structuredClone(payload);
  let clamped = false;

  while (jsonCharLength(next) > maxOutputChars && next.documents.length > 1) {
    next.documents.pop();
    next.found = next.documents.length;
    clamped = true;
  }

  if (jsonCharLength(next) <= maxOutputChars) {
    return { payload: next, clamped };
  }

  for (const doc of next.documents) {
    if ("full" in doc.content) {
      if (doc.content.full.length > 600) {
        doc.content.full = `${doc.content.full.substring(0, 600)}...`;
      }
      if (doc.content.excerpt.length > 300) {
        doc.content.excerpt = `${doc.content.excerpt.substring(0, 300)}...`;
      }
      clamped = true;
    }
  }

  return { payload: next, clamped };
}

export async function searchDocuments(
  vaultManager: VaultManager,
  params: ObsidianContentQueryParams,
): Promise<CallToolResult> {
  await vaultManager.initialize();
  const mode = resolveCompressionMode(params);

  const { results: searchResults, diagnostic_message } =
    await vaultManager.hybridSearch(params.keyword || "", params.limit ?? 10);

  if (params.quiet) {
    return {
      isError: false,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            found: searchResults.length,
            filenames: searchResults.map(
              (res) =>
                res.document.filePath.split("/").pop() || res.document.filePath,
            ),
          }),
        },
      ],
    };
  }

  const effectiveExcerptLength =
    params.excerptLength ??
    (mode === "none" ? undefined : SEARCH_DEFAULT_EXCERPT[mode]);

  const documentsData = await Promise.all(
    searchResults.map(async (res) => {
      const doc = res.document;
      let formatted: ReturnType<typeof formatDocument>;

      if (params.includeContent) {
        const fullDoc = await getDocumentContent(
          vaultManager,
          doc.filePath,
          effectiveExcerptLength,
        );
        formatted = formatDocument(
          { ...doc, ...fullDoc },
          true,
          effectiveExcerptLength,
        );
      } else {
        formatted = formatDocument(doc, false);
      }

      // 하이브리드 검색 정보 추가
      return {
        ...formatted,
        relevance_score: res.finalScore ?? res.score,
        best_match_chunk: res.matchedChunks?.[0]?.content || undefined,
      };
    }),
  );

  const sourceChars = searchResults.reduce(
    (sum, res) => sum + res.document.contentLength,
    0,
  );
  const maxOutputChars =
    params.maxOutputChars ??
    (mode === "none" ? null : ACTION_DEFAULT_MAX_OUTPUT_CHARS.search[mode]);

  const basePayload = {
    query: params.keyword,
    found: documentsData.length,
    matched_total: searchResults.length,
    total_in_vault: (await vaultManager.getAllDocuments()).length,
    documents: documentsData,
  };

  let payloadForCompression = basePayload;
  let outputCapClamped = false;
  if (typeof maxOutputChars === "number") {
    const clamped = clampSearchPayloadByOutputChars(
      basePayload,
      maxOutputChars,
    );
    payloadForCompression = clamped.payload;
    outputCapClamped = clamped.clamped;
  }

  const isTruncated =
    documentsData.some((doc) => doc.content_is_truncated) || outputCapClamped;

  const payload = finalizePayloadWithCompression(payloadForCompression, {
    mode,
    source_chars: sourceChars,
    max_output_chars: maxOutputChars,
    truncated: isTruncated,
    expand_hint:
      "If you need full raw text, call vault action='read' with compressionMode='none'.",
  });

  // 진단 메시지가 있으면 최상단에 추가
  let finalOutput = JSON.stringify(payload, null, 2);
  if (diagnostic_message) {
    finalOutput = `<system_directive>\n${diagnostic_message}\n</system_directive>\n\n${finalOutput}`;
  }

  return {
    isError: false,
    content: [
      {
        type: "text",
        text: finalOutput,
      },
    ],
  };
}
