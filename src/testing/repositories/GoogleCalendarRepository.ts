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
  updatedIso: string | null;
}

export interface GoogleCalendarAllEventIdsResult extends GoogleCalendarEventIdsResult {
  calendarsCount: number;
  eventDetailsById: Record<string, GoogleCalendarEventDetail>;
}

export interface GoogleCalendarFilteredEventIdsResult extends GoogleCalendarEventIdsResult {
  calendarsCount: number;
  eventDetailsById: Record<string, GoogleCalendarEventDetail>;
}

export interface GoogleCalendarEventWindowItem {
  id: string;
  summary: string;
  start: string;
  end: string;
  isAllDay: boolean;
}

export interface GoogleCalendarEventWindowResult {
  events: GoogleCalendarEventWindowItem[];
  errors: string[];
}

export interface GoogleCalendarCreateEventPayload {
  calendarId: string;
  summary: string;
  startIso: string;
  endIso: string;
  timeZone: string;
}

export interface GoogleCalendarCreateEventResult {
  id?: string;
  errors: string[];
}

export interface GoogleCalendarDeleteEventResult {
  errors: string[];
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
                date: this.formatEventDate(item.start?.dateTime ?? item.start?.date),
                updatedIso: this.formatDateTimeIso(item.updated ?? null)
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

