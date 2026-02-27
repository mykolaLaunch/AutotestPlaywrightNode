import { APIResponse, expect } from '@playwright/test';
import { ChatResponse, ChatCitation, ChatRetrievalChunk } from '../models/chat';
import { BaseResponseValidator } from './BaseResponseValidator';

/**
 * Where to look for matching source/externalId.
 * - 'citations'  — only in body.citations
 * - 'chunks'     — only in body.answerLog.retrieval.chunks
 * - 'both'       — in citations AND chunks (default)
 */
export type SourceSearchScope = 'citations' | 'chunks' | 'both';

/**
 * Options for validateSourceUsage().
 *
 * @param source        - Required. The source value to look for (e.g. 'gmail', 'slack').
 * @param externalIds   - Optional. One or more externalId values to verify.
 * @param matchAll      - When externalIds is provided:
 *                          false (default) — at least one externalId must be found.
 *                          true            — every externalId in the array must be found.
 * @param scope         - Where to search: 'citations' | 'chunks' | 'both' (default).
 */
export interface SourceValidationOptions {
  source: string;
  externalIds?: string[];
  matchAll?: boolean;
  scope?: SourceSearchScope;
}

export class ChatValidator extends BaseResponseValidator {
  public async validate(response: APIResponse): Promise<void> {
    console.info('.'.repeat(80));
    console.info('💬 Validation started: POST /chat');

    const status = response.status();
    console.info(`➡️ HTTP status received: ${status}`);
    expect(status, 'POST /chat should return 200').toBe(200);

    const body = (await response.json()) as ChatResponse;
    this.validateCoreFields(body);
    this.logCitations(body.citations ?? []);
    this.logRetrievalChunks(body.answerLog?.retrieval?.chunks ?? []);

    console.info('✅ Chat response validation completed successfully.');
    console.info('.'.repeat(80));
  }

  /**
   * Validates that the response contains items with the specified source,
   * and optionally checks for specific externalId values.
   *
   * @example — check that at least one chunk/citation from 'gmail' was used:
   *   validator.validateSourceUsage(body, { source: 'gmail' });
   *
   * @example — check that gmail chunks with at least one of the given externalIds were used:
   *   validator.validateSourceUsage(body, {
   *     source: 'gmail',
   *     externalIds: ['19c8c0b2f79f6627', 'abc123'],
   *     scope: 'chunks',
   *   });
   *
   * @example — check that ALL given externalIds are present in citations:
   *   validator.validateSourceUsage(body, {
   *     source: 'slack',
   *     externalIds: ['id-1', 'id-2'],
   *     matchAll: true,
   *     scope: 'citations',
   *   });
   */
  public validateSourceUsage(body: ChatResponse, options: SourceValidationOptions): void {
    const { source, externalIds, matchAll = false, scope = 'both' } = options;

    console.info('.'.repeat(80));
    console.info(`response from APP - ${body.answer}`);
    console.info(`🔍 validateSourceUsage: source="${source}", scope="${scope}"`);
    if (externalIds?.length) {
      console.info(
          `   externalIds=${JSON.stringify(externalIds)}, matchAll=${matchAll}`
      );
    }

    // Collect candidate items depending on scope
    const citationItems = scope !== 'chunks' ? this.extractFromCitations(body, source) : [];
    const chunkItems    = scope !== 'citations' ? this.extractFromChunks(body, source) : [];
    const allItems      = [...citationItems, ...chunkItems];

    // 1. At least one item with the requested source must exist
    console.info(
        `   Found ${citationItems.length} citation(s) and ${chunkItems.length} chunk(s) with source="${source}"`
    );
    expect(
        allItems.length,
        `Expected at least one item with source="${source}" in scope="${scope}", but found none`
    ).toBeGreaterThan(0);

    // 2. If externalIds provided — validate presence
    if (externalIds && externalIds.length > 0) {
      const foundExternalIds = new Set(allItems.map((item) => item.externalId).filter(Boolean));
      console.info(`   externalIds found in response: ${JSON.stringify([...foundExternalIds])}`);

      if (matchAll) {
        // Every requested externalId must be present
        for (const id of externalIds) {
          expect(
              foundExternalIds.has(id),
              `Expected externalId="${id}" to be present in source="${source}" items (scope="${scope}"), but it was not found`
          ).toBe(true);
        }
        console.info(`   ✅ All ${externalIds.length} externalId(s) found.`);
      } else {
        // At least one requested externalId must be present
        const anyFound = externalIds.some((id) => foundExternalIds.has(id));
        expect(
            anyFound,
            `Expected at least one of externalIds=${JSON.stringify(externalIds)} to be present in source="${source}" items (scope="${scope}"), but none were found`
        ).toBe(true);
        console.info(`   ✅ At least one externalId found.`);
      }
    }

    console.info(`✅ validateSourceUsage passed for source="${source}".`);
    console.info('.'.repeat(80));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private extractFromCitations(
      body: ChatResponse,
      source: string
  ): Array<{ externalId: string | null }> {
    return (body.citations ?? [])
        .filter((c) => c.source === source)
        .map((c) => ({ externalId: c.externalId ?? null }));
  }

  private extractFromChunks(
      body: ChatResponse,
      source: string
  ): Array<{ externalId: string | null }> {
    return (body.answerLog?.retrieval?.chunks ?? [])
        .filter((ch) => ch.dataItem.source === source)
        .map((ch) => ({ externalId: ch.dataItem.externalId ?? null }));
  }

  private validateCoreFields(body: ChatResponse): void {
    console.info(`📝 Answer: ${body.answer}`);
    expect(typeof body.answer, 'answer should be string').toBe('string');

    console.info(`🧵 SessionId: ${body.sessionId}`);
    expect(typeof body.sessionId, 'sessionId should be number').toBe('number');

    if (body.answerLog) {
      console.info(
          `🔎 AnswerLog: originalQuery="${body.answerLog.originalQuery}", rewritten="${body.answerLog.rewrittenQuery ?? ''}"`
      );
    }
  }

  private logCitations(citations: ChatCitation[]): void {
    console.info(`📚 Citations count: ${citations.length}`);
    citations.forEach((c, idx) => {
      console.info(
          `  • [${idx + 1}] source=${c.source}, dataItemType=${c.dataItemType}, graphId=${c.graphId}, title=${c.titleOrSubject}`
      );
    });
  }

  private logRetrievalChunks(chunks: ChatRetrievalChunk[]): void {
    console.info(`📦 Retrieval chunks: ${chunks.length}`);
    chunks.forEach((chunk, idx) => {
      console.info(
          `  • [${idx + 1}] chunkId=${chunk.chunkId}, score=${chunk.score}, source=${chunk.dataItem.source}, dataItemType=${chunk.dataItem.dataItemType}`
      );
    });
  }
}