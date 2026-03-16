import { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseApiRepository } from './BaseApiRepository';
import { ChatRequestPayload, ChatResponse } from '../models/chat';

export class ChatRepository extends BaseApiRepository {
  protected endpoint = '/chat';

  constructor(request: APIRequestContext, apiBaseUrl: string) {
    super(request, apiBaseUrl);
  }

  /**
   * Sends a chat request and returns the parsed response model.
   */
  public async sendChat(payload: ChatRequestPayload): Promise<ChatResponse> {
    const response = await this.sendChatRaw(payload);
    return this.processSuccessResponse<ChatResponse>(response);
  }

  public async sendChatRaw(payload: ChatRequestPayload): Promise<APIResponse> {
    return this.request.post(this.getCompleteUrl(), {
      headers: this.getResponseTypeHeaders(true),
      data: payload
    });
  }

  public async parseChatResponse(
    response: APIResponse
  ): Promise<{ body: ChatResponse | null; errors: string[] }> {
    const errors: string[] = [];
    try {
      const body = await this.parseJsonResponse<ChatResponse>(response);
      return { body, errors };
    } catch (err) {
      errors.push(
        `Failed to parse chat response JSON: ${err instanceof Error ? err.message : String(err)}`
      );
      return { body: null, errors };
    }
  }
}
