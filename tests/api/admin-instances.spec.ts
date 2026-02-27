import { test } from '@playwright/test';
import { AdminInstancesRepository } from '../../src/api/repositories/AdminInstancesRepository';
import { AdminInstancesValidator } from '../../src/api/validators/AdminInstancesValidator';

test('GET /admin/instances returns valid instances list', async ({ request }) => {
    const repository = new AdminInstancesRepository(
        request,
        process.env.API_BASE_URL ?? 'https://localhost:5199'
    );

    const response = await repository.getAdminInstancesRaw();

    const validator = new AdminInstancesValidator();
    await validator.validate(response);
});