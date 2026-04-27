import { Neo4jRepository } from '../src/neo4j/Neo4jRepository';
import { SystemCleanupRepository } from '../src/db/repositories/SystemCleanupRepository';
import { SlackRepository } from '../src/testing/repositories/SlackRepository';
import { loadEnvOnce } from '../src/testing/utils/envLoader';

const run = async (): Promise<void> => {
  loadEnvOnce();
  const sqlRepo = new SystemCleanupRepository();
  const neo4jRepo = new Neo4jRepository();

  console.log('Cleaning SQL database...');
  await sqlRepo.clearSqlData();
  console.log('SQL cleanup done.');

  console.log('Cleaning Neo4j database...');
  await neo4jRepo.clearDatabase();
  console.log('Neo4j cleanup done.');

  const slackChannelId = process.env.SLACK_TEST_CHANNEL_ID ?? '';
  if (!slackChannelId) {
    console.log('Skipping Slack cleanup: SLACK_TEST_CHANNEL_ID is not set.');
    return;
  }

  console.log('Cleaning Slack test channel messages...');
  const slackRepo = new SlackRepository();
  const result = await slackRepo.deleteAllMessages(slackChannelId, { delayMs: 300, botOnly: true });
  console.log(
    `Slack cleanup done. Attempted=${result.attempted} Deleted=${result.deleted} Skipped=${result.skipped} Errors=${result.errors.length}`
  );
  if (result.errors.length > 0) {
    console.error(`Slack cleanup errors:\n${result.errors.join('\n')}`);
    throw new Error('Slack cleanup failed.');
  }
};

run().catch((error) => {
  console.error('Cleanup failed:', error);
  process.exitCode = 1;
});
