import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

type OAuthInstalledConfig = {
  client_id?: string;
  client_secret?: string;
  redirect_uris?: string[];
};

type OAuthClientFile = {
  installed?: OAuthInstalledConfig;
  web?: OAuthInstalledConfig;
};

async function refreshToken(): Promise<void> {
  const credentialsPath = path.resolve(process.cwd(), 'secrets', 'google-oauth-client.json');
  const tokenPath = path.resolve(process.cwd(), 'secrets', 'token.json');

  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`Credentials file not found: ${credentialsPath}`);
  }
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`Token file not found: ${tokenPath}`);
  }

  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')) as OAuthClientFile;
  const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8')) as Record<string, unknown>;

  const config = credentials.installed ?? credentials.web ?? {};
  const clientId = config.client_id;
  const clientSecret = config.client_secret;
  const redirectUri = config.redirect_uris?.[0] ?? 'http://localhost';

  if (!clientId || !clientSecret) {
    throw new Error('OAuth client credentials are missing client_id or client_secret.');
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials(token);

  await auth.getAccessToken();
  const updated = auth.credentials;

  if (token.refresh_token && !updated.refresh_token) {
    updated.refresh_token = token.refresh_token as string;
  }

  fs.writeFileSync(tokenPath, JSON.stringify(updated, null, 2), 'utf8');
  console.log(`Token refreshed and saved to ${tokenPath}`);
}

refreshToken().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
