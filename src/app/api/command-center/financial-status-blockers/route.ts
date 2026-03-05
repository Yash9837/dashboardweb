import { NextResponse } from 'next/server';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { calculateRevenue, type FinancialEvent } from '@/lib/revenue-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Financial Status Blockers API
 *
 * GET  — Returns all orders blocking the "Payments Finalized Till" date,
 *         plus any existing manual overrides.
 * POST — Set/update/remove an override for a specific order.
 *         Body: { order_id, action: 'INCLUDE'|'EXCLUDE'|'DEFER'|'RESET', reason? }
 */

// ── GET: Compute blockers ────────────────────────────────────────────────────

export async function GET() {
  try {
    // 1. Fetch all financial events + orders (same as financial-status-detail)
    const rawEvents = await fetchAllRows<FinancialEvent>('financial_events', '*');
    const { data: ordersData } = await supabase
      .from('orders')
      .select('amazon_order_id, purchase_date, delivery_date, order_status, financial_status, settlement_status, event_count');
    const ordersArr = ordersData || [];
    const orderMap = new Map(ordersArr.map((o: any) => [o.amazon_order_id, o]));

    // 2. Fetch settlement_items coverage
    const { data: siData } = await supabase
      .from('settlement_items')
      .select('amazon_order_id, settlement_id, amount');
    const siByOrder = new Map<string, { count: number; total: number }>();
    for (const si of (siData || [])) {
      if (!si.amazon_order_id) continue;
      const existing = siByOrder.get(si.amazon_order_id) || { count: 0, total: 0 };
      existing.count++;
      existing.total += Number(si.amount) || 0;
      siByOrder.set(si.amazon_order_id, existing);
    }

    // 3. Fetch SKU master + ad spend (required by revenue engine)
    const { data: skuMaster } = await supabase
      .from('skus')
      .select('sku, asin, title, category, brand, cost_per_unit, packaging_cost, shipping_cost_internal');
    const adSpendMap = new Map<string, number>();

    // 4. Fetch existing overrides
    const { data: overridesData } = await supabase
      .from('finalized_order_overrides')
      .select('*');
    const overrideMap = new Map((overridesData || []).map((o: any) => [o.amazon_order_id, o]));

    // 5. Build revenue records (reuse the same engine)
    const result = calculateRevenue({
      events: rawEvents,
      orders: ordersArr,
      skuMaster: skuMaster || [],
      adSpendMap,
    });

    // 6. Group by purchase_date day
    const dayOrders = new Map<string, Array<{
      order_id: string;
      order_date: string;
      financial_status: string;
      order_status: string;
      delivery_date: string | null;
      settlement_status: string;
      event_count: number;
      settlement_items_count: number;
      net_revenue: number;
      event_types: string[];
      event_dates: { min: string; max: string } | null;
      reason: string;
      reason_detail: string;
      override: any | null;
    }>>();

    for (const r of result.records) {
      if (!r.order_date) continue;
      if (r.order_id === 'NO_ORDER') continue;
      const day = r.order_date.slice(0, 10);
      if (!dayOrders.has(day)) dayOrders.set(day, []);

      const orderInfo = orderMap.get(r.order_id);
      const si = siByOrder.get(r.order_id);
      const override = overrideMap.get(r.order_id) || null;

      // Build event info
      const orderEvents = rawEvents.filter(e => e.amazon_order_id === r.order_id);
      const eventTypes = [...new Set(orderEvents.map(e => e.event_type))];
      const eventDates = orderEvents.map(e => (e.posted_date || '').slice(0, 10)).filter(Boolean).sort();

      // Determine reason for being a blocker (plain English)
      let reason = '';
      let reasonDetail = '';
      const fs = r.financial_status || 'OPEN';
      if (fs === 'OPEN') {
        if ((orderInfo?.event_count || 0) === 0 && orderEvents.length === 0) {
          reason = 'Amazon hasn\'t recorded any charges/fees for this order yet';
          reasonDetail = 'This usually means the order is very new or hasn\'t been shipped yet. Amazon creates financial records only after shipment.';
        } else {
          reason = 'Order is too recent — Amazon hasn\'t settled it yet';
          reasonDetail = 'Amazon has recorded charges & fees, but hasn\'t included this order in any settlement cycle (disbursement to your bank) yet. Amazon settles every ~14 days.';
        }
      } else if (fs === 'DELIVERED_PENDING_SETTLEMENT') {
        if (!si || si.count === 0) {
          reason = 'Delivered & charges recorded, but Amazon hasn\'t disbursed the money yet';
          reasonDetail = `Amazon recorded ${orderEvents.length} financial entries (sale amount, fees, taxes) but this order hasn't appeared in any settlement report yet. The money is with Amazon — not yet transferred to your bank.`;
        } else {
          reason = 'Settlement in progress — Amazon is processing the disbursement';
          reasonDetail = 'This order is part of a settlement batch that Amazon hasn\'t fully closed yet. Once closed, the money will be transferred to your bank.';
        }
      }

      dayOrders.get(day)!.push({
        order_id: r.order_id,
        order_date: r.order_date,
        financial_status: fs,
        order_status: orderInfo?.order_status || 'Unknown',
        delivery_date: orderInfo?.delivery_date || null,
        settlement_status: orderInfo?.settlement_status || 'Unsettled',
        event_count: orderEvents.length,
        settlement_items_count: si?.count || 0,
        net_revenue: r.calculations?.net_settlement || 0,
        event_types: eventTypes,
        event_dates: eventDates.length > 0
          ? { min: eventDates[0], max: eventDates[eventDates.length - 1] }
          : null,
        reason,
        reason_detail: reasonDetail,
        override,
      });
    }

    // 6b. Add "ghost" orders — orders in DB with NO financial events at all
    //     These are invisible to the revenue engine but still block finalized-till
    const ordersInEngine = new Set(result.records.map(r => r.order_id));
    for (const order of ordersArr) {
      if (ordersInEngine.has(order.amazon_order_id)) continue; // already covered above
      if (!order.purchase_date) continue;

      const oid = order.amazon_order_id;
      const day = order.purchase_date.slice(0, 10);
      if (!dayOrders.has(day)) dayOrders.set(day, []);

      const si = siByOrder.get(oid);
      const override = overrideMap.get(oid) || null;
      const fs = order.financial_status || 'OPEN';

      // Skip if already financially closed
      if (fs === 'FINANCIALLY_CLOSED') {
        dayOrders.get(day)!.push({
          order_id: oid,
          order_date: order.purchase_date,
          financial_status: fs,
          order_status: order.order_status || 'Unknown',
          delivery_date: order.delivery_date || null,
          settlement_status: order.settlement_status || 'Unsettled',
          event_count: 0,
          settlement_items_count: si?.count || 0,
          net_revenue: 0,
          event_types: [],
          event_dates: null,
          reason: '',
          reason_detail: '',
          override,
        });
        continue;
      }

      // Determine reason
      let reason = '';
      let reasonDetail = '';
      const isCancelled = (order.order_status || '').toLowerCase().includes('cancel');
      if (isCancelled) {
        reason = 'Order was cancelled — no charges expected';
        reasonDetail = 'Cancelled orders usually have no financial events. Amazon won\'t charge fees for cancelled orders. You can safely Exclude this.';
      } else if (order.delivery_date) {
        const daysAgo = Math.floor((Date.now() - new Date(order.delivery_date).getTime()) / 86400000);
        reason = `Delivered ${daysAgo} days ago but Amazon hasn't recorded any charges yet`;
        reasonDetail = 'This order was delivered but has zero financial events in our database. This could be a sync gap — the charges exist at Amazon but we haven\'t fetched them. Try running a data sync.';
      } else if ((order.order_status || '').toLowerCase().includes('ship')) {
        reason = 'Shipped but no financial charges recorded yet';
        reasonDetail = 'This order has been shipped but Amazon hasn\'t created financial records for it yet. This is normal for very recent orders — charges usually appear within a few days of shipment.';
      } else {
        reason = 'No financial activity — order may be too new or processing';
        reasonDetail = 'This order exists in our database but Amazon has not yet created any financial events (charges, fees, taxes) for it. This is normal for orders that haven\'t shipped yet.';
      }

      dayOrders.get(day)!.push({
        order_id: oid,
        order_date: order.purchase_date,
        financial_status: fs,
        order_status: order.order_status || 'Unknown',
        delivery_date: order.delivery_date || null,
        settlement_status: order.settlement_status || 'Unsettled',
        event_count: 0,
        settlement_items_count: si?.count || 0,
        net_revenue: 0,
        event_types: [],
        event_dates: null,
        reason,
        reason_detail: reasonDetail,
        override,
      });
    }

    // 7. Walk days to find finalized-till + blockers
    const sortedDays = [...dayOrders.keys()].sort();
    let finalizedTillDate: string | null = null;
    let finalizedRevenue = 0;
    let finalizedOrderCount = 0;
    const blockerDays: Array<{
      date: string;
      total_orders: number;
      closed_orders: number;
      blockers: any[];
    }> = [];

    let hitBlocker = false;
    for (const day of sortedDays) {
      const orders = dayOrders.get(day)!;
      const nonClosed = orders.filter(o => {
        // If order has INCLUDE override, treat as closed for finalized-till
        if (o.override?.override_action === 'INCLUDE') return false;
        // If order has EXCLUDE override, it's still a blocker (permanently excluded)
        // But EXCLUDE means "skip this order entirely" — don't count it
        if (o.override?.override_action === 'EXCLUDE') return false;
        return (o.financial_status || 'OPEN') !== 'FINANCIALLY_CLOSED';
      });

      if (nonClosed.length === 0 && !hitBlocker) {
        finalizedTillDate = day;
        for (const o of orders) {
          finalizedRevenue += o.net_revenue;
          finalizedOrderCount++;
        }
      } else {
        hitBlocker = true;
        const closed = orders.filter(o => {
            if (o.override?.override_action === 'INCLUDE') return true;
            if (o.override?.override_action === 'EXCLUDE') return true;
            return o.financial_status === 'FINANCIALLY_CLOSED';
          }).length;

          blockerDays.push({
            date: day,
            total_orders: orders.length,
            closed_orders: closed,
            blockers: nonClosed,
          });
      }
    }

    // 8. Summary
    const totalBlockers = blockerDays.reduce((s, d) => s + d.blockers.length, 0);
    const blockerRevenue = blockerDays.reduce((s, d) =>
      s + d.blockers.reduce((ss, b) => ss + b.net_revenue, 0), 0);
    const overrideCounts = {
      INCLUDE: (overridesData || []).filter((o: any) => o.override_action === 'INCLUDE').length,
      EXCLUDE: (overridesData || []).filter((o: any) => o.override_action === 'EXCLUDE').length,
      DEFER: (overridesData || []).filter((o: any) => o.override_action === 'DEFER').length,
    };

    return NextResponse.json({
      success: true,
      finalized_till_date: finalizedTillDate,
      finalized_revenue: Math.round(finalizedRevenue * 100) / 100,
      finalized_order_count: finalizedOrderCount,
      total_blockers: totalBlockers,
      blocker_revenue: Math.round(blockerRevenue * 100) / 100,
      blocker_days: blockerDays,
      override_counts: overrideCounts,
      all_overrides: overridesData || [],
    });
  } catch (err: any) {
    console.error('[Blockers API GET]', err?.message?.slice?.(0, 200));
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── POST: Set/update/remove override ─────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { order_id, action, reason } = body;

    if (!order_id) {
      return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
    }

    // RESET = delete the override
    if (action === 'RESET') {
      const { error } = await supabase
        .from('finalized_order_overrides')
        .delete()
        .eq('amazon_order_id', order_id);
      if (error) throw error;
      return NextResponse.json({ success: true, action: 'RESET', order_id });
    }

    if (!['INCLUDE', 'EXCLUDE', 'DEFER'].includes(action)) {
      return NextResponse.json({ error: 'action must be INCLUDE, EXCLUDE, DEFER, or RESET' }, { status: 400 });
    }

    // Fetch current order info for metadata
    const { data: orderData } = await supabase
      .from('orders')
      .select('financial_status, order_status, settlement_status, event_count')
      .eq('amazon_order_id', order_id)
      .single();

    const { error } = await supabase
      .from('finalized_order_overrides')
      .upsert({
        amazon_order_id: order_id,
        override_action: action,
        reason: reason || null,
        overridden_by: 'user',
        overridden_at: new Date().toISOString(),
        original_status: orderData?.financial_status || 'UNKNOWN',
        original_blocker_reason: `Was ${orderData?.financial_status || 'OPEN'}, settlement=${orderData?.settlement_status || 'Unsettled'}`,
        metadata: {
          order_status: orderData?.order_status,
          event_count: orderData?.event_count,
        },
      }, { onConflict: 'amazon_order_id' });

    if (error) throw error;

    return NextResponse.json({ success: true, action, order_id, reason });
  } catch (err: any) {
    console.error('[Blockers API POST]', err?.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
