// scripts/google-auth-bootstrap.ts

import { authenticate } from "@google-cloud/local-auth";

async function run() {
    const auth = await authenticate({
        keyfilePath: "secrets/google-oauth-client.json",
        scopes: [
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/drive.metadata.readonly",
        ],
    });

    console.log(auth.credentials);
}

run();