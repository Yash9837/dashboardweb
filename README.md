# SmartCommerce Dashboard

Next.js dashboard + API routes for Amazon SP-API analytics with Firebase Authentication.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env.local
```

3. Start development server:

```bash
npm run dev
```

## Firebase auth

Firebase auth is wired through:

- `src/lib/firebase.ts`
- `src/context/AuthContext.tsx`
- `src/components/auth/AuthScreen.tsx`

Enable at least one sign-in provider in Firebase Console:

1. Open project `platform-dashboard-f3e9d`
2. Go to `Authentication` -> `Sign-in method`
3. Enable `Google` and/or `Email/Password`
4. Add local and Vercel domains in `Authentication` -> `Settings` -> `Authorized domains`

## Required environment variables

Set these in `.env.local` and in Vercel Project Settings:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`
- `LWA_CLIENT_ID`
- `LWA_CLIENT_SECRET`
- `LWA_REFRESH_TOKEN`
- `SP_API_ENDPOINT`
- `MARKETPLACE_ID`

## Recommended production variables (Vercel)

- `DASHBOARD_TIMEZONE=Asia/Kolkata`
- `CACHE_DIR=/tmp/smartcommerce-cache`
- `SP_REPORT_MAX_WAIT_MS=35000`
- `SP_REPORT_POLL_INTERVAL_MS=4000`
- `SP_REPORT_DOWNLOAD_TIMEOUT_MS=20000`
- `CATALOG_BATCH_CONCURRENCY=4`
- `CATALOG_BATCH_DELAY_MS=100`
- `CATALOG_BATCH_MAX_ASINS=150`
- `ORDERS_ENRICH_LIMIT=75`
- `ORDERS_ITEMS_CONCURRENCY=4`
- `ORDERS_ITEMS_DELAY_MS=60`

## Deploy to Vercel (production)

1. Import the repo in Vercel.
2. Set **Root Directory** to `apps/dashboard`.
3. Keep framework as **Next.js**.
4. Add all environment variables listed above.
5. Deploy.

Notes:

- API routes are in `src/app/api/*` and run on Node.js runtime.
- Function `maxDuration` is configured in API routes for production workloads.
- App cache automatically uses `/tmp` on Vercel.
