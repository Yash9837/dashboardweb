// ============================================================================
// Order Lifecycle Engine — Settlement-Based Closed Order Detection
// ============================================================================
// Pipeline:
//   Amazon SP-API → Sync Worker → Financial Event Parser → DB →
//   Order Lifecycle Engine → Closed Order Detector → Analytics Database
//
// Financial Status States (based on ACTUAL settlement/disbursement):
//   OPEN                         → No financial transactions recorded (Pending)
//   DELIVERED_PENDING_SETTLEMENT → Transactions exist but settlement is still
//                                  Open OR Closed but NOT yet disbursed (Posted/Closed)
//   FINANCIALLY_CLOSED           → ALL settlements are Closed AND
//                                  fund_transfer_status = 'Succeeded' (Disbursed)
//
// Closure Condition:
//   All transactions for this order belong to closed settlements
//   AND all those settlements have been disbursed (fund_transfer_status = 'Succeeded')
//
// This replaces the old delivery_date + 30 day approximation with REAL
// settlement data from Amazon's financial event groups.
// ============================================================================

import { supabase, fetchAllRows } from './supabase';

/** Batch size for DB updates */
const BATCH_SIZE = 200;

/**
 * Settlement-level status for an order:
 *   Unsettled  → No financial transactions found (maps to OPEN)
 *   Open       → Transactions exist, at least one settlement is Open (maps to DELIVERED_PENDING_SETTLEMENT)
 *   Closed     → All settlements are Closed (maps to DELIVERED_PENDING_SETTLEMENT)
 *   Disbursed  → All settlements are Closed + fund_transfer_status = Succeeded (maps to FINANCIALLY_CLOSED)
 */
export type SettlementResolution = 'Unsettled' | 'Open' | 'Closed' | 'Disbursed';

// ── Types ────────────────────────────────────────────────────────────────────

export type FinancialStatus =
  | 'OPEN'
  | 'DELIVERED_PENDING_SETTLEMENT'
  | 'FINANCIALLY_CLOSED';

export interface OrderLifecycleRecord {
  amazon_order_id: string;
  order_status: string;
  purchase_date: string | null;
  delivery_date: string | null;
  financial_status: FinancialStatus;
  last_event_date: string | null;
  return_deadline: string | null;
  settlement_id: string | null;
  settlement_status: 'Unsettled' | 'Open' | 'Closed';
  event_count: number;
  net_settlement_amount: number;
}

export interface ClosedOrderRunResult {
  run_type: 'manual' | 'cron' | 'sync';
  started_at: string;
  completed_at: string;
  orders_processed: number;
  orders_closed: number;
  orders_promoted: number; // Orders that moved to a new state (but not closed)
  errors: string[];
  duration_ms: number;
  state_transitions: {
    to_delivered_pending: number;
    to_closed: number;
  };
}

