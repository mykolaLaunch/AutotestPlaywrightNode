import { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseApiRepository } from './BaseApiRepository';

export class AdminConnectorsRepository extends BaseApiRepository {
  protected endpoint = '/admin/connectors';

  constructor(request: APIRequestContext, apiBaseUrl: string) {
    super(request, apiBaseUrl);
  }

  public async getDefinitionsRaw(): Promise<APIResponse> {
    return this.request.get(`${this.getCompleteUrl()}/definitions`, {
      headers: this.getResponseTypeHeaders(true)
    });
  }

  public async parseDefinitionsResponse(
    response: APIResponse
  ): Promise<{ body: unknown[] | null; errors: string[] }> {
    const errors: string[] = [];
    try {
      const body = await this.parseJsonResponse<unknown>(response);
      if (!Array.isArray(body)) {
        errors.push('Connector definitions response should be an array.');
        return { body: null, errors };
      }
      return { body, errors };
    } catch (err) {
      errors.push(
        `Failed to parse connector definitions JSON: ${err instanceof Error ? err.message : String(err)}`
      );
      return { body: null, errors };
    }
  }

  public async postRescanRaw(): Promise<APIResponse> {
    return this.request.post(`${this.getCompleteUrl()}/rescan`, {
      headers: this.getResponseTypeHeaders(false)
    });
  }
}
