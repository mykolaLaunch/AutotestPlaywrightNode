import { loadEnvOnce } from '../utils/envLoader';

export interface SlackMessageIdsResult {
  ids: string[];
  errors: string[];
  messageDetailsById: Record<string, SlackMessageDetail>;
}

export interface SlackMessageDetailsResult {
  messages: SlackConversationMessage[];
  errors: string[];
}

export interface SlackChannelMessagesResult {
  channelId: string;
  messages: SlackConversationMessage[];
  errors: string[];
}

export interface SlackMessageDetail {
  id: string;
  ts: string;
  threadTs: string;
  date: string;
  text: string;
  user?: string;
  subtype?: string;
}

export interface SlackConversationMessage {
  ts: string;
  threadTs: string;
  text: string;
  user?: string;
  username?: string;
  botId?: string;
  clientMsgId?: string;
  subtype?: string;
  replyCount?: number;
}

export interface SlackSendMessagePayload {
  channel: string;
  text: string;
}

export interface SlackSendMessageResult {
  ok: boolean;
  ts?: string;
  threadTs?: string;
  errors: string[];
}

export interface SlackDeleteMessageResult {
  ok: boolean;
  errors: string[];
}

export interface SlackDeleteAllMessagesResult {
  ok: boolean;
  attempted: number;
  deleted: number;
  skipped: number;
  errors: string[];
}

interface SlackHistoryResponse {
  ok: boolean;
  error?: string;
  messages?: Array<{
    ts?: string;
    thread_ts?: string;
    text?: string;
    user?: string;
    client_msg_id?: string;
    bot_id?: string;
    username?: string;
    subtype?: string;
    reply_count?: number;
  }>;
  response_metadata?: {
    next_cursor?: string;
  };
}

interface SlackRepliesResponse {
  ok: boolean;
  error?: string;
  messages?: Array<{
    ts?: string;
    thread_ts?: string;
    text?: string;
    user?: string;
    client_msg_id?: string;
    bot_id?: string;
    username?: string;
    subtype?: string;
  }>;
  response_metadata?: {
    next_cursor?: string;
  };
}

interface SlackPostMessageResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  message?: {
    ts?: string;
    thread_ts?: string;
  };
}

export class SlackRepository {
  private readonly historyUrl = 'https://slack.com/api/conversations.history';
  private readonly postMessageUrl = 'https://slack.com/api/chat.postMessage';
  private readonly repliesUrl = 'https://slack.com/api/conversations.replies';

  public async getAllMessageIds(channelId: string): Promise<SlackMessageIdsResult> {
    const errors: string[] = [];
    const ids: string[] = [];
    const messageDetailsById: Record<string, SlackMessageDetail> = {};
    const seenThreads = new Set<string>();

    try {
      const token = this.getAuthToken();
      if (!channelId || channelId.trim() === '') {
        throw new Error('Slack channel id is required.');
      }

      let cursor: string | undefined;
      do {
        const res = await this.fetchHistoryPage(token, channelId, cursor);
        if (!res.ok) {
          errors.push(`Slack API error: ${res.error ?? 'unknown_error'}`);
          break;
        }

        const messages = res.messages ?? [];
        for (const msg of messages) {
          if (!msg.ts) {
            continue;
          }
          const threadTs = msg.thread_ts ?? msg.ts;
          if (!seenThreads.has(threadTs)) {
            seenThreads.add(threadTs);
            ids.push(threadTs);
          }
          messageDetailsById[threadTs] = {
            id: threadTs,
            ts: msg.ts,
            threadTs,
            date: this.formatSlackTs(threadTs),
            text: msg.text ?? '(no text)',
            user: msg.user ?? msg.username ?? msg.bot_id,
            subtype: msg.subtype
          };
        }

        const next = res.response_metadata?.next_cursor ?? '';
        cursor = next.trim() === '' ? undefined : next.trim();
      } while (cursor);

      return { ids, errors, messageDetailsById };
    } catch (err) {
      errors.push(
        `Failed to fetch Slack message ids: ${err instanceof Error ? err.message : String(err)}`
      );
      return { ids: [], errors, messageDetailsById: {} };
    }
  }

