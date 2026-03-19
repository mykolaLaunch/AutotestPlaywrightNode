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

export class SlackRepository {
  private readonly historyUrl = 'https://slack.com/api/conversations.history';

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
