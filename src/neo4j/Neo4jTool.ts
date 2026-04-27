import neo4j, { Driver, Session } from 'neo4j-driver';
import fs from 'fs';
import path from 'path';

type RequiredEnv = {
  uri: string;
  login: string;
  password: string;
  database: string;
};

export abstract class Neo4jTool {
  private static envLoaded = false;
  private readonly env: RequiredEnv;

  constructor() {
    Neo4jTool.loadEnvIfNeeded();
    this.env = this.readEnvConfig();
  }

  protected async withSession<T>(action: (session: Session) => Promise<T>): Promise<T> {
    const driver = this.createDriver();
    const session = driver.session({ database: this.env.database });
    try {
      return await action(session);
    } finally {
      await session.close();
      await driver.close();
    }
  }

  protected toSafeNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (value && typeof value === 'object') {
      const candidate = value as { toNumber?: () => number; low?: unknown; high?: unknown };
      if (typeof candidate.toNumber === 'function') {
        const parsed = candidate.toNumber();
        return Number.isFinite(parsed) ? parsed : null;
      }
      if (typeof candidate.low === 'number' && typeof candidate.high === 'number') {
        return candidate.high * 2 ** 32 + candidate.low;
      }
    }
    return null;
  }

  protected toDateMs(value: unknown): number | null {
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isNaN(ms) ? null : ms;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = new Date(value).getTime();
      return Number.isNaN(parsed) ? null : parsed;
    }
    if (value && typeof value === 'object' && typeof (value as { toString?: unknown }).toString === 'function') {
      const parsed = new Date(String(value)).getTime();
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  private createDriver(): Driver {
    return neo4j.driver(this.env.uri, neo4j.auth.basic(this.env.login, this.env.password));
  }

  private readEnvConfig(): RequiredEnv {
    const { NEO4J_URI, NEO4J_LOGIN, NEO4J_PASSWORD, NEO4J_DATABASE } = process.env;

    if (!NEO4J_LOGIN || !NEO4J_PASSWORD || !NEO4J_DATABASE) {
      throw new Error(
        'Neo4j configuration is missing. Please set NEO4J_LOGIN, NEO4J_PASSWORD, NEO4J_DATABASE in .env'
      );
    }

    return {
      uri: NEO4J_URI || 'bolt://localhost:7687',
      login: NEO4J_LOGIN,
      password: NEO4J_PASSWORD,
      database: NEO4J_DATABASE
    };
  }

  /**
   * Minimal .env loader (without dotenv). Loads values only if they are not already set.
   */
  private static loadEnvIfNeeded(): void {
    if (Neo4jTool.envLoaded) return;

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

    Neo4jTool.envLoaded = true;
  }
}
