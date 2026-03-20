import { loadEnvOnce } from '../utils/envLoader';

export interface SlackMessageIdsResult {
  ids: string[];
  errors: string[];
  messageDetailsById: Record<string, SlackMessageDetail>;
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

interface SlackHistoryResponse {
  ok: boolean;
  error?: string;
  messages?: Array<{
    ts?: string;
    thread_ts?: string;
    text?: string;
    user?: string;
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
}
