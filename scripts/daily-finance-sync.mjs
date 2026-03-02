#!/usr/bin/env node
// ============================================================================
// Daily Finance Sync — Cron Automation Script
// ============================================================================
// Schedule: 0 2 * * *  (runs every day at 2 AM)
//
// This script triggers the full sync pipeline which includes:
//   1. SKU catalog sync
//   2. Orders sync (metadata + delivery dates)
//   3. Financial events sync (Finances API)
//   4. Inventory snapshots sync
//   5. Settlement event groups sync
//   6. Aggregations computation
//   7. Inventory health + alerts
//   8. Closed order detection (financial lifecycle)
//
// Usage:
//   node scripts/daily-finance-sync.mjs
//   node scripts/daily-finance-sync.mjs --full        (force full resync)
//   node scripts/daily-finance-sync.mjs --period=180d (custom period)
//   node scripts/daily-finance-sync.mjs --lifecycle-only  (only run closed order detection)
//
// Cron setup (macOS/Linux):
//   crontab -e
//   0 2 * * * cd /path/to/dashboard && node scripts/daily-finance-sync.mjs >> logs/sync.log 2>&1
//
// PM2 setup:
//   pm2 start scripts/daily-finance-sync.mjs --cron "0 2 * * *" --no-autorestart
// ============================================================================

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Parse CLI args ──
const args = process.argv.slice(2);
const isFullSync = args.includes('--full');
const lifecycleOnly = args.includes('--lifecycle-only');
const periodArg = args.find(a => a.startsWith('--period='));
const period = periodArg ? periodArg.split('=')[1] : '90d';

// ── Determine base URL ──
const baseUrl = process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function logError(msg) {
  const ts = new Date().toISOString();
  console.error(`[${ts}] ERROR: ${msg}`);
}

// ── Step 1: Run full sync pipeline ──
async function runFullSync() {
  log('═══════════════════════════════════════════════════════════');
  log('  Daily Finance Sync — Starting');
  log(`  Mode: ${isFullSync ? 'FULL' : 'INCREMENTAL'} | Period: ${period}`);
  log(`  Base URL: ${baseUrl}`);
  log('═══════════════════════════════════════════════════════════');

  const startTime = Date.now();

  try {
    // Trigger the sync POST endpoint
    const syncUrl = `${baseUrl}/api/command-center/sync?period=${period}${isFullSync ? '&full=true' : ''}`;
    log(`Calling sync endpoint: POST ${syncUrl}`);

    const response = await fetch(syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5 * 60 * 1000), // 5 minute timeout
    });

    const data = await response.json();

    if (!response.ok) {
      logError(`Sync failed with status ${response.status}: ${JSON.stringify(data)}`);
      return false;
    }

    log('Sync completed successfully:');
    log(`  Type: ${data.sync_type}`);
    log(`  Duration: ${(data.duration_ms / 1000).toFixed(1)}s`);
    log(`  Steps:`);
    for (const step of (data.steps || [])) {
      log(`    ✓ ${step}`);
    }
    if (data.warnings?.length > 0) {
      log('  Warnings:');
      for (const w of data.warnings) {
        log(`    ⚠ ${w}`);
      }
    }
    log(`  Counts: ${JSON.stringify(data.counts)}`);

    return true;
  } catch (err) {
    logError(`Sync request failed: ${err.message}`);
    return false;
  } finally {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Total sync duration: ${elapsed}s`);
  }
}

// ── Step 2: Run lifecycle detection only ──
async function runLifecycleOnly() {
  log('═══════════════════════════════════════════════════════════');
  log('  Closed Order Detection — Manual Run');
  log(`  Base URL: ${baseUrl}`);
  log('═══════════════════════════════════════════════════════════');

  const startTime = Date.now();

  try {
    const url = `${baseUrl}/api/command-center/financial-status`;
    log(`Calling lifecycle endpoint: POST ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(2 * 60 * 1000),
    });

    const data = await response.json();

    if (!response.ok) {
      logError(`Lifecycle detection failed: ${JSON.stringify(data)}`);
      return false;
    }

    const result = data.result;
    log('Closed order detection completed:');
    log(`  Orders processed: ${result.orders_processed}`);
    log(`  Orders closed:    ${result.orders_closed}`);
    log(`  Orders promoted:  ${result.orders_promoted}`);
    log(`  Duration:         ${(result.duration_ms / 1000).toFixed(1)}s`);
    log(`  Transitions:`);
    log(`    → DELIVERED_PENDING_SETTLEMENT: ${result.state_transitions.to_delivered_pending}`);
    log(`    → FINANCIALLY_CLOSED:           ${result.state_transitions.to_closed}`);
    if (result.errors?.length > 0) {
      log('  Errors:');
      for (const e of result.errors) {
        logError(`    ${e}`);
      }
    }

    return true;
  } catch (err) {
    logError(`Lifecycle request failed: ${err.message}`);
    return false;
  } finally {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Total lifecycle duration: ${elapsed}s`);
  }
}

// ── Step 3: Fetch and display stats ──
async function showStats() {
  try {
    const url = `${baseUrl}/api/command-center/financial-status?action=stats`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await response.json();

    if (data.success && data.stats) {
      const s = data.stats;
      log('');
      log('═══════════════════════════════════════════════════════════');
      log('  Order Financial Status Summary');
      log('═══════════════════════════════════════════════════════════');
      log(`  Total Orders:                    ${s.total_orders}`);
      log(`  OPEN:                            ${s.open}`);
      log(`  DELIVERED_PENDING_SETTLEMENT:    ${s.delivered_pending_settlement}`);
      log(`  FINANCIALLY_CLOSED:              ${s.financially_closed}`);
      log(`  Closure Rate:                    ${s.closure_rate}%`);
      log(`  Avg Days to Close:               ${s.avg_days_to_close}`);
      if (s.oldest_unclosed_date) {
        log(`  Oldest Unclosed Order:           ${s.oldest_unclosed_date.slice(0, 10)}`);
      }
      log('═══════════════════════════════════════════════════════════');
    }
  } catch {
    // Non-fatal
  }
}

// ── Main ──
async function main() {
  let success;

  if (lifecycleOnly) {
    success = await runLifecycleOnly();
  } else {
    success = await runFullSync();
  }

  await showStats();

  log('');
  log(success ? '✅ Daily sync completed successfully' : '❌ Daily sync completed with errors');

  process.exit(success ? 0 : 1);
}

main().catch(err => {
  logError(`Unhandled error: ${err.message}`);
  process.exit(1);
});
