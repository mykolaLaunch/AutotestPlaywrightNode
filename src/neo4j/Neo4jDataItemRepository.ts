import { Neo4jTool } from './Neo4jTool';

export interface Neo4jDataItemRow {
  externalId: unknown;
  source: unknown;
  sourceAccount: unknown;
  dataItemType: unknown;
  createdAtUtc: unknown;
  rawVersionId: unknown;
}

export interface Neo4jDuplicateExternalIdRow {
  externalId: string;
  count: number;
}

export interface Neo4jDataItemOrderRow {
  externalId: string;
  rawVersionId: number;
  createdAtUtcMs: number;
  createdAtUtcIso: string;
}

export interface Neo4jPollAttempt {
  attempt: number;
  found: boolean;
  rowCount: number;
  at: string;
}

export interface Neo4jContentProbeRow {
  rawVersionId: unknown;
  createdAtUtc: unknown;
  text: unknown;
  labels: unknown;
  textSource: unknown;
}

export class Neo4jDataItemRepository extends Neo4jTool {
  public async getBySource(source: string): Promise<Neo4jDataItemRow[]> {
    return this.withSession(async (session) => {
      const result = await session.run(
        `
        MATCH (d:DataItem)
        WHERE d.source = $source
        RETURN
          d.externalId AS externalId,
          d.source AS source,
          d.sourceAccount AS sourceAccount,
          d.dataItemType AS dataItemType,
          d.createdAtUtc AS createdAtUtc,
          d.rawVersionId AS rawVersionId
        ORDER BY d.createdAtUtc DESC
        `,
        { source }
      );

      return result.records.map((record) => ({
        externalId: record.get('externalId'),
        source: record.get('source'),
        sourceAccount: record.get('sourceAccount'),
        dataItemType: record.get('dataItemType'),
        createdAtUtc: record.get('createdAtUtc'),
        rawVersionId: record.get('rawVersionId')
      }));
    });
  }

  public async getBySourceAndAccount(source: string, sourceAccount: string): Promise<Neo4jDataItemRow[]> {
    return this.withSession(async (session) => {
      const result = await session.run(
        `
        MATCH (d:DataItem)
        WHERE d.source = $source
          AND d.sourceAccount = $sourceAccount
        RETURN
          d.externalId AS externalId,
          d.source AS source,
          d.sourceAccount AS sourceAccount,
          d.dataItemType AS dataItemType,
          d.createdAtUtc AS createdAtUtc,
          d.rawVersionId AS rawVersionId
        ORDER BY d.createdAtUtc DESC
        `,
        { source, sourceAccount }
      );

      return result.records.map((record) => ({
        externalId: record.get('externalId'),
        source: record.get('source'),
        sourceAccount: record.get('sourceAccount'),
        dataItemType: record.get('dataItemType'),
        createdAtUtc: record.get('createdAtUtc'),
        rawVersionId: record.get('rawVersionId')
      }));
    });
  }

  public async getBySourceAndExternalId(source: string, externalId: string): Promise<Neo4jDataItemRow[]> {
    return this.withSession(async (session) => {
      const result = await session.run(
        `
        MATCH (d:DataItem)
        WHERE d.source = $source
          AND d.externalId = $externalId
        RETURN
          d.externalId AS externalId,
          d.source AS source,
          d.sourceAccount AS sourceAccount,
          d.dataItemType AS dataItemType,
          d.createdAtUtc AS createdAtUtc,
          d.rawVersionId AS rawVersionId
        ORDER BY d.createdAtUtc DESC
        `,
        { source, externalId }
      );

      return result.records.map((record) => ({
        externalId: record.get('externalId'),
        source: record.get('source'),
        sourceAccount: record.get('sourceAccount'),
        dataItemType: record.get('dataItemType'),
        createdAtUtc: record.get('createdAtUtc'),
        rawVersionId: record.get('rawVersionId')
      }));
    });
  }

  public async getBySourceAccountAndExternalId(
    source: string,
    sourceAccount: string,
    externalId: string
  ): Promise<Neo4jDataItemRow[]> {
    return this.withSession(async (session) => {
      const result = await session.run(
        `
        MATCH (d:DataItem)
        WHERE d.source = $source
          AND d.sourceAccount = $sourceAccount
          AND d.externalId = $externalId
        RETURN
          d.externalId AS externalId,
          d.source AS source,
          d.sourceAccount AS sourceAccount,
          d.dataItemType AS dataItemType,
          d.createdAtUtc AS createdAtUtc,
          d.rawVersionId AS rawVersionId
        ORDER BY d.createdAtUtc DESC
        `,
        { source, sourceAccount, externalId }
      );

      return result.records.map((record) => ({
        externalId: record.get('externalId'),
        source: record.get('source'),
        sourceAccount: record.get('sourceAccount'),
        dataItemType: record.get('dataItemType'),
        createdAtUtc: record.get('createdAtUtc'),
        rawVersionId: record.get('rawVersionId')
      }));
    });
  }

