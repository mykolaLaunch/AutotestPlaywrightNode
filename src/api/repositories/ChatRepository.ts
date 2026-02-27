import { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseApiRepository } from './BaseApiRepository';
import { ChatRequestPayload, ChatResponse } from '../models/chat';

export class ChatRepository extends BaseApiRepository {
  protected endpoint = '/chat';

  constructor(request: APIRequestContext, apiBaseUrl: string) {
    super(request, apiBaseUrl);
  }

  /**
   * Отправляет запрос в чат и возвращает десериализованный ответ.
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
}
