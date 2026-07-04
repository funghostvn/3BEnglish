// Bakes the Firebase web config into a static dist/firebase-config.json asset
// at build time, mirroring resolveFirebaseConfig() in functions/src/apiRoutes.ts
// (same priority: gitignored firebase-applet-config.json on disk, else
// FIREBASE_* env vars). This lets a Hosting-only deploy (no Cloud Function
// live yet) resolve the client's Firebase config from a plain static file
// instead of forcing every new device through the manual DatabaseSetupView.
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const root = process.cwd();
const outPath = path.join(root, 'public', 'firebase-config.json');

function resolveConfig() {
  try {
    const raw = fs.readFileSync(path.join(root, 'firebase-applet-config.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    // file missing or unreadable — fall through to env vars
  }

  const apiKey = process.env.FIREBASE_API_KEY;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!apiKey || !projectId) return null;

  return {
    apiKey,
    projectId,
    appId: process.env.FIREBASE_APP_ID || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    firestoreDatabaseId: process.env.FIREBASE_FIRESTORE_DATABASE_ID || '(default)',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || '',
  };
}

const config = resolveConfig();
fs.mkdirSync(path.dirname(outPath), { recursive: true });

if (config) {
  fs.writeFileSync(outPath, JSON.stringify(config, null, 2));
  console.log(`[build] Wrote static Firebase config to ${path.relative(root, outPath)}`);
} else {
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  console.log('[build] No Firebase config source found — skipping static config generation.');
}