  public async getEventIdsByCalendarIds(
    calendarIds: string[],
    backfillDays?: number
  ): Promise<GoogleCalendarFilteredEventIdsResult> {
    const errors: string[] = [];
    const normalizedIds = calendarIds
      .filter((id) => typeof id === 'string' && id.trim() !== '')
      .map((id) => id.trim());

    if (normalizedIds.length === 0) {
      errors.push('No Google Calendar calendarIds provided for config-based coverage.');
      return { ids: [], errors, calendarsCount: 0, eventDetailsById: {} };
    }

    const backfillMs = typeof backfillDays === 'number' && Number.isFinite(backfillDays) && backfillDays > 0
      ? Date.now() - Math.floor(backfillDays) * 24 * 60 * 60 * 1000
      : null;
    const timeMin = backfillMs ? new Date(backfillMs).toISOString() : undefined;

    try {
      const auth = await this.buildAuthClient();
      const calendar = google.calendar({ version: 'v3', auth });

      const calendarNames = new Map<string, string>();
      let calendarPageToken: string | undefined;
      do {
        const res = await calendar.calendarList.list({ maxResults: 250, pageToken: calendarPageToken });
        const items = res.data.items ?? [];
        for (const item of items) {
          if (item.id && item.summary) {
            calendarNames.set(item.id, item.summary);
          }
        }
        calendarPageToken = res.data.nextPageToken ?? undefined;
      } while (calendarPageToken);

      const ids: string[] = [];
      const eventDetailsById: Record<string, GoogleCalendarEventDetail> = {};

      for (const calendarId of normalizedIds) {
        let eventsPageToken: string | undefined;
        do {
          const res = await calendar.events.list({
            calendarId,
            maxResults: 2500,
            pageToken: eventsPageToken,
            timeMin,
            singleEvents: true,
            showDeleted: false,
            orderBy: timeMin ? 'startTime' : undefined
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
                date: this.formatEventDate(item.start?.dateTime ?? item.start?.date),
                updatedIso: this.formatDateTimeIso(item.updated ?? null)
              };
            }
          }

          eventsPageToken = res.data.nextPageToken ?? undefined;
        } while (eventsPageToken);
      }

      return { ids, errors, calendarsCount: normalizedIds.length, eventDetailsById };
    } catch (err) {
      errors.push(
        `Failed to fetch Google Calendar event ids for configured calendars: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return { ids: [], errors, calendarsCount: 0, eventDetailsById: {} };
    }
  }

  public async getEventDetailsByIdsAcrossCalendars(
    calendarIds: string[],
    eventIds: string[]
  ): Promise<{ detailsById: Record<string, GoogleCalendarEventDetail>; errors: string[] }> {
    const errors: string[] = [];
    const detailsById: Record<string, GoogleCalendarEventDetail> = {};
    const normalizedCalendars = calendarIds
      .filter((id) => typeof id === 'string' && id.trim() !== '')
      .map((id) => id.trim());

    if (normalizedCalendars.length === 0 || eventIds.length === 0) {
      return { detailsById, errors };
    }

    try {
      const auth = await this.buildAuthClient();
      const calendar = google.calendar({ version: 'v3', auth });

      const calendarNames = new Map<string, string>();
      let calendarPageToken: string | undefined;
      do {
        const res = await calendar.calendarList.list({ maxResults: 250, pageToken: calendarPageToken });
        const items = res.data.items ?? [];
        for (const item of items) {
          if (item.id && item.summary) {
            calendarNames.set(item.id, item.summary);
          }
        }
        calendarPageToken = res.data.nextPageToken ?? undefined;
      } while (calendarPageToken);

      for (const eventId of eventIds) {
        for (const calendarId of normalizedCalendars) {
          try {
            const res = await calendar.events.get({
              calendarId,
              eventId
            });
            const item = res.data;
            if (item.id) {
              detailsById[eventId] = {
                id: item.id,
                calendarId,
                calendarName: calendarNames.get(calendarId),
                summary: item.summary ?? '(no title)',
                date: this.formatEventDate(item.start?.dateTime ?? item.start?.date),
                updatedIso: this.formatDateTimeIso(item.updated ?? null)
              };
              break;
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (!message.includes('404') && !message.toLowerCase().includes('not found')) {
              errors.push(`Failed to fetch Calendar event ${eventId} from ${calendarId}: ${message}`);
            }
          }
        }
      }
    } catch (err) {
      errors.push(
        `Failed to initialize Google Calendar client: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return { detailsById, errors };
  }

  public async getEventsInWindow(
    calendarId: string,
    timeMinIso: string,
    timeMaxIso: string
  ): Promise<GoogleCalendarEventWindowResult> {
    const errors: string[] = [];
    try {
      const auth = await this.buildAuthClient();
      const calendar = google.calendar({ version: 'v3', auth });

      const events: GoogleCalendarEventWindowItem[] = [];
      let pageToken: string | undefined;

      do {
        const res = await calendar.events.list({
          calendarId,
          timeMin: timeMinIso,
          timeMax: timeMaxIso,
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 2500,
          pageToken
        });

        const items = res.data.items ?? [];
        for (const item of items) {
          if (!item.id) continue;
          const startDateTime = item.start?.dateTime ?? null;
          const endDateTime = item.end?.dateTime ?? null;
          const startDate = item.start?.date ?? null;
          const endDate = item.end?.date ?? null;
          const isAllDay = Boolean(startDate && endDate);
          const start = startDateTime ?? startDate ?? '';
          const end = endDateTime ?? endDate ?? '';
          if (!start || !end) continue;
          events.push({
            id: item.id,
            summary: item.summary ?? '(no title)',
            start,
            end,
            isAllDay
          });
        }

        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);

      return { events, errors };
    } catch (err) {
      errors.push(
        `Failed to fetch Google Calendar events: ${err instanceof Error ? err.message : String(err)}`
      );
      return { events: [], errors };
    }
  }

  public async createEvent(
    payload: GoogleCalendarCreateEventPayload
  ): Promise<GoogleCalendarCreateEventResult> {
    const errors: string[] = [];
    try {
      const auth = await this.buildAuthClient();
      const calendar = google.calendar({ version: 'v3', auth });

      const res = await calendar.events.insert({
        calendarId: payload.calendarId,
        requestBody: {
          summary: payload.summary,
          start: { dateTime: payload.startIso, timeZone: payload.timeZone },
          end: { dateTime: payload.endIso, timeZone: payload.timeZone }
        }
      });

      return { id: res.data.id ?? undefined, errors };
    } catch (err) {
      errors.push(
        `Failed to create Google Calendar event: ${err instanceof Error ? err.message : String(err)}`
      );
      return { errors };
    }
  }

  public async deleteEvent(
    calendarId: string,
    eventId: string
  ): Promise<GoogleCalendarDeleteEventResult> {
    const errors: string[] = [];
    try {
      const auth = await this.buildAuthClient();
      const calendar = google.calendar({ version: 'v3', auth });

      await calendar.events.delete({
        calendarId,
        eventId
      });

      return { errors };
    } catch (err) {
      errors.push(
        `Failed to delete Google Calendar event: ${err instanceof Error ? err.message : String(err)}`
      );
      return { errors };
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

  private formatDateTimeIso(raw?: string | null): string | null {
    if (!raw) {
      return null;
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return raw;
  }
}
