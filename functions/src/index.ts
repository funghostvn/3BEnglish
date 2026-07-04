import express from "express";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { registerApiRoutes } from "./apiRoutes";

// Secrets are bound below via onRequest's `secrets` option, which injects
// them into process.env at invocation time — apiRoutes.ts reads
// process.env.GEMINI_API_KEY/GITHUB_TOKEN/FIREBASE_* exactly the same way it
// does in local dev, so no logic there needs to know it's running as a
// Cloud Function.
const geminiApiKey = defineSecret("GEMINI_API_KEY");
const githubToken = defineSecret("GITHUB_TOKEN");
const firebaseApiKey = defineSecret("FIREBASE_API_KEY");
const firebaseProjectId = defineSecret("FIREBASE_PROJECT_ID");
const firebaseAppId = defineSecret("FIREBASE_APP_ID");
const firebaseAuthDomain = defineSecret("FIREBASE_AUTH_DOMAIN");
const firebaseStorageBucket = defineSecret("FIREBASE_STORAGE_BUCKET");
const firebaseMessagingSenderId = defineSecret("FIREBASE_MESSAGING_SENDER_ID");
const firebaseFirestoreDatabaseId = defineSecret("FIREBASE_FIRESTORE_DATABASE_ID");

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
registerApiRoutes(app);

export const api = onRequest(
  {
    region: "asia-southeast1",
    secrets: [
      geminiApiKey,
      githubToken,
      firebaseApiKey,
      firebaseProjectId,
      firebaseAppId,
      firebaseAuthDomain,
      firebaseStorageBucket,
      firebaseMessagingSenderId,
      firebaseFirestoreDatabaseId,
    ],
  },
  app
);
