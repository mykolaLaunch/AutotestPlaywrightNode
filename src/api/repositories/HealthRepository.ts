import { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseApiRepository } from './BaseApiRepository';

export class HealthRepository extends BaseApiRepository {
  protected endpoint = '/health';

  constructor(request: APIRequestContext, apiBaseUrl: string) {
    super(request, apiBaseUrl);
  }

  public async getHealthRaw(): Promise<APIResponse> {
    return this.request.get(this.getCompleteUrl(), {
      headers: this.getResponseTypeHeaders(false)
    });
  }

  public async readTextResponse(
    response: APIResponse
  ): Promise<{ body: string | null; errors: string[] }> {
    const errors: string[] = [];
    try {
      const body = await response.text();
      return { body, errors };
    } catch (err) {
      errors.push(
        `Failed to read /health response text: ${err instanceof Error ? err.message : String(err)}`
      );
      return { body: null, errors };
    }
  }
}
