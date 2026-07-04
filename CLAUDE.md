# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

"Luyện đề Tiếng Anh 3 Cấp độ" — a Vietnamese English exam-prep SPA (grades 6, 10, 12) built with **Google AI Studio** (see `metadata.json`, `firebase-blueprint.json`, `firebase-applet-config.json` — these are AI Studio scaffolding files, not hand-authored config). React 19 + Vite frontend, a thin Express server for Gemini AI calls and GitHub backup, and Firestore as the only datastore (no other backend/API layer).

## Commands

- `npm run dev` — starts the Express server (`server.ts` via `tsx`) which wraps Vite in middleware mode. This is the only way to run the app locally (there is no separate `vite dev`).
- `npm run build` — builds the client with Vite, then bundles `server.ts` to `dist/server.cjs` with esbuild (CJS, externalized packages).
- `npm start` — runs the production bundle (`node dist/server.cjs`).
- `npm run lint` — `tsc --noEmit` (type-check only; no ESLint/Prettier configured, no test runner/framework in this repo).
- `firebase deploy` — deploys Firestore rules/indexes and `dist/` as hosting (see `firebase.json`; hosting rewrites everything to `index.html` — pure SPA).

There is no test suite. There is no ESLint config, so `npm run lint` (tsc) is the only automated correctness gate.

## Environment

Configured via `.env` (see `.env.example`), loaded by `dotenv` in `server.ts`:
- `GEMINI_API_KEY` — required for the `/api/gemini/*` endpoints; the app degrades to local rule-based fallbacks (see below) when absent or when Gemini quota/errors occur.
- `GITHUB_TOKEN` — required for the `/api/github/backup` and `/api/github/restore` endpoints.
- `APP_URL` — injected by AI Studio at runtime, not used for local dev.

Firebase project connection is resolved **at runtime**, not baked into the build or committed to git (`firebase-applet-config.json` is gitignored). `src/main.tsx` awaits `resolveFirebaseConfig()` (`src/services/runtimeFirebaseConfig.ts`) before ever importing `App.tsx`/`src/firebase.ts`, since the latter calls `initializeApp()` at module-evaluation time. Resolution order: (1) `GET /api/config/firebase` on the server, which itself prefers a local `firebase-applet-config.json` on disk (keeps the AI Studio-native flow working untouched) and otherwise falls back to `FIREBASE_*` env vars (see `.env.example`); (2) a value previously entered by the user via `DatabaseSetupView` and persisted in `localStorage`. If neither source has anything, `DatabaseSetupView` is shown instead of the app so an admin can type in their own Firebase project's connection details (validated with a live connectivity check before saving).

### CRITICAL: the live Firestore is AI Studio-managed, NOT the `firebase deploy` target

The runtime database is a **named** Firestore (`firestoreDatabaseId: ai-studio-c465d9e4-…`) inside project **`gen-lang-client-0521048048`** ("Default Gemini Project", Enterprise edition), provisioned and rule-managed by AI Studio. Meanwhile `.firebaserc`/`firebase.json` point `firebase deploy` at project **`luyende-bff3d`**'s `(default)` database — so deploying `firestore.rules`/`firestore.indexes.json` from this repo does **NOT** affect the database the app actually reads/writes (only hosting on `luyende-bff3d.web.app` matters there). Practical consequences: (1) new Firestore collections will be rejected with `permission-denied` unless AI Studio's rules already allow them — stick to the existing collections; (2) composite indexes can't be declared from here, so client queries must stay single-field (equality) and do any additional filtering/sorting client-side; (3) treat `firestore.rules` in this repo as a mirror of what AI Studio enforces, not as a deployable source of truth.

## Architecture

### No app-level backend API for data — Firestore is called directly from components

Almost every view component (`src/components/*.tsx`) imports `db` from `src/firebase.ts` and calls Firestore SDK functions (`getDocs`, `addDoc`, `setDoc`, `updateDoc`, `writeBatch`) directly — there is no repository/service layer or React Query-like cache. `server.ts` only exists for the three things a browser can't safely do itself:
1. Call the Gemini API with the server-held `GEMINI_API_KEY` (`/api/gemini/parse-exam`, `/api/gemini/evaluate-exam`, `/api/gemini/batch-evaluate-exams`).
2. Push/pull a full-database JSON snapshot to/from a GitHub repo using `GITHUB_TOKEN` (`/api/github/backup`, `/api/github/restore`).

