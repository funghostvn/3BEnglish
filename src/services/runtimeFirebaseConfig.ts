export interface FirebaseRuntimeConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  messagingSenderId: string;
  measurementId?: string;
}

const LOCAL_STORAGE_KEY = 'firebase_runtime_config';

let resolvedConfig: FirebaseRuntimeConfig | null = null;

// firebase.ts reads this synchronously at module-evaluation time. It is only
// ever safe to import firebase.ts (directly or transitively) after
// setRuntimeFirebaseConfig() has been called — main.tsx's bootstrap()
// guarantees that ordering by only dynamically import()-ing App.tsx once
// resolution succeeds.
export function getRuntimeFirebaseConfig(): FirebaseRuntimeConfig {
  if (!resolvedConfig) {
    throw new Error('Firebase config accessed before resolution — this should never happen.');
  }
  return resolvedConfig;
}

export function setRuntimeFirebaseConfig(cfg: FirebaseRuntimeConfig) {
  resolvedConfig = cfg;
}

export function saveUserProvidedConfig(cfg: FirebaseRuntimeConfig) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cfg));
}

// Resolve the Firebase config to boot with, in priority order: the server
// (which itself prefers a local firebase-applet-config.json file, then
// FIREBASE_* env vars), then a value the user previously entered through
// DatabaseSetupView. Returns null when neither source has anything — the
// caller should show the setup screen in that case.
export async function resolveFirebaseConfig(): Promise<FirebaseRuntimeConfig | null> {
  try {
    const res = await fetch('/api/config/firebase');
    if (res.ok) {
      const data = await res.json();
      if (data.configured && data.config) {
        return data.config as FirebaseRuntimeConfig;
      }
    }
  } catch {
    // server unreachable (e.g. static-only preview) — fall through
  }

  // Static fallback for Hosting-only deploys where the Cloud Function isn't
  // live yet: a build-time-generated file baked into dist/ (see
  // scripts/generate-static-firebase-config.js), served as a plain static
  // asset — so a brand-new device doesn't need the manual setup screen just
  // because the API layer isn't deployed.
  try {
    const res = await fetch('/firebase-config.json');
    if (res.ok) {
      const data = await res.json();
      if (data.apiKey && data.projectId) {
        return data as FirebaseRuntimeConfig;
      }
    }
  } catch {
    // not present in this deploy — fall through
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as FirebaseRuntimeConfig;
    }
  } catch {
    // corrupt localStorage value — treat as unset
  }

  return null;
}
