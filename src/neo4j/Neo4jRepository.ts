import { Neo4jTool } from './Neo4jTool';

export class Neo4jRepository extends Neo4jTool {
  async clearDatabase(): Promise<void> {
    await this.withSession(async (session) => {
      await session.run('MATCH (n) DETACH DELETE n');
    });
  }
}
