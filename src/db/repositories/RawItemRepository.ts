import { DBTool } from '../DBTool';

export interface RawItemRow {
  [key: string]: unknown;
}

export interface RawItemPollAttempt {
  attempt: number;
  found: boolean;
  rowCount: number;
  at: string;
}

export class RawItemRepository extends DBTool {
  /**
   * Returns rows from raw.raw_item for a specific source_account,
   * ordered by created_utc descending.
   */
  public async getBySourceAccount(sourceAccount: string): Promise<RawItemRow[]> {
    const safeAccount = sourceAccount.replace(/'/g, "''");
    const sql = `
      SELECT ri.*
      FROM raw.raw_item AS ri
      WHERE source_account = '${safeAccount}'
      ORDER BY ri.created_utc DESC
    `;
    return this.selectAction<RawItemRow>(sql);
  }

  /**
   * Returns rows from raw.raw_item for a specific source,
   * ordered by created_utc descending.
   */
  public async getBySource(source: string): Promise<RawItemRow[]> {
    const safeSource = source.replace(/'/g, "''");
    const sql = `
      SELECT ri.*
      FROM raw.raw_item AS ri
      WHERE source = '${safeSource}'
      ORDER BY ri.created_utc DESC
    `;
    return this.selectAction<RawItemRow>(sql);
  }

  /**
   * Returns rows from raw.raw_item for a specific source and source_account,
   * ordered by created_utc descending.
   */
  public async getBySourceAndAccount(source: string, sourceAccount: string): Promise<RawItemRow[]> {
    const safeSource = source.replace(/'/g, "''");
    const safeAccount = sourceAccount.replace(/'/g, "''");
    const sql = `
      SELECT ri.*
      FROM raw.raw_item AS ri
      WHERE source = '${safeSource}'
        AND source_account = '${safeAccount}'
      ORDER BY ri.created_utc DESC
    `;
    return this.selectAction<RawItemRow>(sql);
  }

  /**
   * Returns rows from raw.raw_item for a specific source and source_account,
   * ordered by created_utc descending and limited.
   */
  public async getBySourceAndAccountLimited(
    source: string,
    sourceAccount: string,
    limit: number = 1000
  ): Promise<RawItemRow[]> {
    const safeSource = source.replace(/'/g, "''");
    const safeAccount = sourceAccount.replace(/'/g, "''");
    const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 1000;
    const sql = `
      SELECT ri.*
      FROM raw.raw_item AS ri
      WHERE source = '${safeSource}'
        AND source_account = '${safeAccount}'
      ORDER BY ri.created_utc DESC
      LIMIT ${safeLimit}
    `;
    return this.selectAction<RawItemRow>(sql);
  }

  /**
   * Returns one row from raw.raw_item by id.
   * Includes explicit number validation to prevent SQL injection.
   */
  public async getById(id: number): Promise<RawItemRow | null> {
    if (!Number.isFinite(id)) {
      throw new Error('RawItemRepository.getById: id must be a finite number');
    }

    const sql = `
      SELECT ri.*
      FROM raw.raw_item AS ri
      WHERE ri.id = ${id}
      LIMIT 1
    `;

    const rows = await this.selectAction<RawItemRow>(sql);
    return rows[0] ?? null;
  }

  /**
   * Returns the latest raw.raw_item id (by id desc).
   */
  public async getLatestId(): Promise<number | null> {
    const sql = `
      SELECT ri.id
      FROM raw.raw_item AS ri
      ORDER BY ri.id DESC
      LIMIT 1
    `;
    const rows = await this.selectAction<{ id?: number }>(sql);
    const idValue = rows[0]?.id;
    if (idValue === undefined || idValue === null) {
      return null;
    }
    const parsed = typeof idValue === 'number' ? idValue : Number.parseInt(String(idValue), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * Returns rows from raw.raw_item for a specific source and external_id,
   * ordered by created_utc descending.
   */
  public async getBySourceAndExternalId(source: string, externalId: string): Promise<RawItemRow[]> {
    const safeSource = source.replace(/'/g, "''");
    const safeExternalId = externalId.replace(/'/g, "''");
    const sql = `
      SELECT ri.*
      FROM raw.raw_item AS ri
      WHERE source = '${safeSource}'
        AND external_id = '${safeExternalId}'
      ORDER BY ri.created_utc DESC
    `;
    return this.selectAction<RawItemRow>(sql);
  }

  /**
   * Returns rows from raw.raw_item for a specific source and external_thread,
   * ordered by created_utc descending.
   */
  public async getBySourceAndExternalThread(
    source: string,
    externalThread: string
  ): Promise<RawItemRow[]> {
    const safeSource = source.replace(/'/g, "''");
    const safeExternalThread = externalThread.replace(/'/g, "''");
    const sql = `
      SELECT ri.*
      FROM raw.raw_item AS ri
      WHERE source = '${safeSource}'
        AND external_thread = '${safeExternalThread}'
      ORDER BY ri.created_utc DESC
    `;
    return this.selectAction<RawItemRow>(sql);
  }

  public async pollBySourceAndExternalId(
    source: string,
    externalId: string,
    maxAttempts: number = 40,
    waitMs: number = 3000
  ): Promise<{ rows: RawItemRow[]; attempts: RawItemPollAttempt[] }> {
    const attempts: RawItemPollAttempt[] = [];
    let rows: RawItemRow[] = [];

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
}
