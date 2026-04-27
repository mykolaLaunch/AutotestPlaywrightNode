import { test, expect } from '../testLogger';
import { mergeResults } from '../../src/testing/validators/ValidationResult';
import { HealthRepository } from '../../src/api/repositories/HealthRepository';
import { AdminConnectorsRepository } from '../../src/api/repositories/AdminConnectorsRepository';
import { AdminConnectorsValidator } from '../../src/testing/validators/AdminConnectorsValidator';

test.describe('Admin health/connectors contracts', { tag: ['@api', '@admin', '@contracts', '@smoke'] }, () => {
  test('GET /health returns alive response', async ({ request }) => {
    // const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5198';
    const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5199';
    const healthRepository = new HealthRepository(request, apiBaseUrl);
    const validator = new AdminConnectorsValidator();

    console.info('--- Contract test start: GET /health');
    const response = await healthRepository.getHealthRaw();
    const parsed = await healthRepository.readTextResponse(response);

    const result = mergeResults(
      validator.validateHealthStatus(response.status()),
      validator.validateHealthBody(parsed.body),
      { errors: parsed.errors }
    );

    test.info().attach('health_response', {
      body: JSON.stringify(
        {
          status: response.status(),
          body: parsed.body
        },
        null,
        2
      ),
      contentType: 'application/json'
    });

    expect(result.errors, result.errors.join('\n')).toHaveLength(0);
    console.info('--- Contract test end: GET /health');
  });

  test('GET /admin/connectors/definitions returns connector contracts', async ({ request }) => {
    const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5199';
    const adminConnectorsRepository = new AdminConnectorsRepository(request, apiBaseUrl);
    const validator = new AdminConnectorsValidator();

    console.info('--- Contract test start: GET /admin/connectors/definitions');
    const response = await adminConnectorsRepository.getDefinitionsRaw();
    const parsed = await adminConnectorsRepository.parseDefinitionsResponse(response);

    const result = mergeResults(
      validator.validateDefinitionsStatus(response.status()),
      validator.validateDefinitionsBody(parsed.body),
      { errors: parsed.errors }
    );

    test.info().attach('connectors_definitions_response', {
      body: JSON.stringify(
        {
          status: response.status(),
          definitionsCount: Array.isArray(parsed.body) ? parsed.body.length : null
        },
        null,
        2
      ),
      contentType: 'application/json'
    });

    expect(result.errors, result.errors.join('\n')).toHaveLength(0);
    console.info('--- Contract test end: GET /admin/connectors/definitions');
  });

  test('POST /admin/connectors/rescan succeeds and definitions remain available', async ({ request }) => {
    const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5199';
    const adminConnectorsRepository = new AdminConnectorsRepository(request, apiBaseUrl);
    const validator = new AdminConnectorsValidator();

    console.info('--- Contract test start: POST /admin/connectors/rescan');
    const beforeResponse = await adminConnectorsRepository.getDefinitionsRaw();
    const beforeParsed = await adminConnectorsRepository.parseDefinitionsResponse(beforeResponse);

    const rescanResponse = await adminConnectorsRepository.postRescanRaw();

    const afterResponse = await adminConnectorsRepository.getDefinitionsRaw();
    const afterParsed = await adminConnectorsRepository.parseDefinitionsResponse(afterResponse);

    const result = mergeResults(
      validator.validateDefinitionsStatus(beforeResponse.status()),
      validator.validateDefinitionsBody(beforeParsed.body),
      validator.validateRescanStatus(rescanResponse.status()),
      validator.validateDefinitionsStatus(afterResponse.status()),
      validator.validateDefinitionsBody(afterParsed.body),
      { errors: beforeParsed.errors },
      { errors: afterParsed.errors }
    );

    test.info().attach('rescan_contract_summary', {
      body: JSON.stringify(
        {
          beforeStatus: beforeResponse.status(),
          beforeCount: Array.isArray(beforeParsed.body) ? beforeParsed.body.length : null,
          rescanStatus: rescanResponse.status(),
          afterStatus: afterResponse.status(),
          afterCount: Array.isArray(afterParsed.body) ? afterParsed.body.length : null
        },
        null,
        2
      ),
      contentType: 'application/json'
    });

    expect(result.errors, result.errors.join('\n')).toHaveLength(0);
    console.info('--- Contract test end: POST /admin/connectors/rescan');
  });

  test('GET /admin/connectors/definitions enforces auth boundary', async ({
    request
  }) => {
    const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5199';
    const adminConnectorsRepository = new AdminConnectorsRepository(request, apiBaseUrl);
    const validator = new AdminConnectorsValidator();

    console.info('--- Contract test start: unauthorized GET /admin/connectors/definitions');
    const response = await adminConnectorsRepository.getDefinitionsRaw();
    const result = validator.validateAuthBoundaryStatus(
      response.status(),
      '/admin/connectors/definitions'
    );

    expect(result.errors, result.errors.join('\n')).toHaveLength(0);
    console.info('--- Contract test end: unauthorized GET /admin/connectors/definitions');
  });

  test('POST /admin/connectors/rescan enforces auth boundary', async ({
    request
  }) => {
    const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5198';
    const adminConnectorsRepository = new AdminConnectorsRepository(request, apiBaseUrl);
    const validator = new AdminConnectorsValidator();

    console.info('--- Contract test start: unauthorized POST /admin/connectors/rescan');
    const response = await adminConnectorsRepository.postRescanRaw();
    const result = validator.validateAuthBoundaryStatus(response.status(), '/admin/connectors/rescan');

    expect(result.errors, result.errors.join('\n')).toHaveLength(0);
    console.info('--- Contract test end: unauthorized POST /admin/connectors/rescan');
  });
});
