// scripts/google-auth-bootstrap.ts

import fs from "fs";
import { authenticate } from "@google-cloud/local-auth";

const TOKEN_PATH = "secrets/token.json";

async function run() {
    const auth = await authenticate({
        keyfilePath: "secrets/google-oauth-client.json",
        scopes: [
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/gmail.send",
            "https://www.googleapis.com/auth/gmail.modify",
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/calendar.events",
            "https://www.googleapis.com/auth/drive.metadata.readonly",
            "https://www.googleapis.com/auth/drive.file",
        ],
    });

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(auth.credentials, null, 2), "utf8");
    console.log(`Token saved to ${TOKEN_PATH}`);
}

run();