export interface LifecycleStats {
  total_orders: number;
  open: number;
  delivered_pending_settlement: number;
  financially_closed: number;
  closure_rate: number;
  avg_days_to_close: number;
  oldest_unclosed_date: string | null;
  finalized_till_date: string | null;
  finalized_revenue: number;
  finalized_order_count: number;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

// ── Step 1: Compute last event date per order ────────────────────────────────

async function computeLastEventDates(): Promise<Map<string, { lastDate: string; count: number; netAmount: number }>> {
  const map = new Map<string, { lastDate: string; count: number; netAmount: number }>();

  // Fetch financial events grouped by order (paginated past 1k limit)
  const events = await fetchAllRows(
    'financial_events',
    'amazon_order_id, posted_date, amount',
    q => q.not('amazon_order_id', 'is', null),
    'posted_date',
    false,
  );

  for (const evt of (events || [])) {
    const orderId = evt.amazon_order_id;
    if (!orderId) continue;

    const existing = map.get(orderId);
    if (!existing) {
      map.set(orderId, {
        lastDate: evt.posted_date,
        count: 1,
        netAmount: Number(evt.amount) || 0,
      });
    } else {
      existing.count++;
      existing.netAmount += Number(evt.amount) || 0;
      if (evt.posted_date > existing.lastDate) {
        existing.lastDate = evt.posted_date;
      }
    }
  }

  return map;
}

// ── Step 2: Resolve settlement status per order ──────────────────────────────
// Uses settlement_items → financial_event_groups to determine true settlement
// and disbursement status for each order.

interface OrderSettlementInfo {
  settlementId: string;
  resolution: SettlementResolution;  // Unsettled | Open | Closed | Disbursed
  allSettlementIds: string[];
}

async function resolveSettlementStatuses(): Promise<Map<string, OrderSettlementInfo>> {
  const map = new Map<string, OrderSettlementInfo>();

  // 1. Fetch all settlement group statuses (processing_status + fund_transfer_status)
  const { data: groups } = await supabase
    .from('financial_event_groups')
    .select('event_group_id, processing_status, fund_transfer_status');

  const groupInfoMap = new Map<string, { closed: boolean; disbursed: boolean }>();
  for (const g of (groups || [])) {
    groupInfoMap.set(g.event_group_id, {
      closed: g.processing_status === 'Closed',
      disbursed: g.processing_status === 'Closed' && g.fund_transfer_status === 'Succeeded',
    });
  }

  // 2. Fetch settlement_items to link orders → settlement groups
  //    settlement_items has (settlement_id, amazon_order_id) which gives us
  //    the mapping from orders to their settlement groups.
  const settlementItems = await fetchAllRows(
    'settlement_items',
    'settlement_id, amazon_order_id',
    q => q.not('amazon_order_id', 'is', null),
  );

  // 3. Group by order — collect all settlement IDs per order
  const orderSettlements = new Map<string, Set<string>>();
  for (const item of (settlementItems || [])) {
    const orderId = item.amazon_order_id;
    if (!orderId) continue;
    if (!orderSettlements.has(orderId)) orderSettlements.set(orderId, new Set());
    orderSettlements.get(orderId)!.add(item.settlement_id);
  }

  // 4. For each order, determine the resolution
  for (const [orderId, settlementIds] of orderSettlements) {
    const sids = [...settlementIds];
    let allClosed = true;
    let allDisbursed = true;

    for (const sid of sids) {
      const info = groupInfoMap.get(sid);
      if (!info) {
        // Settlement group not found — treat as Open
        allClosed = false;
        allDisbursed = false;
        break;
      }
      if (!info.closed) {
        allClosed = false;
        allDisbursed = false;
      } else if (!info.disbursed) {
        allDisbursed = false;
      }
    }

    let resolution: SettlementResolution;
    if (allDisbursed) {
      resolution = 'Disbursed';
    } else if (allClosed) {
      resolution = 'Closed';
    } else {
      resolution = 'Open';
    }

    map.set(orderId, {
      settlementId: sids[sids.length - 1], // latest
      resolution,
      allSettlementIds: sids,
    });
  }

  return map;
}

// ── Step 3: Determine new financial status ───────────────────────────────────
// Uses REAL settlement/disbursement status instead of delivery_date + 30 days.
//
// Mapping:
//   Unsettled (no transactions)  → OPEN
//   Open (settlement still open) → DELIVERED_PENDING_SETTLEMENT
//   Closed (settled, not paid)   → DELIVERED_PENDING_SETTLEMENT
//   Disbursed (settled + paid)   → FINANCIALLY_CLOSED ← this is the key change

function determineFinancialStatus(
  order: {
    delivery_date: string | null;
    order_status: string;
  },
  _lastEventDate: string | null,
  settlementResolution: SettlementResolution,
  _now: Date,
  hasRefund: boolean = false,
): { newStatus: FinancialStatus; returnDeadline: Date | null; reason: string } {

  // ── Cancelled orders → FINANCIALLY_CLOSED (no money will move) ──
  if (order.order_status === 'Cancelled') {
    return {
      newStatus: 'FINANCIALLY_CLOSED',
      returnDeadline: null,
      reason: 'Cancelled order — no delivery expected',
    };
  }

  // ── Determine status based on settlement resolution ──
  switch (settlementResolution) {
    case 'Disbursed':
      // All settlements are Closed + funds transferred → FINANCIALLY_CLOSED
      return {
        newStatus: 'FINANCIALLY_CLOSED',
        returnDeadline: null,
        reason: `All settlements Closed + Disbursed${hasRefund ? ' (includes refund)' : ''} — finalized`,
      };

    case 'Closed':
      // All settlements Closed but funds not yet transferred
      return {
        newStatus: 'DELIVERED_PENDING_SETTLEMENT',
        returnDeadline: null,
        reason: 'All settlements Closed, awaiting disbursement',
      };

    case 'Open':
      // Transactions exist but at least one settlement is still Open
      return {
        newStatus: 'DELIVERED_PENDING_SETTLEMENT',
        returnDeadline: null,
        reason: 'Settlement still Open — transactions not yet finalized',
      };

    case 'Unsettled':
    default:
      // No financial transactions recorded for this order
      return {
        newStatus: 'OPEN',
        returnDeadline: null,
        reason: 'No financial transactions found in any settlement',
      };
  }
}

// ── Main Engine: Detect & Update Closed Orders ───────────────────────────────

export async function detectClosedOrders(
  runType: 'manual' | 'cron' | 'sync' = 'sync',
): Promise<ClosedOrderRunResult> {
  const startedAt = new Date();
  const errors: string[] = [];
  const stateTransitions = { to_delivered_pending: 0, to_closed: 0 };
  let ordersProcessed = 0;
  let ordersClosed = 0;
  let ordersPromoted = 0;

  console.log(`[Lifecycle] Starting closed order detection (${runType})...`);

  try {
    // ── Parallel data fetching ──
    const [eventDateMap, settlementMap] = await Promise.all([
      computeLastEventDates(),
      resolveSettlementStatuses(),
    ]);

    // ── Build refund set: orders that have any Refund events ──
    const refundOrderIds = new Set<string>();
    {
      const refundEvents = await fetchAllRows(
        'financial_events',
        'amazon_order_id',
        q => q.eq('event_type', 'Refund').not('amazon_order_id', 'is', null),
      );
      for (const evt of refundEvents) {
        if (evt.amazon_order_id) refundOrderIds.add(evt.amazon_order_id);
      }
    }
    console.log(`[Lifecycle] Found ${refundOrderIds.size} orders with refunds`);

    // ── Fetch all orders that are NOT yet FINANCIALLY_CLOSED ──
    const { data: orders, error: ordErr } = await supabase
      .from('orders')
      .select('amazon_order_id, order_status, delivery_date, financial_status, purchase_date')
      .not('financial_status', 'eq', 'FINANCIALLY_CLOSED');

    if (ordErr) {
      errors.push(`Failed to fetch orders: ${ordErr.message}`);
      throw ordErr;
    }

    const now = new Date();
    const updates: Array<{
      amazon_order_id: string;
      financial_status: FinancialStatus;
      last_event_date: string | null;
      return_deadline: string | null;
      settlement_id: string | null;
      settlement_status: string;
      event_count: number;
      net_settlement_amount: number;
      financial_closed_at: string | null;
      updated_at: string;
    }> = [];

    const logEntries: Array<{
      amazon_order_id: string;
      previous_status: string | null;
      new_status: string;
      reason: string;
      metadata: Record<string, any>;
    }> = [];

    for (const order of (orders || [])) {
      ordersProcessed++;
      const orderId = order.amazon_order_id;
      const currentStatus = (order.financial_status || 'OPEN') as FinancialStatus;

      // Get event data
      const eventData = eventDateMap.get(orderId);
      const lastEventDate = eventData?.lastDate || null;
      const eventCount = eventData?.count || 0;
      const netAmount = eventData?.netAmount || 0;

      // Get settlement data from settlement_items → financial_event_groups
      const settlementData = settlementMap.get(orderId);
      const settlementId = settlementData?.settlementId || null;
      const settlementResolution: SettlementResolution = settlementData?.resolution || 'Unsettled';
      // Map resolution to legacy settlement_status for backward compat
      const settlementStatus: string = settlementResolution === 'Disbursed' ? 'Closed'
        : settlementResolution === 'Closed' ? 'Closed'
          : settlementResolution === 'Open' ? 'Open' : 'Unsettled';

      // Determine new status based on settlement/disbursement
      const hasRefund = refundOrderIds.has(orderId);
      const { newStatus, returnDeadline, reason } = determineFinancialStatus(
        { delivery_date: order.delivery_date, order_status: order.order_status },
        lastEventDate,
        settlementResolution,
        now,
        hasRefund,
      );

      // Only update if status changed
      if (newStatus !== currentStatus) {
        const isClosed = newStatus === 'FINANCIALLY_CLOSED';

        updates.push({
          amazon_order_id: orderId,
          financial_status: newStatus,
          last_event_date: lastEventDate,
          return_deadline: returnDeadline?.toISOString() || null,
          settlement_id: settlementId,
          settlement_status: settlementStatus,
          event_count: eventCount,
          net_settlement_amount: Math.round(netAmount * 100) / 100,
          financial_closed_at: isClosed ? now.toISOString() : null,
          updated_at: now.toISOString(),
        });

        logEntries.push({
          amazon_order_id: orderId,
          previous_status: currentStatus,
          new_status: newStatus,
          reason,
          metadata: {
            delivery_date: order.delivery_date,
            last_event_date: lastEventDate,
            settlement_id: settlementId,
            settlement_status: settlementStatus,
            event_count: eventCount,
            net_amount: Math.round(netAmount * 100) / 100,
            return_deadline: returnDeadline?.toISOString() || null,
            has_refund: hasRefund,
          },
        });

        if (isClosed) {
          ordersClosed++;
          stateTransitions.to_closed++;
        } else {
          ordersPromoted++;
          if (newStatus === 'DELIVERED_PENDING_SETTLEMENT') stateTransitions.to_delivered_pending++;
        }
      } else {
        // Even if status didn't change, update event metadata
        updates.push({
          amazon_order_id: orderId,
          financial_status: currentStatus,
          last_event_date: lastEventDate,
          return_deadline: returnDeadline?.toISOString() || null,
          settlement_id: settlementId,
          settlement_status: settlementStatus,
          event_count: eventCount,
          net_settlement_amount: Math.round(netAmount * 100) / 100,
          financial_closed_at: null,
          updated_at: now.toISOString(),
        });
      }
    }

    // ── Batch upsert orders ──
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const chunk = updates.slice(i, i + BATCH_SIZE);
      const { error: upErr } = await supabase
        .from('orders')
        .upsert(chunk, { onConflict: 'amazon_order_id', ignoreDuplicates: false });
      if (upErr) {
        errors.push(`Order upsert batch ${i}: ${upErr.message}`);
        console.error('[Lifecycle] Order upsert error:', upErr.message);
      }
    }

    // ── Insert lifecycle log entries (for audit trail) ──
    if (logEntries.length > 0) {
      for (let i = 0; i < logEntries.length; i += BATCH_SIZE) {
        const chunk = logEntries.slice(i, i + BATCH_SIZE);
        const { error: logErr } = await supabase
          .from('order_lifecycle_log')
          .insert(chunk);
        if (logErr) {
          errors.push(`Lifecycle log insert batch ${i}: ${logErr.message}`);
          console.error('[Lifecycle] Lifecycle log error:', logErr.message);
        }
      }
    }

    console.log(
      `[Lifecycle] Complete: ${ordersProcessed} processed, ${ordersClosed} closed, ${ordersPromoted} promoted, ${errors.length} errors`,
    );
  } catch (err: any) {
    errors.push(err.message || 'Unknown error');
    console.error('[Lifecycle] Fatal error:', err.message);
  }

