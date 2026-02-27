import { APIRequestContext, APIResponse, expect } from '@playwright/test';

export abstract class BaseApiRepository {
  protected readonly request: APIRequestContext;
  protected readonly baseUrl: string;
  protected endpoint = '';
  private isUseJsonResponse = false;

  protected constructor(request: APIRequestContext, baseUrl: string) {
    this.request = request;
    this.baseUrl = baseUrl;
  }

  public useJsonResponse(useJson = true): this {
    this.isUseJsonResponse = useJson;
    return this;
  }

  protected getResponseTypeHeaders(isJson?: boolean): Record<string, string> {
    if (isJson || this.isUseJsonResponse) {
      return {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      };
    }

    return {
      Accept: 'text/plain'
    };
  }

  protected getCompleteUrl(): string {
    return `${this.baseUrl}${this.endpoint}`;
  }

  public checkForApiErrors(response: string | Record<string, unknown>): void {
    const objectResponse =
      typeof response === 'string' ? (JSON.parse(response) as Record<string, unknown>) : response;

    if (!objectResponse || typeof objectResponse !== 'object') {
      throw new Error('Пустой или невалидный ответ API');
    }

    const root = (objectResponse.root as Record<string, unknown> | undefined) ?? objectResponse;
    const apiError = root.error;

    if (typeof apiError === 'string' && apiError.length > 0) {
      throw new Error(`API returned error: ${apiError}`);
    }
  }

  private async processResponse(responseText: string): Promise<unknown> {
    return JSON.parse(responseText);
  }

  public async processSuccessResponse<T>(response: APIResponse): Promise<T> {
    await expect(response).toBeOK();
    const responseText = await response.text();
    const result = (await this.processResponse(responseText)) as T;
    this.checkForApiErrors(result as Record<string, unknown>);
    return result;
  }

  public async processFailedResponse<T>(response: APIResponse): Promise<T> {
    await expect(response).not.toBeOK();
    const responseText = await response.text();
    return (await this.processResponse(responseText)) as T;
  }
}
