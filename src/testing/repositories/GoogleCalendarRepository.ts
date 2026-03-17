import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { loadEnvOnce } from '../utils/envLoader';

export interface GoogleCalendarEventIdsResult {
  ids: string[];
  errors: string[];
}

export interface GoogleCalendarEventDetail {
  id: string;
  calendarId: string;
  calendarName?: string;
  summary: string;
  date: string;
}

export interface GoogleCalendarAllEventIdsResult extends GoogleCalendarEventIdsResult {
  calendarsCount: number;
  eventDetailsById: Record<string, GoogleCalendarEventDetail>;
}

export class GoogleCalendarRepository {
  private readonly tokenPath: string;
  private readonly credentialsPath: string;

  constructor(
    tokenPath: string = path.resolve(process.cwd(), 'secrets', 'token.json'),
    credentialsPath: string = path.resolve(process.cwd(), 'secrets', 'google-oauth-client.json')
  ) {
    this.tokenPath = tokenPath;
    this.credentialsPath = credentialsPath;
  }

  public async getAllEventIds(
    calendarId: string = process.env.GOOGLE_CALENDAR_ID ?? 'primary'
  ): Promise<GoogleCalendarEventIdsResult> {
    const errors: string[] = [];
    try {
      const auth = await this.buildAuthClient();
      const calendar = google.calendar({ version: 'v3', auth });

      const ids: string[] = [];
      let pageToken: string | undefined;

      do {
        const res = await calendar.events.list({
          calendarId,
          maxResults: 2500,
          pageToken
        });

        const items = res.data.items ?? [];
        for (const item of items) {
          if (item.id) {
            ids.push(item.id);
          }
        }

        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);

      return { ids, errors };
    } catch (err) {
      errors.push(
        `Failed to fetch Google Calendar event ids: ${err instanceof Error ? err.message : String(err)}`
      );
      return { ids: [], errors };
    }
  }

  public async getAllEventIdsForAllCalendars(): Promise<GoogleCalendarAllEventIdsResult> {
    const errors: string[] = [];
    try {
      const auth = await this.buildAuthClient();
      const calendar = google.calendar({ version: 'v3', auth });

      const calendarIds: string[] = [];
      const calendarNames = new Map<string, string>();
      let pageToken: string | undefined;

      do {
        const res = await calendar.calendarList.list({ maxResults: 250, pageToken });
        const items = res.data.items ?? [];
        for (const item of items) {
          if (item.id) {
            calendarIds.push(item.id);
            if (item.summary) {
              calendarNames.set(item.id, item.summary);
            }
          }
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);

      const ids: string[] = [];
      const eventDetailsById: Record<string, GoogleCalendarEventDetail> = {};

      for (const calendarId of calendarIds) {
        let eventsPageToken: string | undefined;
        do {
          const res = await calendar.events.list({
            calendarId,
            maxResults: 2500,
            pageToken: eventsPageToken
          });

          const items = res.data.items ?? [];
          for (const item of items) {
            if (item.id) {
              ids.push(item.id);
              eventDetailsById[item.id] = {
                id: item.id,
                calendarId,
                calendarName: calendarNames.get(calendarId),
                summary: item.summary ?? '(no title)',
                date: this.formatEventDate(item.start?.dateTime ?? item.start?.date)
              };
            }
          }

          eventsPageToken = res.data.nextPageToken ?? undefined;
        } while (eventsPageToken);
      }

      return { ids, errors, calendarsCount: calendarIds.length, eventDetailsById };
    } catch (err) {
      errors.push(
        `Failed to fetch Google Calendar event ids across calendars: ${err instanceof Error ? err.message : String(err)}`
      );
      return { ids: [], errors, calendarsCount: 0, eventDetailsById: {} };
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
    }) ?? {};

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

  private readJsonFile<T>(filePath: string): T {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Required file not found: ${resolved}`);
    }
    const raw = fs.readFileSync(resolved, 'utf8');
    return JSON.parse(raw) as T;
  }

  private formatEventDate(raw?: string | null): string {
    if (!raw) {
      return 'unknown date';
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return raw;
  }
}