  public async getAllMessages(channelId: string): Promise<SlackMessageDetailsResult> {
    const errors: string[] = [];
    const messages: SlackConversationMessage[] = [];

    try {
      const token = this.getAuthToken();
      if (!channelId || channelId.trim() === '') {
        throw new Error('Slack channel id is required.');
      }

      let cursor: string | undefined;
      do {
        const res = await this.fetchHistoryPage(token, channelId, cursor);
        if (!res.ok) {
          errors.push(`Slack API error: ${res.error ?? 'unknown_error'}`);
          break;
        }

        const pageMessages = res.messages ?? [];
        for (const msg of pageMessages) {
          if (!msg.ts) {
            continue;
          }
          const threadTs = msg.thread_ts ?? msg.ts;
          messages.push({
            ts: msg.ts,
            threadTs,
            text: msg.text ?? '(no text)',
            user: msg.user,
            username: msg.username,
            botId: msg.bot_id,
            clientMsgId: msg.client_msg_id,
            subtype: msg.subtype,
            replyCount: msg.reply_count
          });
        }

        const next = res.response_metadata?.next_cursor ?? '';
        cursor = next.trim() === '' ? undefined : next.trim();
      } while (cursor);

      return { messages, errors };
    } catch (err) {
      errors.push(
        `Failed to fetch Slack messages: ${err instanceof Error ? err.message : String(err)}`
      );
      return { messages: [], errors };
    }
  }

  public async getAllMessagesWithThreads(
    channelId: string,
    includeThreads: boolean
  ): Promise<SlackMessageDetailsResult> {
    const baseResult = await this.getAllMessages(channelId);
    if (!includeThreads || baseResult.messages.length === 0) {
      return baseResult;
    }

    const errors: string[] = [...baseResult.errors];
    const messages = [...baseResult.messages];
    const seen = new Set(messages.map((msg) => msg.ts));

    const threadsToFetch = baseResult.messages
      .filter((msg) => (msg.replyCount ?? 0) > 0)
      .map((msg) => msg.threadTs);

    for (const threadTs of threadsToFetch) {
      const threadResult = await this.getThreadReplies(channelId, threadTs);
      errors.push(...threadResult.errors);
      for (const msg of threadResult.messages) {
        if (!msg.ts || seen.has(msg.ts)) {
          continue;
        }
        seen.add(msg.ts);
        messages.push(msg);
      }
    }

    return { messages, errors };
  }

  public async getMessagesForChannels(
    channelIds: string[],
    options?: { includeThreads?: boolean }
  ): Promise<SlackChannelMessagesResult[]> {
    const results: SlackChannelMessagesResult[] = [];
    const uniqueIds = [...new Set(channelIds.map((id) => id.trim()).filter((id) => id !== ''))];
    const includeThreads = options?.includeThreads ?? false;

    for (const channelId of uniqueIds) {
      const { messages, errors } = await this.getAllMessagesWithThreads(channelId, includeThreads);
      results.push({ channelId, messages, errors });
    }

    return results;
  }

