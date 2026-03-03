// ============================================================================
// Order Lifecycle Engine — Closed Order Detection System
// ============================================================================
// Simple, clean approach:
//
// Pipeline:
//   SP-API → Data Sync → Financial Event Parser → Order Lifecycle Engine →
//   Closed Order Detector → Analytics Database
//
// Financial Status States:
//   OPEN                         → Order placed, not yet delivered
//   DELIVERED_PENDING_SETTLEMENT → Delivered but return window hasn't expired
//   FINANCIALLY_CLOSED           → Delivery + 30 day return window expired, no refund
//
// Closure Condition:
//   delivery_date + 30 days < current_date AND no refund on the order
//
// Example:
//   Order Date: Jan 1 → Delivered: Jan 5 → Return Window: 30 days (Feb 4)
//   Settlement: Jan 12 → Refund: None → Marked as FINANCIALLY_CLOSED
// ============================================================================

import { supabase, fetchAllRows } from './supabase';

// ── Configuration ────────────────────────────────────────────────────────────

/** Days after delivery before return window expires — Amazon India standard */
const RETURN_WINDOW_DAYS = 30;

/** Total safe window = 30 days after delivery (return window only, no settlement check) */
const TOTAL_SAFE_WINDOW_DAYS = RETURN_WINDOW_DAYS;

/** Batch size for DB updates */
const BATCH_SIZE = 200;

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

async function resolveSettlementStatuses(): Promise<Map<string, { settlementId: string; status: 'Open' | 'Closed' }>> {
  const map = new Map<string, { settlementId: string; status: 'Open' | 'Closed' }>();

  // Get event_group_id → settlement status mapping
  const { data: groups } = await supabase
    .from('financial_event_groups')
    .select('event_group_id, processing_status');

  const groupStatusMap = new Map<string, 'Open' | 'Closed'>();
  for (const g of (groups || [])) {
    groupStatusMap.set(g.event_group_id, g.processing_status === 'Closed' ? 'Closed' : 'Open');
  }

  // Get order → event_group mappings from financial_events (paginated past 1k limit)
  const eventLinks = await fetchAllRows(
    'financial_events',
    'amazon_order_id, event_group_id',
    q => q.not('amazon_order_id', 'is', null).not('event_group_id', 'is', null),
  );

  for (const link of (eventLinks || [])) {
    const orderId = link.amazon_order_id;
    const groupId = link.event_group_id;
    if (!orderId || !groupId) continue;

    const groupStatus = groupStatusMap.get(groupId) || 'Open';
    const existing = map.get(orderId);

    if (!existing) {
      map.set(orderId, { settlementId: groupId, status: groupStatus });
    } else {
      // If ANY event group is Open, the order is not fully settled
      if (groupStatus === 'Open') {
        existing.status = 'Open';
      }
      // Keep the latest settlement ID
      existing.settlementId = groupId;
    }
  }

  return map;
}

// ── Step 3: Determine new financial status ───────────────────────────────────

function determineFinancialStatus(
  order: {
    delivery_date: string | null;
    order_status: string;
  },
  lastEventDate: string | null,
  _settlementStatus: 'Unsettled' | 'Open' | 'Closed',
  now: Date,
  hasRefund: boolean = false,
): { newStatus: FinancialStatus; returnDeadline: Date | null; reason: string } {

  // ── No delivery date → stay OPEN ──
  if (!order.delivery_date) {
    if (order.order_status === 'Cancelled') {
      return {
        newStatus: 'FINANCIALLY_CLOSED',
        returnDeadline: null,
        reason: 'Cancelled order — no delivery expected',
      };
    }
    return {
      newStatus: 'OPEN',
      returnDeadline: null,
      reason: 'No delivery date available',
    };
  }

  const deliveryDate = new Date(order.delivery_date);
  const returnDeadline = addDays(deliveryDate, TOTAL_SAFE_WINDOW_DAYS);

  // ── Return window still active (delivery + 30 days not yet passed) ──
  if (now < returnDeadline) {
    return {
      newStatus: 'DELIVERED_PENDING_SETTLEMENT',
      returnDeadline,
      reason: `Delivered, return window expires ${returnDeadline.toISOString().slice(0, 10)}`,
    };
  }

  // ── Delivery + 30 days passed → FINANCIALLY_CLOSED ──
  // Refunded or not — after 30 days, figures are final
  return {
    newStatus: 'FINANCIALLY_CLOSED',
    returnDeadline,
    reason: `Delivery + 30d expired (${returnDeadline.toISOString().slice(0, 10)})${hasRefund ? ', has refund' : ', no refund'} — closed`,
  };
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

      // Get settlement data
      const settlementData = settlementMap.get(orderId);
      const settlementId = settlementData?.settlementId || null;
      const settlementStatus: 'Unsettled' | 'Open' | 'Closed' = settlementData?.status || 'Unsettled';

      // Determine new status
      const hasRefund = refundOrderIds.has(orderId);
      const { newStatus, returnDeadline, reason } = determineFinancialStatus(
        { delivery_date: order.delivery_date, order_status: order.order_status },
        lastEventDate,
        settlementStatus,
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
    .select('financial_status, delivery_date, financial_closed_at, purchase_date');

  if (error || !orders) {
    return {
      total_orders: 0,
      open: 0,
      delivered_pending_settlement: 0,
      financially_closed: 0,
      closure_rate: 0,
      avg_days_to_close: 0,
      oldest_unclosed_date: null,
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
  return {
    total_orders: total,
    open,
    delivered_pending_settlement: deliveredPending,
    financially_closed: closed,
    closure_rate: total > 0 ? Math.round((closed / total) * 10000) / 100 : 0,
    avg_days_to_close: closedWithDates > 0 ? Math.round(totalDaysToClose / closedWithDates) : 0,
    oldest_unclosed_date: oldestUnclosed,
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
