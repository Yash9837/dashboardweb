import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  detectClosedOrders,
  getLifecycleStats,
  getRecentRuns,
  type FinancialStatus,
} from '@/lib/order-lifecycle-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * GET /api/command-center/financial-status
 * 
 * Query parameters:
 *   action=stats     → Return lifecycle statistics
 *   action=runs      → Return recent detection run history
 *   action=orders    → Return orders with financial status details
 *   status=OPEN|DELIVERED_PENDING_SETTLEMENT|FINANCIALLY_CLOSED
 *   page=1           → Pagination
 *   pageSize=50      → Items per page
 *   search=          → Search by order_id
 *   period=30d       → Time range
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'stats';

    // ── Action: Stats ──
    if (action === 'stats') {
      const stats = await getLifecycleStats();
      return NextResponse.json({ success: true, stats });
    }

    // ── Action: Recent Runs ──
    if (action === 'runs') {
      const limit = parseInt(searchParams.get('limit') || '10');
      const runs = await getRecentRuns(limit);
      return NextResponse.json({ success: true, runs });
    }

    // ── Action: Orders with financial status ──
    const status = searchParams.get('status') as FinancialStatus | 'all' | null;
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');
    const search = searchParams.get('search') || '';
    const period = searchParams.get('period') || '90d';

    // Date range
    const days = parseInt(period.replace('d', '')) || 90;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let query = supabase
      .from('orders')
      .select(
        'amazon_order_id, purchase_date, delivery_date, order_status, financial_status, ' +
        'last_event_date, return_deadline, settlement_id, settlement_status, event_count, ' +
        'net_settlement_amount, financial_closed_at, fulfillment_channel, is_prime',
        { count: 'exact' }
      )
      .gte('purchase_date', startDate)
      .order('purchase_date', { ascending: false });

    // Filter by financial status
    if (status && status !== 'all') {
      query = query.eq('financial_status', status);
    }

    // Search
    if (search) {
      query = query.ilike('amazon_order_id', `%${search}%`);
    }

    // Pagination
    const offset = (page - 1) * pageSize;
    query = query.range(offset, offset + pageSize - 1);

    const { data: orders, count, error } = await query;
    if (error) throw error;

    // Build status distribution
    const { data: allOrders } = await supabase
      .from('orders')
      .select('financial_status')
      .gte('purchase_date', startDate);

    const distribution: Record<string, number> = {
      OPEN: 0,
      DELIVERED_PENDING_SETTLEMENT: 0,
      FINANCIALLY_CLOSED: 0,
    };
    for (const o of (allOrders || [])) {
      const s = o.financial_status || 'OPEN';
      distribution[s] = (distribution[s] || 0) + 1;
    }

    return NextResponse.json({
      success: true,
      orders: orders || [],
      distribution,
      pagination: {
        page,
        pageSize,
        totalRecords: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    });
  } catch (err: any) {
    console.error('[Financial Status]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/command-center/financial-status
 * 
 * Triggers the closed order detection manually.
 */
export async function POST() {
  try {
    const result = await detectClosedOrders('manual');
    return NextResponse.json({
      success: true,
      result,
    });
  } catch (err: any) {
    console.error('[Financial Status] Manual run failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