Everything else (auth, exam CRUD, attempts, vocab, feedback) is client-side Firestore reads/writes.

### Auth is custom, not Firebase Auth-gated

`src/App.tsx` implements login/register by querying the entire `users` collection client-side and comparing plaintext `password` fields in JS — Firebase Auth (`getAuth()`/`signInWithPopup`) is used only for the Google sign-in *button*, and even then the resulting user is matched/created by email against the same custom `users` collection, not by Firebase Auth UID/session. There is no server-side session; the logged-in `User` object is cached in `localStorage` (`exam_prep_user_session`) and trusted as-is on reload.

### `firestore.rules` does not enforce `security_spec.md`

`security_spec.md` documents an intended threat model (per-user ownership, admin-only exam writes, attempt isolation, etc.) and lists 12 "Dirty Dozen" attack payloads the rules should reject. The actual `firestore.rules`, however, allows `read, list: if true` and **`delete: if true`** on every collection (`users`, `exams`, `attempts`, `extensions`, `feedbacks`, `srs_items`, `vocab_practice`, `vocabulary_library`), with `create`/`update` gated only by shape/type validators (`isValidUser`, `isValidExam`, etc.) — not by `request.auth`. There is effectively no authorization enforcement at the database layer; anyone with the client config can read/write/delete any document as long as the payload shape matches. Treat the spec doc as aspirational/design intent, not as a description of current behavior, when reasoning about security-sensitive changes.

### Data model (`src/types.ts`)

Central domain types: `User`, `Exam` (containing nested `Passage[]` → `Question[]`), `Attempt`, `ExtensionLog`, `QuestionFeedback`, `SRSItem`. Exams are self-contained documents — passages/questions are embedded arrays, not separate collections. `VOCABULARY_THEMES` and `GRAMMAR_THEMES` in this file are the fixed taxonomies used to classify every question; both the Gemini prompts in `server.ts` and the local fallback classifiers must stay in sync with these lists.

### AI parsing pipeline has a local fallback for every Gemini call

`server.ts` wraps every Gemini call in `generateContentWithRetry` (retry + exponential backoff + automatic model failover between `gemini-3.1-flash-lite`/`gemini-3.5-flash`, parsing Google's `RetryInfo` for precise backoff). If Gemini is unavailable/unconfigured/quota-exhausted, endpoints fall back to deterministic local logic instead of failing: `getLocalFallbackExam` (canned exam by grade), `localEvaluatePassages`/`localBatchEvaluatePassages` (keyword-matching classifiers mirroring the Gemini prompt's taxonomy). When changing the Gemini prompts/schemas, update the corresponding local fallback so behavior stays consistent when the API is down.

### Bootstrapping/seeding

On first load, `App.tsx`'s `bootstrapAndCheckSession` seeds `users` and `exams` from `src/seedData.ts` if those collections are empty, and runs a one-off migration adding a default `classification` to any exam missing it. This runs on every app load (cheap empty-check), not just once.

### Static vocabulary data

`src/data/vocab_{a1,a2,b1,b2,c1}.ts` are hand-authored CEFR-leveled word lists merged by `src/data/vocabulary.ts` into `ALL_VOCABULARY`/`ALL_TOPICS`, independent of the Firestore `vocabulary_library` collection (used by `VocabularyNormalizerView`/`VocabularyView` for different purposes — check which source a component reads before assuming they're the same list).

### View routing

`App.tsx` is a single component owning all top-level state (current user, active tab, modal config) and switches between view components (`DashboardView`, `PracticeView`, `CustomTrainingView`, `VocabularyView`, `ExamManagerView`, `ImportExamView`, `CategoryManagerView`, `VocabularyNormalizerView`, `UserAdminView`) via a hand-rolled `activeTab` string switch — there is no router library. Admin-only views are gated purely by `currentUser.role === 'admin'` checks in the UI, not by any backend rule (consistent with the `firestore.rules` gap above).

All user-facing strings/UI copy are in Vietnamese; keep new UI text consistent with that.
