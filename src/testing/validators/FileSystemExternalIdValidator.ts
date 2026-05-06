import { ValidationResult } from './ValidationResult';

export interface FileSystemDbIngestionOrderRow {
  id: number;
  updatedUtcIso: string;
  updatedUtcMs: number;
}

export interface FileSystemNeo4jIngestionOrderRow {
  rawVersionId: number;
  createdAtUtcIso: string;
  createdAtUtcMs: number;
}

export class FileSystemExternalIdValidator {
  public validateExternalIds(
    rawExternalIds: Array<unknown>,
    storageLabel: string = 'DB'
  ): { externalIds: string[]; result: ValidationResult } {
    const errors: string[] = [];
    const externalIds: string[] = [];

    for (const value of rawExternalIds) {
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push(`${storageLabel} row has invalid external_id (expected non-empty string).`);
        continue;
      }
      externalIds.push(value);
    }

    this.logErrors(`${storageLabel} external_id validation`, errors);
    return { externalIds, result: { errors } };
  }

  public validatePathsPresentInStorage(
    expectedPaths: string[],
    existingExternalIds: string[],
    storageLabel: string = 'DB'
  ): ValidationResult {
    const errors: string[] = [];
    const existingSet = new Set(existingExternalIds);

    for (const filePath of expectedPaths) {
      if (!existingSet.has(filePath)) {
        errors.push(`Missing file in ${storageLabel}: ${filePath}`);
      }
    }

    this.logErrors(`${storageLabel} file coverage validation`, errors);
    return { errors };
  }

  public validateNoDuplicateExternalIds(
    externalIds: string[],
    storageLabel: string = 'DB'
  ): ValidationResult {
    const errors: string[] = [];
    const counts = new Map<string, number>();

    for (const externalId of externalIds) {
      counts.set(externalId, (counts.get(externalId) ?? 0) + 1);
    }

    for (const [externalId, count] of counts.entries()) {
      if (count > 1) {
        errors.push(`Duplicate external_id in ${storageLabel}: ${externalId} (count=${count})`);
      }
    }

    this.logErrors(`${storageLabel} duplicate external_id validation`, errors);
    return { errors };
  }

  public validateDbRowsForUpdatedUtcAndId(
    rawRows: Array<unknown>
  ): { items: FileSystemDbIngestionOrderRow[]; result: ValidationResult } {
    const errors: string[] = [];
    const items: FileSystemDbIngestionOrderRow[] = [];

    for (const raw of rawRows) {
      const row = raw as { id?: unknown; updated_utc?: unknown };
      const id = this.parseIdToNumber(row.id);
      if (id === null) {
        errors.push('DB row has invalid id (expected finite number).');
        continue;
      }

      const updatedUtcMs = this.parseDateToMs(row.updated_utc);
      if (updatedUtcMs === null) {
        errors.push(`DB row has invalid updated_utc for id=${id}.`);
        continue;
      }

      items.push({
        id,
        updatedUtcIso: new Date(updatedUtcMs).toISOString(),
        updatedUtcMs
      });
    }

    this.logErrors('DB updated_utc + id validation', errors);
    return { items, result: { errors } };
  }

  public validateUpdatedUtcIdOrder(
    items: FileSystemDbIngestionOrderRow[],
    minSamples: number = 5
  ): ValidationResult {
    const errors: string[] = [];

    if (items.length < minSamples) {
      errors.push(
        `Not enough DB rows to validate updated_utc/id order. Expected at least ${minSamples}, got ${items.length}.`
      );
      this.logErrors('DB updated_utc/id order validation', errors);
      return { errors };
    }

    const sorted = items
      .slice()
      .sort((a, b) => a.updatedUtcMs - b.updatedUtcMs || a.id - b.id);

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i];
      const next = sorted[i + 1];

      if (current.updatedUtcMs < next.updatedUtcMs && current.id > next.id) {
        errors.push(
          `Order mismatch: updated_utc ${current.updatedUtcIso} (id=${current.id}) is earlier than ${next.updatedUtcIso} (id=${next.id}), but id is larger.`
        );
      }
    }

    this.logErrors('DB updated_utc/id order validation', errors);
    return { errors };
  }

  public validateNeo4jRowsForCreatedAtAndRawVersion(
    rawRows: Array<unknown>
  ): { items: FileSystemNeo4jIngestionOrderRow[]; result: ValidationResult } {
    const errors: string[] = [];
    const items: FileSystemNeo4jIngestionOrderRow[] = [];

    for (const raw of rawRows) {
      const row = raw as { rawVersionId?: unknown; createdAtUtc?: unknown; externalId?: unknown };
      const rawVersionId = this.parseIdToNumber(row.rawVersionId);
      const externalId =
        typeof row.externalId === 'string' && row.externalId.trim() !== ''
          ? row.externalId
          : '(unknown externalId)';
      if (rawVersionId === null) {
        errors.push(`Neo4j row has invalid rawVersionId for externalId=${externalId}.`);
        continue;
      }

      const createdAtUtcMs = this.parseDateToMs(row.createdAtUtc);
      if (createdAtUtcMs === null) {
        errors.push(`Neo4j row has invalid createdAtUtc for externalId=${externalId}.`);
        continue;
      }

      items.push({
        rawVersionId,
        createdAtUtcIso: new Date(createdAtUtcMs).toISOString(),
        createdAtUtcMs
      });
    }

    this.logErrors('Neo4j createdAtUtc + rawVersionId validation', errors);
    return { items, result: { errors } };
  }

  public validateCreatedAtRawVersionOrder(
    items: FileSystemNeo4jIngestionOrderRow[],
    minSamples: number = 5
  ): ValidationResult {
    const errors: string[] = [];

    if (items.length < minSamples) {
      errors.push(
        `Not enough Neo4j rows to validate createdAtUtc/rawVersionId order. Expected at least ${minSamples}, got ${items.length}.`
      );
      this.logErrors('Neo4j createdAtUtc/rawVersionId order validation', errors);
      return { errors };
    }

    const sorted = items
      .slice()
      .sort((a, b) => a.createdAtUtcMs - b.createdAtUtcMs || a.rawVersionId - b.rawVersionId);

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i];
      const next = sorted[i + 1];

      if (current.createdAtUtcMs < next.createdAtUtcMs && current.rawVersionId < next.rawVersionId) {
        errors.push(
          `Order mismatch: createdAtUtc ${current.createdAtUtcIso} (rawVersionId=${current.rawVersionId}) is earlier than ${next.createdAtUtcIso} (rawVersionId=${next.rawVersionId}), but rawVersionId is smaller.`
        );
      }
    }

    this.logErrors('Neo4j createdAtUtc/rawVersionId order validation', errors);
    return { errors };
  }

  private parseDateToMs(value: unknown): number | null {
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isNaN(ms) ? null : ms;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      const ms = value < 1e12 ? value * 1000 : value;
      return Number.isFinite(ms) ? ms : null;
    }

    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.getTime();
      }
    }

    if (value && typeof value === 'object') {
      const candidate = value as { toString?: unknown };
      if (typeof candidate.toString === 'function') {
        const parsed = new Date(String(value));
        if (!Number.isNaN(parsed.getTime())) {
          return parsed.getTime();
        }
      }
    }

    return null;
  }

  private parseIdToNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    if (value && typeof value === 'object') {
      const candidate = value as { toNumber?: () => number; low?: unknown; high?: unknown };
      if (typeof candidate.toNumber === 'function') {
        const parsed = candidate.toNumber();
        return Number.isFinite(parsed) ? parsed : null;
      }
      if (typeof candidate.low === 'number' && typeof candidate.high === 'number') {
        const parsed = candidate.high * 2 ** 32 + candidate.low;
        return Number.isFinite(parsed) ? parsed : null;
      }
    }

    return null;
  }

  private logErrors(context: string, errors: string[]): void {
    if (errors.length === 0) {
      console.info(`${context}: no errors.`);
      return;
    }
    console.error(`${context}: ${errors.length} error(s).`);
    for (const err of errors) {
      console.error(`- ${err}`);
    }
  }
}
