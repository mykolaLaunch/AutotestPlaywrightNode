import { RawItemRepository, RawItemRow } from '../../db/repositories/RawItemRepository';
import { Neo4jDataItemRepository, Neo4jDataItemRow } from '../../neo4j/Neo4jDataItemRepository';

export interface LocalFileDbSnapshot {
  rowCount: number;
  latestId: number | null;
  updatedTimeMs: number | null;
}

export interface LocalFileNeo4jSnapshot {
  rowCount: number;
  latestRawVersionId: number | null;
  latestCreatedAtMs: number | null;
  latestText: string | null;
  latestTextSourceLabel: string | null;
  latestTextSourceField: string | null;
}

export class LocalFilesRepository {
  constructor(
    private readonly rawItemRepository: RawItemRepository = new RawItemRepository(),
    private readonly neo4jRepository: Neo4jDataItemRepository = new Neo4jDataItemRepository()
  ) {}

  public async pollDbRowsByExternalId(externalId: string): Promise<RawItemRow[]> {
    const result = await this.rawItemRepository.pollBySourceAndExternalId('file-system', externalId);
    return result.rows;
  }

  public async pollNeo4jRowsByExternalId(externalId: string): Promise<Neo4jDataItemRow[]> {
    const result = await this.neo4jRepository.pollBySourceAndExternalId('file-system', externalId);
    return result.rows;
  }

  public buildDbSnapshot(rows: RawItemRow[]): LocalFileDbSnapshot {
    const latest = rows[0] as { id?: unknown; updated_time?: unknown } | undefined;
    const latestId = this.toNumber(latest?.id);
    const updatedTimeMs = this.toDateMs(latest?.updated_time);
    return {
      rowCount: rows.length,
      latestId,
      updatedTimeMs
    };
  }

  public buildNeo4jSnapshot(rows: Neo4jDataItemRow[]): LocalFileNeo4jSnapshot {
    const latestRow = rows[0];
    return {
      rowCount: rows.length,
      latestRawVersionId: this.toNumber((latestRow as { rawVersionId?: unknown })?.rawVersionId),
      latestCreatedAtMs: this.toDateMs((latestRow as { createdAtUtc?: unknown })?.createdAtUtc),
      latestText: null,
      latestTextSourceLabel: null,
      latestTextSourceField: null
    };
  }

  public async getDbSnapshotByExternalId(externalId: string): Promise<LocalFileDbSnapshot> {
    const latest = (await this.rawItemRepository.getLatestBySourceAndExternalIdByUpdatedTime(
      'file-system',
      externalId
    )) as { id?: unknown; updated_time?: unknown } | null;
    return {
      rowCount: latest ? 1 : 0,
      latestId: this.toNumber(latest?.id),
      updatedTimeMs: this.toDateMs(latest?.updated_time)
    };
  }

  public async pollDbSnapshotUntilUpdatedAfter(
    externalId: string,
    baselineUpdatedTimeMs: number | null,
    maxAttempts: number = 40,
    waitMs: number = 3000
  ): Promise<LocalFileDbSnapshot> {
    let last = await this.getDbSnapshotByExternalId(externalId);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      last = await this.getDbSnapshotByExternalId(externalId);
      if (last.rowCount > 0 && last.updatedTimeMs !== null) {
        if (baselineUpdatedTimeMs === null || last.updatedTimeMs > baselineUpdatedTimeMs) {
          return last;
        }
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    return last;
  }

  public async getNeo4jSnapshotByExternalId(externalId: string): Promise<LocalFileNeo4jSnapshot> {
    const rows = await this.neo4jRepository.getBySourceAndExternalId('file-system', externalId);
    const latestContent = await this.neo4jRepository.getLatestContentBySourceAndExternalId('file-system', externalId);
    return {
      rowCount: rows.length,
      latestRawVersionId: latestContent.rawVersionId ?? this.toNumber((rows[0] as { rawVersionId?: unknown })?.rawVersionId),
      latestCreatedAtMs:
        latestContent.createdAtUtcMs ?? this.toDateMs((rows[0] as { createdAtUtc?: unknown })?.createdAtUtc),
      latestText: latestContent.text,
      latestTextSourceLabel: latestContent.sourceLabel,
      latestTextSourceField: latestContent.sourceField
    };
  }

  public async pollNeo4jSnapshotUntilContentContains(
    externalId: string,
    expectedSubstring: string,
    maxAttempts: number = 40,
    waitMs: number = 3000
  ): Promise<LocalFileNeo4jSnapshot> {
    let last = await this.getNeo4jSnapshotByExternalId(externalId);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      last = await this.getNeo4jSnapshotByExternalId(externalId);
      if (typeof last.latestText === 'string' && last.latestText.includes(expectedSubstring)) {
        return last;
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    return last;
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (value && typeof value === 'object') {
      const candidate = value as { toNumber?: () => number };
      if (typeof candidate.toNumber === 'function') {
        const parsed = candidate.toNumber();
        return Number.isFinite(parsed) ? parsed : null;
      }
    }
    return null;
  }

  private toDateMs(value: unknown): number | null {
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isNaN(ms) ? null : ms;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.getTime();
    }
    if (value && typeof value === 'object') {
      const date = new Date(String(value));
      return Number.isNaN(date.getTime()) ? null : date.getTime();
    }
    return null;
  }
}
