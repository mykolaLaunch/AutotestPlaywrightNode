import { Client, ClientConfig, QueryResultRow } from 'pg';
import fs from 'fs';
import path from 'path';

type RequiredEnv = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export abstract class DBTool {
  private static envLoaded = false;
  private readonly clientConfig: ClientConfig;

  constructor(config?: Partial<ClientConfig>) {
    DBTool.loadEnvIfNeeded();
    const envConfig = this.readEnvConfig();
    this.clientConfig = {
      host: envConfig.host,
      port: envConfig.port,
      user: envConfig.user,
      password: envConfig.password,
      database: envConfig.database,
      ...config
    };
  }

  /**
   * Executes a SELECT query and returns all rows.
   */
  protected async selectAction<T extends QueryResultRow = Record<string, unknown>>(
    sql: string
  ): Promise<T[]> {
    const client = new Client(this.clientConfig);
    await client.connect();
    try {
      const { rows } = await client.query<T>(sql);
      return rows;
    } finally {
      await client.end();
    }
  }

  /**
   * Executes a query where no result set is required (INSERT/UPDATE/DELETE).
   */
  protected async nonSelectAction(sql: string): Promise<void> {
    const client = new Client(this.clientConfig);
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  }

  private readEnvConfig(): RequiredEnv {
    const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

    if (!DB_HOST || !DB_PORT || !DB_USER || !DB_PASSWORD || !DB_NAME) {
      throw new Error(
        'Database configuration is missing. Please set DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME in .env'
      );
    }

    const port = Number(DB_PORT);
    if (Number.isNaN(port)) {
      throw new Error('DB_PORT must be a valid number');
    }

    return {
      host: DB_HOST,
      port,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME
    };
  }

  /**
   * Minimal .env loader (without dotenv). Loads values only if they are not already set.
   */
  private static loadEnvIfNeeded(): void {
    if (DBTool.envLoaded) return;

    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .forEach((line) => {
          const eqIdx = line.indexOf('=');
          if (eqIdx === -1) return;
          const key = line.slice(0, eqIdx).trim();
          const value = line.slice(eqIdx + 1).trim();
          if (!process.env[key]) {
            process.env[key] = value;
          }
        });
    }

    DBTool.envLoaded = true;
  }
}
