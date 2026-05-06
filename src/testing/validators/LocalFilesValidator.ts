import { ValidationResult } from './ValidationResult';
import { LocalFileDbSnapshot, LocalFileNeo4jSnapshot } from '../repositories/LocalFilesRepository';

export class LocalFilesValidator {
  public validateCreatedInBothStorages(
    externalId: string,
    dbSnapshot: LocalFileDbSnapshot,
    neo4jSnapshot: LocalFileNeo4jSnapshot
  ): ValidationResult {
    const errors: string[] = [];

    if (dbSnapshot.rowCount < 1) {
      errors.push(`DB has no rows for external_id=${externalId}.`);
    }
    if (dbSnapshot.latestId === null) {
      errors.push(`DB latest id is invalid for external_id=${externalId}.`);
    }
    if (dbSnapshot.updatedTimeMs === null) {
      errors.push(`DB updated_time is invalid for external_id=${externalId}.`);
    }
    if (neo4jSnapshot.rowCount < 1) {
      errors.push(`Neo4j has no rows for externalId=${externalId}.`);
    }
    if (neo4jSnapshot.latestRawVersionId === null) {
      errors.push(`Neo4j latest rawVersionId is invalid for externalId=${externalId}.`);
    }

    return { errors };
  }

  public validateUpdatedInBothStorages(
    externalId: string,
    beforeDb: LocalFileDbSnapshot,
    afterDb: LocalFileDbSnapshot,
    beforeNeo4j: LocalFileNeo4jSnapshot,
    afterNeo4j: LocalFileNeo4jSnapshot,
    expectedUpdatedContentMarker: string
  ): ValidationResult {
    const errors: string[] = [];

    if (beforeDb.updatedTimeMs !== null && afterDb.updatedTimeMs !== null && afterDb.updatedTimeMs <= beforeDb.updatedTimeMs) {
      errors.push(
        `DB updated_time did not increase for external_id=${externalId}: before=${beforeDb.updatedTimeMs}, after=${afterDb.updatedTimeMs}.`
      );
    }

    if (typeof afterNeo4j.latestText !== 'string' || !afterNeo4j.latestText.includes(expectedUpdatedContentMarker)) {
      errors.push(`Neo4j content mismatch for externalId=${externalId}: expected marker "${expectedUpdatedContentMarker}" was not found.`);
    }

    if (
      beforeNeo4j.latestRawVersionId !== null &&
      afterNeo4j.latestRawVersionId !== null &&
      afterNeo4j.latestRawVersionId <= beforeNeo4j.latestRawVersionId
    ) {
      errors.push(
        `Neo4j rawVersionId did not increase for externalId=${externalId}: before=${beforeNeo4j.latestRawVersionId}, after=${afterNeo4j.latestRawVersionId}.`
      );
    }

    if (
      beforeNeo4j.latestCreatedAtMs !== null &&
      afterNeo4j.latestCreatedAtMs !== null &&
      afterNeo4j.latestCreatedAtMs < beforeNeo4j.latestCreatedAtMs
    ) {
      errors.push(
        `Neo4j createdAtUtc moved backwards for externalId=${externalId}: before=${beforeNeo4j.latestCreatedAtMs}, after=${afterNeo4j.latestCreatedAtMs}.`
      );
    }

    return { errors };
  }
}
