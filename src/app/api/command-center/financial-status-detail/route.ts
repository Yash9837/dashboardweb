import { NextResponse } from 'next/server';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { calculateRevenue, type FinancialEvent } from '@/lib/revenue-engine';
import {
  detectClosedOrders,
  getLifecycleStats,
  getRecentRuns,
} from '@/lib/order-lifecycle-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Financial Status Detail API — Closed & Settled Orders
 *
 * Closure rule: DeliveryDate + 30 days < Today = FINANCIALLY_CLOSED
 *
 * GET params:
 *   startDate=YYYY-MM-DD  → Filter orders purchased on or after this date
 *   endDate=YYYY-MM-DD    → Filter orders purchased on or before this date
 *                            (if both omitted → ALL orders, no date filter)
 *   status=all|DELIVERED_PENDING_SETTLEMENT|FINANCIALLY_CLOSED
 *   search=               → Search by order_id or SKU
 *   page=1, pageSize=50   → Pagination
 *   action=stats          → Return lifecycle stats + run history only
 *   action=trigger        → Trigger detection run
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // ── Action: Stats + Run History ──
    if (action === 'stats') {
      const [stats, runs] = await Promise.all([
        getLifecycleStats(),
        getRecentRuns(10),
      ]);
      return NextResponse.json({ success: true, stats, runs });
    }

    const statusFilter = searchParams.get('status') || 'all';
    const search = searchParams.get('search') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');

    // ── Date range (optional — omit both for all-time) ──
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');
    const hasDateFilter = !!(startDateParam || endDateParam);
    // Default: all time (earliest possible to today)
    const startStr = startDateParam || '2020-01-01';
    const endStr = endDateParam || new Date().toISOString().split('T')[0];

    // ── 1. Fetch financial events ──
    // Events may be posted well after purchase date (fees, refunds, settlements arrive later).
    // So always fetch events from startStr to TODAY to capture all events for orders in range.
    const eventsEndStr = new Date().toISOString().split('T')[0];
    const baseSelect = 'event_type, amount, quantity, fee_type, sku, amazon_order_id, posted_date, delivery_date, reference_id';
    const extSelect = baseSelect + ', event_group_id, transaction_type, amount_description';

    let rawEvents: any[] | null = null;
    let useExtended = true;

    try {
      rawEvents = await fetchAllRows(
        'financial_events',
        extSelect,
        q => q.gte('posted_date', startStr).lte('posted_date', eventsEndStr + 'T23:59:59'),
        'posted_date',
        false,
      );
    } catch (evErr: any) {
      if (evErr?.message?.includes('column') || evErr?.code === '42703') {
        useExtended = false;
      } else {
        throw evErr;
      }
    }

    if (!useExtended) {
      rawEvents = await fetchAllRows(
        'financial_events',
        baseSelect,
        q => q.gte('posted_date', startStr).lte('posted_date', eventsEndStr + 'T23:59:59'),
        'posted_date',
        false,
      );
    }

    const events: FinancialEvent[] = (rawEvents || []).map((e: any) => ({
      event_type: e.event_type,
      amount: Number(e.amount) || 0,
      quantity: Number(e.quantity) || 0,
      fee_type: e.fee_type || undefined,
      sku: e.sku || undefined,
      amazon_order_id: e.amazon_order_id || undefined,
      posted_date: e.posted_date,
      delivery_date: e.delivery_date || undefined,
      reference_id: e.reference_id || undefined,
      event_group_id: e.event_group_id || undefined,
      transaction_type: e.transaction_type || undefined,
      amount_description: e.amount_description || undefined,
    }));

    // ── 2. Fetch orders (with lifecycle fields) ──
    // Only include orders that are NOT purely OPEN — i.e. orders with some financial progress
    let ordersQ = supabase
      .from('orders')
      .select('amazon_order_id, purchase_date, shipment_date, delivery_date, order_status, fulfillment_channel, is_prime, financial_status, last_event_date, return_deadline, settlement_id, settlement_status, event_count, net_settlement_amount, financial_closed_at')
      .gte('purchase_date', startStr)
      .lte('purchase_date', endStr + 'T23:59:59')
      .order('purchase_date', { ascending: false });

    const { data: orders, error: ordErr } = await ordersQ;

    let resolvedOrders: any[];
    if (ordErr) {
      if (ordErr.code === '42703' || ordErr.message?.includes('column')) {
        // Fallback: lifecycle columns don't exist — fetch basic and mark all OPEN
        const { data: fallbackOrders, error: fbErr } = await supabase
          .from('orders')
          .select('amazon_order_id, purchase_date, shipment_date, delivery_date, order_status, fulfillment_channel, is_prime')
          .gte('purchase_date', startStr)
          .lte('purchase_date', endStr + 'T23:59:59')
          .order('purchase_date', { ascending: false });
        if (fbErr) throw fbErr;
        resolvedOrders = (fallbackOrders || []).map((o: any) => ({
          ...o,
          financial_status: 'OPEN',
          last_event_date: null,
          return_deadline: null,
          settlement_id: null,
          settlement_status: 'Unsettled',
          event_count: 0,
          net_settlement_amount: 0,
          financial_closed_at: null,
        }));
      } else {
        throw ordErr;
      }
    } else {
      resolvedOrders = orders || [];
    }

    // ── 3. Fetch SKU master ──
    const { data: skuMaster } = await supabase
      .from('skus')
      .select('sku, asin, title, category, brand, cost_per_unit, packaging_cost, shipping_cost_internal');

    // ── 4. Ad spend ──
    const adSpendMap = new Map<string, number>();
    try {
      const { data: adData } = await supabase
        .from('ad_metrics')
        .select('sku, ad_spend')
        .gte('date', startStr)
        .lte('date', endStr);
      for (const a of (adData || [])) {
        if (a.sku) adSpendMap.set(a.sku, (adSpendMap.get(a.sku) || 0) + (Number(a.ad_spend) || 0));
      }
    } catch { /* ad_metrics may not exist */ }

    // ── 5. Calculate revenue for ALL orders (engine needs full dataset) ──
    const result = calculateRevenue({
      events,
      orders: resolvedOrders,
      skuMaster: skuMaster || [],
      adSpendMap,
    });

    let { records } = result;

    // ── 6. Filter by financial status ──
    // Default (no status param) = FINANCIALLY_CLOSED only (solid figures)
    const SETTLED_STATES = ['DELIVERED_PENDING_SETTLEMENT', 'FINANCIALLY_CLOSED'];

    if (!statusFilter || statusFilter === 'FINANCIALLY_CLOSED') {
      // Default: only truly closed orders — solid, immutable figures
      records = records.filter(r => r.financial_status === 'FINANCIALLY_CLOSED');
    } else if (statusFilter === 'all') {
      // All settled (non-OPEN) orders — may still change
      records = records.filter(r => SETTLED_STATES.includes(r.financial_status));
    } else if (statusFilter === 'OPEN') {
      records = records.filter(r => r.financial_status === 'OPEN');
    } else {
      records = records.filter(r => r.financial_status === statusFilter);
    }

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      records = records.filter(r =>
        r.order_id.toLowerCase().includes(q) ||
        r.sku.toLowerCase().includes(q) ||
        r.product_name.toLowerCase().includes(q)
      );
    }

    // ── 7. Compute aggregated summary for ONLY filtered records ──
    const closedSummary = {
      total_orders: records.length,
      total_units: 0,
      gross_revenue: 0,
      total_product_sales: 0,
      total_shipping_credits: 0,
      total_promotional_rebates: 0,
      total_amazon_fees: 0,
      total_referral_fees: 0,
      total_closing_fees: 0,
      total_fba_fees: 0,
      total_easy_ship_fees: 0,
      total_weight_handling: 0,
      total_technology_fees: 0,
      total_other_charges: 0,
      total_shipping_chargeback: 0,
      total_storage_fees: 0,
      total_adjustment_fees: 0,
      total_other_fees: 0,
      total_gst: 0,
      total_tcs: 0,
      total_tds: 0,
      total_taxes: 0,
      total_refund_impact: 0,
      total_refund_amount: 0,
      returned_orders: 0,
      rto_orders: 0,
      customer_returns: 0,
      total_ad_spend: 0,
      net_settlement: 0,
    };

    for (const r of records) {
      closedSummary.total_units += r.quantity;
      closedSummary.total_product_sales += r.product_sales;
      closedSummary.total_shipping_credits += r.shipping_credits;
      closedSummary.total_promotional_rebates += r.promotional_rebates;
      closedSummary.gross_revenue += r.calculations.gross_revenue;
      closedSummary.total_amazon_fees += r.amazon_fees.total;
      closedSummary.total_referral_fees += r.amazon_fees.referral_fee;
      closedSummary.total_closing_fees += r.amazon_fees.closing_fee;
      closedSummary.total_fba_fees += r.amazon_fees.fba_fee;
      closedSummary.total_easy_ship_fees += r.amazon_fees.easy_ship_fee;
      closedSummary.total_weight_handling += r.amazon_fees.weight_handling_fee;
      closedSummary.total_technology_fees += r.amazon_fees.technology_fee;
      closedSummary.total_other_charges += r.other_charges.total;
      closedSummary.total_shipping_chargeback += r.other_charges.shipping_chargeback;
      closedSummary.total_storage_fees += r.other_charges.storage_fees;
      closedSummary.total_adjustment_fees += r.other_charges.adjustment_fees;
      closedSummary.total_other_fees += r.other_charges.other_fees;
      closedSummary.total_gst += r.taxes.gst;
      closedSummary.total_tcs += r.taxes.tcs;
      closedSummary.total_tds += r.taxes.tds;
      closedSummary.total_taxes += r.taxes.total;
      closedSummary.total_refund_impact += r.return_details.total_refund_impact;
      closedSummary.total_refund_amount += r.return_details.refund_amount;
      if (r.return_details.is_returned) closedSummary.returned_orders++;
      if (r.return_details.return_type === 'RTO') closedSummary.rto_orders++;
      if (r.return_details.return_type === 'Customer Return') closedSummary.customer_returns++;
      closedSummary.total_ad_spend += r.ad_spend;
      closedSummary.net_settlement += r.calculations.net_settlement;
    }

    // Round everything
    for (const key of Object.keys(closedSummary)) {
      const v = (closedSummary as any)[key];
      if (typeof v === 'number' && !Number.isInteger(v)) {
        (closedSummary as any)[key] = Math.round(v * 100) / 100;
      }
    }

    // ── 8. Status distribution across ALL orders (not just filtered) ──
    const allRecords = result.records;
    const distribution: Record<string, number> = {
      OPEN: 0,
      DELIVERED_PENDING_SETTLEMENT: 0,
      FINANCIALLY_CLOSED: 0,
    };
    for (const r of allRecords) {
      const s = r.financial_status || 'OPEN';
      distribution[s] = (distribution[s] || 0) + 1;
    }

    // ── 9. Lifecycle stats + closure timeline (30-day rule) ──
    const total = allRecords.length;
    const now = new Date();

    // Calculate when orders will become eligible for closure (delivery + 30 days)
    let earliestDelivery: string | null = null;
    let earliestEligibleDate: string | null = null;
    let daysUntilFirstEligible = 0;
    let refundedCount = 0;
    let eligibleForClosure = 0; // past 30d, no refund

    for (const r of allRecords) {
      if (r.delivery_date && r.financial_status !== 'FINANCIALLY_CLOSED') {
        const dd = new Date(r.delivery_date);
        const eligDate = new Date(dd.getTime() + 30 * 24 * 60 * 60 * 1000);
        if (!earliestDelivery || dd < new Date(earliestDelivery)) {
          earliestDelivery = r.delivery_date;
          earliestEligibleDate = eligDate.toISOString().split('T')[0];
          daysUntilFirstEligible = Math.max(0, Math.ceil((eligDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
        }
        // Check if past 30d
        if (eligDate < now) {
          eligibleForClosure++;
        }
      }
      // Count orders with refunds
      if (r.return_details?.is_returned || r.return_details?.refund_amount > 0) {
        refundedCount++;
      }
    }

    // ── 9b. Compute "Payments Finalized Till Date" ──
    // Group orders by purchase_date day, walk from earliest to latest.
    // Finalized-till = the latest date where ALL orders on that date are FINANCIALLY_CLOSED
    // (or have a manual INCLUDE/EXCLUDE override).
    // Skip NO_ORDER records (orderless events like adjustments/service fees).

    // Fetch manual overrides
    const { data: overridesData } = await supabase
      .from('finalized_order_overrides')
      .select('amazon_order_id, override_action');
    const overrideMap = new Map((overridesData || []).map((o: any) => [o.amazon_order_id, o.override_action]));

    const dayOrders = new Map<string, { total: number; closed: number; revenue: number }>();
    for (const r of allRecords) {
      if (!r.order_date) continue;
      if (r.order_id === 'NO_ORDER') continue;
      const day = r.order_date.slice(0, 10);
      if (!dayOrders.has(day)) dayOrders.set(day, { total: 0, closed: 0, revenue: 0 });
      const d = dayOrders.get(day)!;

      // Check for manual override
      const override = overrideMap.get(r.order_id);
      if (override === 'INCLUDE' || override === 'EXCLUDE') {
        // INCLUDE = treat as closed (user confirmed it's final)
        // EXCLUDE = skip entirely (don't count in total or closed)
        if (override === 'INCLUDE') {
          d.total++;
          d.closed++;
          d.revenue += r.calculations?.net_settlement || 0;
        }
        // EXCLUDE: don't add to total at all — invisible to finalized-till
        continue;
      }

      d.total++;
      if ((r.financial_status || 'OPEN') === 'FINANCIALLY_CLOSED') {
        d.closed++;
        d.revenue += r.calculations?.net_settlement || 0;
      }
    }
    const sortedDays = [...dayOrders.keys()].sort();
    let finalizedTillDate: string | null = null;
    let finalizedRevenue = 0;
    let finalizedOrderCount = 0;
    for (const day of sortedDays) {
      const d = dayOrders.get(day)!;
      if (d.total === 0 || d.total === d.closed) {
        finalizedTillDate = day;
        finalizedRevenue += d.revenue;
        finalizedOrderCount += d.total;
      } else {
        break;
      }
    }

    const lifecycleStats = {
      total_orders: total,
      ...distribution,
      settled_count: distribution.DELIVERED_PENDING_SETTLEMENT + distribution.FINANCIALLY_CLOSED,
      closure_rate: total > 0 ? Math.round((distribution.FINANCIALLY_CLOSED / total) * 10000) / 100 : 0,
      settlement_rate: total > 0
        ? Math.round(((distribution.DELIVERED_PENDING_SETTLEMENT + distribution.FINANCIALLY_CLOSED) / total) * 10000) / 100
        : 0,
      // Closure timeline
      earliest_delivery: earliestDelivery,
      earliest_eligible_date: earliestEligibleDate,
      days_until_first_eligible: daysUntilFirstEligible,
      refunded_count: refundedCount,
      eligible_for_closure: eligibleForClosure,
      // Finalized till date
      finalized_till_date: finalizedTillDate,
      finalized_revenue: Math.round(finalizedRevenue * 100) / 100,
      finalized_order_count: finalizedOrderCount,
    };

    // ── 10. Paginate ──
    const totalRecords = records.length;
    const totalPages = Math.ceil(totalRecords / pageSize) || 1;
    const offset = (page - 1) * pageSize;
    const paginatedRecords = records.slice(offset, offset + pageSize);

    return NextResponse.json({
      success: true,
      records: paginatedRecords,
      summary: closedSummary,
      lifecycle: lifecycleStats,
      distribution,
      pagination: {
        page,
        pageSize,
        totalRecords,
        totalPages,
      },
      dateRange: { start: startStr, end: endStr, filtered: hasDateFilter },
    });
  } catch (err: any) {
    console.error('[Financial Status Detail]', err?.message?.slice?.(0, 200) || err);
    const msg = String(err?.message || '');
    if (msg.includes('<!DOCTYPE') || msg.includes('<html') || msg.includes('SSL')) {
      return NextResponse.json(
        { error: 'Supabase connection failed. Please try again.', details: 'SSL_HANDSHAKE_FAILED' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: err.message || 'Unknown error' },
      { status: 500 },
    );
  }
}

/**
 * POST — Trigger closed order detection manually
 */
export async function POST() {
  try {
    const result = await detectClosedOrders('manual');
    return NextResponse.json({ success: true, result });
  } catch (err: any) {
    console.error('[Financial Status Detail] Manual run failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