  public async getCountBySourceAndAccount(source: string, sourceAccount: string): Promise<number> {
    return this.withSession(async (session) => {
      const result = await session.run(
        `
        MATCH (d:DataItem)
        WHERE d.source = $source
          AND d.sourceAccount = $sourceAccount
        RETURN count(d) AS total
        `,
        { source, sourceAccount }
      );

      if (result.records.length === 0) {
        return 0;
      }

      const value = result.records[0].get('total');
      if (typeof value?.toNumber === 'function') {
        return value.toNumber();
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    });
  }

  public async getCountBySource(source: string): Promise<number> {
    return this.withSession(async (session) => {
      const result = await session.run(
        `
        MATCH (d:DataItem)
        WHERE d.source = $source
        RETURN count(d) AS total
        `,
        { source }
      );

      if (result.records.length === 0) {
        return 0;
      }

      const value = result.records[0].get('total');
      if (typeof value?.toNumber === 'function') {
        return value.toNumber();
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    });
  }

  public async getLatestCreatedAtBySourceAndAccount(
    source: string,
    sourceAccount: string
  ): Promise<string | null> {
    return this.withSession(async (session) => {
      const result = await session.run(
        `
        MATCH (d:DataItem)
        WHERE d.source = $source
          AND d.sourceAccount = $sourceAccount
        RETURN d.createdAtUtc AS createdAtUtc
        ORDER BY d.createdAtUtc DESC
        LIMIT 1
        `,
        { source, sourceAccount }
      );

      if (result.records.length === 0) {
        return null;
      }

      const value = result.records[0].get('createdAtUtc');
      return value === null || value === undefined ? null : String(value);
    });
  }

  public async getBySourceAndAccountLimited(
    source: string,
    sourceAccount: string,
    limit: number
  ): Promise<Neo4jDataItemRow[]> {
    const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 1000;

    return this.withSession(async (session) => {
      const result = await session.run(
        `
        MATCH (d:DataItem)
        WHERE d.source = $source
          AND d.sourceAccount = $sourceAccount
        RETURN
          d.externalId AS externalId,
          d.source AS source,
          d.sourceAccount AS sourceAccount,
          d.dataItemType AS dataItemType,
          d.createdAtUtc AS createdAtUtc,
          d.rawVersionId AS rawVersionId
        ORDER BY d.createdAtUtc DESC
        LIMIT toInteger($limit)
        `,
        { source, sourceAccount, limit: safeLimit }
      );

      return result.records.map((record) => ({
        externalId: record.get('externalId'),
        source: record.get('source'),
        sourceAccount: record.get('sourceAccount'),
        dataItemType: record.get('dataItemType'),
        createdAtUtc: record.get('createdAtUtc'),
        rawVersionId: record.get('rawVersionId')
      }));
    });
  }

  public async getDuplicateExternalIdsBySourceAndAccount(
    source: string,
    sourceAccount: string
  ): Promise<Neo4jDuplicateExternalIdRow[]> {
    return this.withSession(async (session) => {
      const result = await session.run(
        `
        MATCH (d:DataItem)
        WHERE d.source = $source
          AND d.sourceAccount = $sourceAccount
          AND d.externalId IS NOT NULL
          AND trim(toString(d.externalId)) <> ''
        WITH toString(d.externalId) AS externalId, count(*) AS cnt
        WHERE cnt > 1
        RETURN externalId, cnt
        ORDER BY cnt DESC, externalId ASC
        `,
        { source, sourceAccount }
      );

      return result.records
        .map((record) => {
          const externalId = record.get('externalId');
          const count = this.toSafeNumber(record.get('cnt'));
          if (typeof externalId !== 'string' || externalId.trim() === '' || count === null) {
            return null;
          }
          return { externalId, count };
        })
        .filter((row): row is Neo4jDuplicateExternalIdRow => row !== null);
    });
  }

  public async getRowsForCreatedAtRawVersionOrderValidation(
    source: string,
    sourceAccount: string,
    limit: number
  ): Promise<{ items: Neo4jDataItemOrderRow[]; errors: string[] }> {
    const rows = await this.getBySourceAndAccountLimited(source, sourceAccount, limit);
    const errors: string[] = [];
    const items: Neo4jDataItemOrderRow[] = [];

    for (const row of rows) {
      const externalId =
        typeof row.externalId === 'string' && row.externalId.trim() !== ''
          ? row.externalId
          : '(unknown externalId)';
      const rawVersionId = this.toSafeNumber(row.rawVersionId);
      const createdAtUtcMs = this.toDateMs(row.createdAtUtc);

      if (rawVersionId === null) {
        errors.push(`Neo4j row has invalid rawVersionId for externalId=${externalId}.`);
        continue;
      }
      if (createdAtUtcMs === null) {
        errors.push(`Neo4j row has invalid createdAtUtc for externalId=${externalId}.`);
        continue;
      }

      items.push({
        externalId,
        rawVersionId,
        createdAtUtcMs,
        createdAtUtcIso: new Date(createdAtUtcMs).toISOString()
      });
    }

    return { items, errors };
  }

  public async pollBySourceAndExternalId(
    source: string,
    externalId: string,
    maxAttempts: number = 40,
    waitMs: number = 3000
  ): Promise<{ rows: Neo4jDataItemRow[]; attempts: Neo4jPollAttempt[] }> {
    const attempts: Neo4jPollAttempt[] = [];
    let rows: Neo4jDataItemRow[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      rows = await this.getBySourceAndExternalId(source, externalId);
      const found = rows.length > 0;
      attempts.push({
        attempt,
        found,
        rowCount: rows.length,
        at: new Date().toISOString()
      });

      if (found) {
        break;
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    return { rows, attempts };
  }

  public async getLatestContentBySourceAndExternalId(
    source: string,
    externalId: string
  ): Promise<{
    text: string | null;
    rawVersionId: number | null;
    createdAtUtcMs: number | null;
    sourceLabel: string | null;
    sourceField: string | null;
  }> {
    return this.withSession(async (session) => {
      const result = await session.run(
        `
        MATCH (d:DataItem)
        WHERE d.source = $source
          AND d.externalId = $externalId
        OPTIONAL MATCH (d)--(n)
        WITH d, n
        WHERE n IS NULL
          OR n:Chunk
          OR any(k IN keys(n) WHERE k IN ['text', 'content', 'body', 'value'])
        WITH d, n,
          CASE
            WHEN n:Chunk AND n.text IS NOT NULL THEN n.text
            WHEN n.content IS NOT NULL THEN n.content
            WHEN n.body IS NOT NULL THEN n.body
            WHEN n.value IS NOT NULL THEN n.value
            WHEN n.text IS NOT NULL THEN n.text
            ELSE null
          END AS candidateText,
          CASE
            WHEN n:Chunk AND n.text IS NOT NULL THEN 'text'
            WHEN n.content IS NOT NULL THEN 'content'
            WHEN n.body IS NOT NULL THEN 'body'
            WHEN n.value IS NOT NULL THEN 'value'
            WHEN n.text IS NOT NULL THEN 'text'
            ELSE null
          END AS textSource,
          labels(n) AS labels
        RETURN
          d.rawVersionId AS rawVersionId,
          d.createdAtUtc AS createdAtUtc,
          candidateText AS text,
          labels AS labels,
          textSource AS textSource
        ORDER BY d.createdAtUtc DESC
        LIMIT 20
        `,
        { source, externalId }
      );

      const rows: Neo4jContentProbeRow[] = result.records.map((record) => ({
        rawVersionId: record.get('rawVersionId'),
        createdAtUtc: record.get('createdAtUtc'),
        text: record.get('text'),
        labels: record.get('labels'),
        textSource: record.get('textSource')
      }));

      let bestText: string | null = null;
      let bestLabels: string | null = null;
      let bestField: string | null = null;
      for (const row of rows) {
        if (typeof row.text !== 'string') continue;
        const trimmed = row.text.trim();
        if (!trimmed) continue;
        bestText = trimmed;
        bestField = typeof row.textSource === 'string' ? row.textSource : null;
        if (Array.isArray(row.labels) && row.labels.length > 0) {
          bestLabels = String(row.labels[0]);
        }
        break;
      }

      const first = rows[0];
      const rawVersionId = this.toSafeNumber(first?.rawVersionId);
      const createdAtUtcMs = this.toDateMs(first?.createdAtUtc);
      return { text: bestText, rawVersionId, createdAtUtcMs, sourceLabel: bestLabels, sourceField: bestField };
    });
  }

  public async pollBySourceAccountAndExternalId(
    source: string,
    sourceAccount: string,
    externalId: string,
    maxAttempts: number = 40,
    waitMs: number = 3000
  ): Promise<{ rows: Neo4jDataItemRow[]; attempts: Neo4jPollAttempt[] }> {
    const attempts: Neo4jPollAttempt[] = [];
    let rows: Neo4jDataItemRow[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      rows = await this.getBySourceAccountAndExternalId(source, sourceAccount, externalId);
      const found = rows.length > 0;
      attempts.push({
        attempt,
        found,
        rowCount: rows.length,
        at: new Date().toISOString()
      });

      if (found) {
        break;
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    return { rows, attempts };
  }
}
