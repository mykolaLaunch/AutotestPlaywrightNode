import { DBTool } from '../DBTool';

export class SystemCleanupRepository extends DBTool {
  async clearSqlData(): Promise<void> {
    await this.nonSelectAction('delete from raw.raw_version;');
    await this.nonSelectAction('delete from raw.raw_item;');
    await this.nonSelectAction('delete from chat."session";');
    await this.nonSelectAction('delete from ops.settings;');
  }
}
