import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { loadEnvOnce } from '../utils/envLoader';

export interface GmailMessageIdsResult {
  ids: string[];
  errors: string[];
}

export interface GmailMessageDetail {
  id: string;
  labelNames: string[];
  date: string;
  subject: string;
}

export interface GmailMessageDetailsResult {
  details: GmailMessageDetail[];
  errors: string[];
}

export class GmailRepository {
  private readonly tokenPath: string;
  private readonly credentialsPath: string;

  constructor(
    tokenPath: string = path.resolve(process.cwd(), 'secrets', 'token.json'),
    credentialsPath: string = path.resolve(process.cwd(), 'secrets', 'google-oauth-client.json')
  ) {
    this.tokenPath = tokenPath;
    this.credentialsPath = credentialsPath;
  }

  public async getAllMessageIds(userId: string = 'me'): Promise<GmailMessageIdsResult> {
    const errors: string[] = [];
    try {
      const auth = await this.buildAuthClient();
      const gmail = google.gmail({ version: 'v1', auth });

      const ids: string[] = [];
      let pageToken: string | undefined;

      do {
        const res = await gmail.users.messages.list({
          userId,
          maxResults: 500,
          pageToken
        });

        const messages = res.data.messages ?? [];
        for (const msg of messages) {
          if (msg.id) {
            ids.push(msg.id);
          }
        }

        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);

      return { ids, errors };
    } catch (err) {
      errors.push(
        `Failed to fetch Gmail message ids: ${err instanceof Error ? err.message : String(err)}`
      );
      return { ids: [], errors };
    }
  }

  public async getMessageDetails(
    userId: string = 'me',
    messageIds: string[],
    limit: number = 10
  ): Promise<GmailMessageDetailsResult> {
    const errors: string[] = [];
    try {
      const auth = await this.buildAuthClient();
      const gmail = google.gmail({ version: 'v1', auth });

      const labelMap = await this.fetchLabelMap(gmail, userId);
      const ids = messageIds.slice(0, Math.max(0, limit));
      const details: GmailMessageDetail[] = [];

      for (const id of ids) {
        const res = await gmail.users.messages.get({
          userId,
          id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'Date']
        });

        const labelIds = res.data.labelIds ?? [];
        const labelNames =
          labelIds.length > 0 ? labelIds.map((labelId) => labelMap.get(labelId) ?? labelId) : ['(no labels)'];

        const headers = res.data.payload?.headers ?? [];
        const subject = this.getHeaderValue(headers, 'Subject') ?? '(no subject)';
        const dateHeader = this.getHeaderValue(headers, 'Date');
        const date = this.formatDate(dateHeader, res.data.internalDate);

        details.push({ id, labelNames, date, subject });
      }

      return { details, errors };
    } catch (err) {
      errors.push(
        `Failed to fetch Gmail message details: ${err instanceof Error ? err.message : String(err)}`
      );
      return { details: [], errors };
    }
  }

  private async buildAuthClient() {
    loadEnvOnce();
    const credentials = this.readJsonFile<Record<string, unknown>>(this.credentialsPath);
    const token = this.readJsonFile<Record<string, unknown>>(this.tokenPath);

    const installed = (credentials.installed as {
      client_id?: string;
      client_secret?: string;
      redirect_uris?: string[];
    }) ?? { };

    const clientId = installed.client_id;
    const clientSecret = installed.client_secret;
    const redirectUri = installed.redirect_uris?.[0] ?? 'http://localhost';

    if (!clientId || !clientSecret) {
      throw new Error('OAuth client credentials are missing client_id or client_secret.');
    }

    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    auth.setCredentials(token);
    return auth;
  }

  private async fetchLabelMap(
    gmail: ReturnType<typeof google.gmail>,
    userId: string
  ): Promise<Map<string, string>> {
    const labelMap = new Map<string, string>();
    const res = await gmail.users.labels.list({ userId });
    const labels = res.data.labels ?? [];
    for (const label of labels) {
      if (label.id && label.name) {
        labelMap.set(label.id, label.name);
      }
    }
    return labelMap;
  }

  private getHeaderValue(
    headers: Array<{ name?: string | null; value?: string | null }>,
    headerName: string
  ): string | undefined {
    const found = headers.find((header) => header.name?.toLowerCase() === headerName.toLowerCase());
    return found?.value ?? undefined;
  }

  private formatDate(dateHeader?: string | null, internalDate?: string | null): string {
    if (dateHeader) {
      const parsed = new Date(dateHeader);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
      return dateHeader;
    }

    if (internalDate) {
      const parsed = new Date(Number(internalDate));
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
    }

    return 'unknown date';
  }

  private readJsonFile<T>(filePath: string): T {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Required file not found: ${resolved}`);
    }
    const raw = fs.readFileSync(resolved, 'utf8');
    return JSON.parse(raw) as T;
  }
}