  public async sendMessage(payload: SlackSendMessagePayload): Promise<SlackSendMessageResult> {
    const errors: string[] = [];
    try {
      const token = this.getAuthToken();
      if (!payload.channel || payload.channel.trim() === '') {
        throw new Error('Slack channel id is required.');
      }

      const res = await fetch(this.postMessageUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          channel: payload.channel,
          text: payload.text
        })
      });

      if (!res.ok) {
        return { ok: false, errors: [`Slack API http_${res.status}`] };
      }

      const data = (await res.json()) as SlackPostMessageResponse;
      if (!data.ok) {
        return { ok: false, errors: [data.error ?? 'Slack API error: unknown_error'] };
      }

      const ts = data.ts ?? data.message?.ts;
      const threadTs = data.message?.thread_ts;
      return { ok: true, ts, threadTs, errors };
    } catch (err) {
      errors.push(
        `Failed to send Slack message: ${err instanceof Error ? err.message : String(err)}`
      );
      return { ok: false, errors };
    }
  }

  public async deleteMessage(channel: string, ts: string): Promise<SlackDeleteMessageResult> {
    const errors: string[] = [];
    try {
      const token = this.getAuthToken();
      if (!channel || channel.trim() === '') {
        throw new Error('Slack channel id is required.');
      }
      if (!ts || ts.trim() === '') {
        throw new Error('Slack message ts is required.');
      }

      const res = await fetch('https://slack.com/api/chat.delete', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          channel,
          ts
        })
      });

      if (!res.ok) {
        return { ok: false, errors: [`Slack API http_${res.status}`] };
      }

      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        return { ok: false, errors: [data.error ?? 'Slack API error: unknown_error'] };
      }

      return { ok: true, errors };
    } catch (err) {
      errors.push(
        `Failed to delete Slack message: ${err instanceof Error ? err.message : String(err)}`
      );
      return { ok: false, errors };
    }
  }

  public async deleteAllMessages(
    channel: string,
    options?: { delayMs?: number; max?: number; botOnly?: boolean }
  ): Promise<SlackDeleteAllMessagesResult> {
    const errors: string[] = [];
    const delayMs = Math.max(0, options?.delayMs ?? 300);
    const max = options?.max ?? Number.POSITIVE_INFINITY;
    const botOnly = options?.botOnly ?? true;

    if (!channel || channel.trim() === '') {
      return {
        ok: false,
        attempted: 0,
        deleted: 0,
        skipped: 0,
        errors: ['Slack channel id is required.']
      };
    }

    const { messages, errors: fetchErrors } = await this.getAllMessages(channel);
    errors.push(...fetchErrors);

    const seen = new Set<string>();
    let attempted = 0;
    let deleted = 0;
    let skipped = 0;

    for (const msg of messages) {
      if (!msg.ts || seen.has(msg.ts)) {
        continue;
      }
      seen.add(msg.ts);
      if (botOnly && !this.isBotMessage(msg)) {
        skipped += 1;
        continue;
      }
      attempted += 1;
      if (attempted > max) {
        break;
      }

      const result = await this.deleteMessageWithRetry(channel, msg.ts);
      if (!result.ok) {
        for (const err of result.errors) {
          errors.push(`ts=${msg.ts}: ${err}`);
        }
      } else {
        deleted += 1;
      }

      if (delayMs > 0) {
        await this.sleep(delayMs);
      }
    }

    return { ok: errors.length === 0, attempted, deleted, skipped, errors };
  }

  private async fetchHistoryPage(
    token: string,
    channelId: string,
    cursor?: string
  ): Promise<SlackHistoryResponse> {
    const params = new URLSearchParams({
      channel: channelId,
      limit: '200'
    });
    if (cursor) {
      params.set('cursor', cursor);
    }

    const res = await fetch(this.historyUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!res.ok) {
      return {
        ok: false,
        error: `http_${res.status}`
      };
    }

    return (await res.json()) as SlackHistoryResponse;
  }

  private async fetchRepliesPage(
    token: string,
    channelId: string,
    threadTs: string,
    cursor?: string
  ): Promise<SlackRepliesResponse> {
    const params = new URLSearchParams({
      channel: channelId,
      ts: threadTs,
      limit: '200'
    });
    if (cursor) {
      params.set('cursor', cursor);
    }

    const res = await fetch(this.repliesUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!res.ok) {
      return {
        ok: false,
        error: `http_${res.status}`
      };
    }

    return (await res.json()) as SlackRepliesResponse;
  }

  private async getThreadReplies(
    channelId: string,
    threadTs: string
  ): Promise<SlackMessageDetailsResult> {
    const errors: string[] = [];
    const messages: SlackConversationMessage[] = [];

    try {
      const token = this.getAuthToken();
      if (!channelId || channelId.trim() === '') {
        throw new Error('Slack channel id is required.');
      }
      if (!threadTs || threadTs.trim() === '') {
        throw new Error('Slack thread ts is required.');
      }

      let cursor: string | undefined;
      do {
        const res = await this.fetchRepliesPage(token, channelId, threadTs, cursor);
        if (!res.ok) {
          errors.push(`Slack API error: ${res.error ?? 'unknown_error'}`);
          break;
        }

        const pageMessages = res.messages ?? [];
        for (const msg of pageMessages) {
          if (!msg.ts) {
            continue;
          }
          const thread = msg.thread_ts ?? threadTs;
          messages.push({
            ts: msg.ts,
            threadTs: thread,
            text: msg.text ?? '(no text)',
            user: msg.user,
            username: msg.username,
            botId: msg.bot_id,
            clientMsgId: msg.client_msg_id,
            subtype: msg.subtype
          });
        }

        const next = res.response_metadata?.next_cursor ?? '';
        cursor = next.trim() === '' ? undefined : next.trim();
      } while (cursor);

      return { messages, errors };
    } catch (err) {
      errors.push(
        `Failed to fetch Slack thread replies: ${err instanceof Error ? err.message : String(err)}`
      );
      return { messages: [], errors };
    }
  }


  private formatSlackTs(ts: string): string {
    const ms = this.parseSlackTsToMs(ts);
    if (ms === null) return 'unknown date';
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  }

  private parseSlackTsToMs(ts: string): number | null {
    const parsed = Number(ts);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    const ms = Math.round(parsed * 1000);
    return Number.isFinite(ms) ? ms : null;
  }

  private getAuthToken(): string {
    loadEnvOnce();
    const token =
      process.env.SLACK_BOT_USER_ACCESS_TOKEN ||
      process.env.SLACK_ACCESS_TOKEN ||
      '';

    if (!token) {
      throw new Error('Missing Slack token. Set SLACK_BOT_USER_ACCESS_TOKEN or SLACK_ACCESS_TOKEN.');
    }

    return token;
  }

  private isBotMessage(msg: SlackConversationMessage): boolean {
    return Boolean(msg.botId) || msg.subtype === 'bot_message';
  }

  private async deleteMessageWithRetry(
    channel: string,
    ts: string
  ): Promise<SlackDeleteMessageResult> {
    const first = await this.deleteMessage(channel, ts);
    if (first.ok) {
      return first;
    }

    const hasRateLimit = first.errors.some((err) => err.includes('http_429'));
    if (!hasRateLimit) {
      return first;
    }

    await this.sleep(1500);
    return this.deleteMessage(channel, ts);
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