  const completedAt = new Date();

  // ── Log the run ──
  const runResult: ClosedOrderRunResult = {
    run_type: runType,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    orders_processed: ordersProcessed,
    orders_closed: ordersClosed,
    orders_promoted: ordersPromoted,
    errors,
    duration_ms: completedAt.getTime() - startedAt.getTime(),
    state_transitions: stateTransitions,
  };

  try {
    await supabase.from('closed_order_runs').insert({
      run_type: runType,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      orders_processed: ordersProcessed,
      orders_closed: ordersClosed,
      orders_promoted: ordersPromoted,
      errors: errors.length > 0 ? errors : null,
      duration_ms: completedAt.getTime() - startedAt.getTime(),
      metadata: { state_transitions: stateTransitions },
    });
  } catch {
    console.warn('[Lifecycle] Failed to log run result to closed_order_runs');
  }

  return runResult;
}

// ── Get Lifecycle Statistics ─────────────────────────────────────────────────

export async function getLifecycleStats(): Promise<LifecycleStats> {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('financial_status, delivery_date, financial_closed_at, purchase_date, net_settlement_amount');

  if (error || !orders) {
    return {
      total_orders: 0,
      open: 0,
      delivered_pending_settlement: 0,
      financially_closed: 0,
      closure_rate: 0,
      avg_days_to_close: 0,
      oldest_unclosed_date: null,
      finalized_till_date: null,
      finalized_revenue: 0,
      finalized_order_count: 0,
    };
  }

  let open = 0;
  let deliveredPending = 0;
  let closed = 0;
  let totalDaysToClose = 0;
  let closedWithDates = 0;
  let oldestUnclosed: string | null = null;

  for (const o of orders) {
    const status = o.financial_status || 'OPEN';
    switch (status) {
      case 'OPEN': open++; break;
      case 'DELIVERED_PENDING_SETTLEMENT': deliveredPending++; break;
      case 'FINANCIALLY_CLOSED': closed++; break;
    }

    if (status === 'FINANCIALLY_CLOSED' && o.delivery_date && o.financial_closed_at) {
      const days = daysBetween(new Date(o.delivery_date), new Date(o.financial_closed_at));
      if (days >= 0) {
        totalDaysToClose += days;
        closedWithDates++;
      }
    }

    if (status !== 'FINANCIALLY_CLOSED' && o.purchase_date) {
      if (!oldestUnclosed || o.purchase_date < oldestUnclosed) {
        oldestUnclosed = o.purchase_date;
      }
    }
  }

  const total = orders.length;

  // ── Compute "Payments Finalized Till Date" ──
  // Group orders by purchase_date (day). Walk from earliest to latest.
  // Finalized-till = the latest date where ALL orders on that date are FINANCIALLY_CLOSED.
  const dayOrders = new Map<string, { total: number; closed: number; revenue: number }>();
  for (const o of orders) {
    if (!o.purchase_date) continue;
    const day = o.purchase_date.slice(0, 10);
    if (!dayOrders.has(day)) dayOrders.set(day, { total: 0, closed: 0, revenue: 0 });
    const d = dayOrders.get(day)!;
    d.total++;
    if ((o.financial_status || 'OPEN') === 'FINANCIALLY_CLOSED') {
      d.closed++;
      d.revenue += Number(o.net_settlement_amount) || 0;
    }
  }

  const sortedDays = [...dayOrders.keys()].sort();
  let finalizedTillDate: string | null = null;
  let finalizedRevenue = 0;
  let finalizedOrderCount = 0;

  for (const day of sortedDays) {
    const d = dayOrders.get(day)!;
    if (d.total === d.closed) {
      finalizedTillDate = day;
      finalizedRevenue += d.revenue;
      finalizedOrderCount += d.total;
    } else {
      break; // Gap found — stop advancing
    }
  }

  return {
    total_orders: total,
    open,
    delivered_pending_settlement: deliveredPending,
    financially_closed: closed,
    closure_rate: total > 0 ? Math.round((closed / total) * 10000) / 100 : 0,
    avg_days_to_close: closedWithDates > 0 ? Math.round(totalDaysToClose / closedWithDates) : 0,
    oldest_unclosed_date: oldestUnclosed,
    finalized_till_date: finalizedTillDate,
    finalized_revenue: Math.round(finalizedRevenue * 100) / 100,
    finalized_order_count: finalizedOrderCount,
  };
}

// ── Get Recent Run History ───────────────────────────────────────────────────

export async function getRecentRuns(limit = 10): Promise<any[]> {
  const { data } = await supabase
    .from('closed_order_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);

  return data || [];
}
