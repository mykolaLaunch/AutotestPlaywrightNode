import { DBTool } from '../DBTool';

export interface RawItemRow {
  [key: string]: unknown;
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
}
