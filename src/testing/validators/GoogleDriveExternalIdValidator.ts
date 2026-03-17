import { ValidationResult } from './ValidationResult';

export interface DriveDbIngestionOrderRow {
  id: number;
  updatedUtcIso: string;
  updatedUtcMs: number;
}

export class GoogleDriveExternalIdValidator {
  public validateFileIdsPresentInDb(fileIds: string[], dbExternalIds: string[]): ValidationResult {
    const errors: string[] = [];

    if (fileIds.length === 0) {
      errors.push('No Google Drive file ids were returned.');
    }

    const dbSet = new Set(dbExternalIds);
    const missing: string[] = [];

    for (const id of fileIds) {
      if (!dbSet.has(id)) {
        missing.push(id);
      }
    }

    if (missing.length > 0) {
      const preview = missing.slice(0, 50);
      errors.push(
        `DB is missing ${missing.length} Google Drive external_id(s). First ${preview.length}: ${preview.join(', ')}`
      );
    }

    this.logErrors('Google Drive external_id validation', errors);
    return { errors };
  }

  public validateDbExternalIds(rawExternalIds: Array<unknown>): { externalIds: string[]; result: ValidationResult } {
    const errors: string[] = [];
    const externalIds: string[] = [];

    for (const value of rawExternalIds) {
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push('DB row has invalid external_id (expected non-empty string).');
        continue;
      }
      externalIds.push(value);
    }

    this.logErrors('DB external_id validation', errors);
    return { externalIds, result: { errors } };
  }

  public validateDbRowsForUpdatedUtcAndId(
    rawRows: Array<unknown>
  ): { items: DriveDbIngestionOrderRow[]; result: ValidationResult } {
    const errors: string[] = [];
    const items: DriveDbIngestionOrderRow[] = [];

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
    items: DriveDbIngestionOrderRow[],
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
