import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { calculateRevenue, type FinancialEvent } from '@/lib/revenue-engine';
import type { SettlementPeriod, RevenueCalculatorResponse } from '@/lib/revenue-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

/**
 * Revenue Calculator API — True Net Revenue Per Order & SKU
 *
 * Handles all transaction types:
 *   Order          → revenue + fees
 *   Refund         → reverses order (time-shifted)
 *   Shipping Services → Easy Ship / logistics charges
 *   Service Fee    → advertising, storage, subscriptions
 *   Adjustment     → weight correction, reimbursements
 *   Chargeback     → buyer disputes
 *   Retrocharge    → late adjustments
 *
 * Revenue formula:
 *   Gross Revenue  = Principal + ShippingCredits + GiftWrap
 *   Total Fees     = ReferralFee + FBAFee + ClosingFee + EasyShipFee + WeightHandling + ...
 *   Total Taxes    = GST + TCS + TDS
 *   Net Settlement = Gross Revenue + Promotions - Fees - Taxes - Refunds - AdSpend
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const period = searchParams.get('period') || '30d';
        const customStart = searchParams.get('startDate');
        const customEnd = searchParams.get('endDate');
        const searchQuery = searchParams.get('search') || '';
        const filterStatus = searchParams.get('status') || 'all';
        const filterTxnType = searchParams.get('txnType') || 'all';
        const page = parseInt(searchParams.get('page') || '1');
        const pageSize = parseInt(searchParams.get('pageSize') || '50');
        const tab = searchParams.get('tab') || 'orders';

        // ── Date range ──
        let startStr: string;
        let endStr: string;

        if (customStart) {
            startStr = customStart;
            endStr = customEnd || new Date().toISOString().split('T')[0];
        } else {
            const days = PERIOD_DAYS[period] || 30;
            const d = new Date(); d.setDate(d.getDate() - days);
            startStr = d.toISOString().split('T')[0];
            endStr = new Date().toISOString().split('T')[0];
        }

        // ── 1. Fetch financial events ──
        // Try with extended columns first; fall back to base columns if they don't exist yet
        const baseSelect = 'event_type, amount, quantity, fee_type, sku, amazon_order_id, posted_date, delivery_date, reference_id';
        const extSelect = baseSelect + ', event_group_id, transaction_type, amount_description';

        let rawEvents: any[] | null = null;
        let useExtended = true;

        {
            const q = supabase
                .from('financial_events')
                .select(extSelect)
                .gte('posted_date', startStr)
                .lte('posted_date', endStr + 'T23:59:59')
                .order('posted_date', { ascending: false });
            const { data, error: evErr } = await q;
            if (evErr) {
                // Column doesn't exist — fall back to base select
                if (evErr.message?.includes('column') || evErr.code === '42703') {
                    useExtended = false;
                } else {
                    throw evErr;
                }
            } else {
                rawEvents = data;
            }
        }

        if (!useExtended) {
            const q = supabase
                .from('financial_events')
                .select(baseSelect)
                .gte('posted_date', startStr)
                .lte('posted_date', endStr + 'T23:59:59')
                .order('posted_date', { ascending: false });
            const { data, error: evErr } = await q;
            if (evErr) throw evErr;
            rawEvents = data;
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

        // ── 2. Fetch orders metadata (including financial lifecycle) ──
        let ordersQ = supabase
            .from('orders')
            .select('amazon_order_id, purchase_date, shipment_date, delivery_date, order_status, fulfillment_channel, is_prime, financial_status, last_event_date, return_deadline, settlement_id, settlement_status, event_count, net_settlement_amount, financial_closed_at')
            .gte('purchase_date', startStr)
            .order('purchase_date', { ascending: false });
        ordersQ = ordersQ.lte('purchase_date', endStr + 'T23:59:59');

        const { data: orders, error: ordErr } = await ordersQ;
        if (ordErr) {
            // If new columns don't exist yet, fall back to basic select
            if (ordErr.code === '42703' || ordErr.message?.includes('column')) {
                const { data: fallbackOrders, error: fbErr } = await supabase
                    .from('orders')
                    .select('amazon_order_id, purchase_date, shipment_date, delivery_date, order_status, fulfillment_channel, is_prime')
                    .gte('purchase_date', startStr)
                    .lte('purchase_date', endStr + 'T23:59:59')
                    .order('purchase_date', { ascending: false });
                if (fbErr) throw fbErr;
                // Add default lifecycle fields
                var ordersFinal = (fallbackOrders || []).map((o: any) => ({
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
        }
        // @ts-ignore — ordersFinal may come from fallback path
        const resolvedOrders = typeof ordersFinal !== 'undefined' ? ordersFinal : (orders || []);

        // ── 3. Fetch SKU master ──
        const { data: skuMaster } = await supabase
            .from('skus')
            .select('sku, asin, title, category, brand, cost_per_unit, packaging_cost, shipping_cost_internal');

        // ── 4. Fetch ad spend per SKU ──
        const adSpendMap = new Map<string, number>();
        try {
            let adQ = supabase
                .from('ad_metrics')
                .select('sku, ad_spend')
                .gte('date', startStr);
            adQ = adQ.lte('date', endStr);
            const { data: adData } = await adQ;
            for (const a of (adData || [])) {
                if (a.sku) {
                    adSpendMap.set(a.sku, (adSpendMap.get(a.sku) || 0) + (Number(a.ad_spend) || 0));
                }
            }
        } catch {
            // ad_metrics may not exist
        }

        // ── 5. Run the revenue calculation engine ──
        const result = calculateRevenue({
            events,
            orders: resolvedOrders,
            skuMaster: skuMaster || [],
            adSpendMap,
        });

        let { records } = result;
        const { summary, skuSummary, waterfall } = result;

        // ── 6. Apply filters ──

        // Search filter
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            records = records.filter(r =>
                r.order_id.toLowerCase().includes(q) ||
                r.sku.toLowerCase().includes(q) ||
                r.product_name.toLowerCase().includes(q) ||
                r.asin.toLowerCase().includes(q)
            );
        }

        // Status filter
        if (filterStatus !== 'all') {
            switch (filterStatus) {
                case 'returned': records = records.filter(r => r.return_details.is_returned); break;
                case 'rto': records = records.filter(r => r.return_details.return_type === 'RTO'); break;
                case 'customer_return': records = records.filter(r => r.return_details.return_type === 'Customer Return'); break;
                case 'delivered': records = records.filter(r => r.delivery_date && !r.return_details.is_returned); break;
                case 'shipped': records = records.filter(r => r.order_status === 'Shipped' && !r.delivery_date); break;
                case 'cancelled': records = records.filter(r => r.order_status === 'Cancelled'); break;
            }
        }

        // Transaction type filter
        if (filterTxnType !== 'all') {
            records = records.filter(r => r.transaction_types.includes(filterTxnType as any));
        }

        // ── 7. Fetch settlement data ──
        let settlements: SettlementPeriod[] = [];
        if (tab === 'settlements') {
            try {
                // First try settlement_periods table (populated by sync)
                const { data: settlementData, error: spErr } = await supabase
                    .from('settlement_periods')
                    .select('*')
                    .order('fund_transfer_date', { ascending: false, nullsFirst: false });

                if (!spErr && settlementData && settlementData.length > 0) {
                    // Filter by date range in JS (table may not have proper range columns)
                    const filtered = settlementData.filter((sp: any) => {
                        const groupStart = sp.financial_event_group_start;
                        const groupEnd = sp.financial_event_group_end;
                        if (!groupStart) return true; // include if no date range
                        // Include if group overlaps with our query range
                        return groupStart <= endStr + 'T23:59:59' && (!groupEnd || groupEnd >= startStr);
                    });

                    for (const sp of filtered) {
                        // Get settlement item aggregates
                        const { data: items } = await supabase
                            .from('settlement_items')
                            .select('transaction_type, amount, quantity')
                            .eq('settlement_id', sp.settlement_id);

                        const orderItems = (items || []).filter((i: any) => i.transaction_type === 'Order');
                        const refundItems = (items || []).filter((i: any) => i.transaction_type === 'Refund');
                        const feeItems = (items || []).filter((i: any) =>
                            ['ServiceFee', 'ShippingServices'].includes(i.transaction_type));

                        // Count unique orders (by grouping — each order has multiple line items)
                        const orderCount = orderItems.length > 0
                            ? new Set(orderItems.map((i: any) => i.amazon_order_id).filter(Boolean)).size || orderItems.length
                            : 0;
                        const refundCount = refundItems.length > 0
                            ? new Set(refundItems.map((i: any) => i.amazon_order_id).filter(Boolean)).size || refundItems.length
                            : 0;
                        const feeTotal = Math.abs(feeItems.reduce((s: number, i: any) => s + Number(i.amount), 0));

                        settlements.push({
                            settlement_id: sp.settlement_id,
                            period_start: sp.financial_event_group_start,
                            period_end: sp.financial_event_group_end,
                            fund_transfer_date: sp.fund_transfer_date,
                            total_amount: Number(sp.original_total) || 0,
                            processing_status: sp.processing_status,
                            order_count: orderCount,
                            refund_count: refundCount,
                            fee_total: feeTotal,
                            net_payout: Number(sp.converted_total) || 0,
                        });
                    }
                } else {
                    // Fallback: try financial_event_groups table directly
                    const { data: groupData } = await supabase
                        .from('financial_event_groups')
                        .select('*')
                        .order('fund_transfer_date', { ascending: false, nullsFirst: false });

                    if (groupData && groupData.length > 0) {
                        for (const g of groupData) {
                            // Count linked financial events for this group
                            const { count: eventCount } = await supabase
                                .from('financial_events')
                                .select('id', { count: 'exact', head: true })
                                .eq('event_group_id', g.event_group_id);

                            const { count: refundEventCount } = await supabase
                                .from('financial_events')
                                .select('id', { count: 'exact', head: true })
                                .eq('event_group_id', g.event_group_id)
                                .eq('event_type', 'refund');

                            settlements.push({
                                settlement_id: g.event_group_id,
                                period_start: g.created_at,
                                period_end: g.fund_transfer_date || g.created_at,
                                fund_transfer_date: g.fund_transfer_date,
                                total_amount: Number(g.original_total) || 0,
                                processing_status: g.processing_status === 'Closed' ? 'Closed' : 'Open',
                                order_count: (eventCount || 0) - (refundEventCount || 0),
                                refund_count: refundEventCount || 0,
                                fee_total: 0,
                                net_payout: Number(g.original_total) || 0,
                            });
                        }
                    }
                }
            } catch {
                // Settlement tables may not exist yet — return empty array
            }
        }

        // ── 8. Paginate records ──
        const totalRecords = records.length;
        const totalPages = Math.ceil(totalRecords / pageSize) || 1;
        const offset = (page - 1) * pageSize;
        const paginatedRecords = records.slice(offset, offset + pageSize);

        // ── 9. Compute lifecycle stats from resolved orders ──
        let lifecycleStats: RevenueCalculatorResponse['lifecycle_stats'] = undefined;
        try {
            const statusCounts = { OPEN: 0, DELIVERED_PENDING_SETTLEMENT: 0, FINANCIALLY_CLOSED: 0 };
            for (const o of resolvedOrders) {
                const s = o.financial_status || 'OPEN';
                if (s in statusCounts) statusCounts[s as keyof typeof statusCounts]++;
            }
            const total = resolvedOrders.length;
            lifecycleStats = {
                total_orders: total,
                open: statusCounts.OPEN,
                delivered_pending_settlement: statusCounts.DELIVERED_PENDING_SETTLEMENT,
                financially_closed: statusCounts.FINANCIALLY_CLOSED,
                closure_rate: total > 0 ? Math.round((statusCounts.FINANCIALLY_CLOSED / total) * 10000) / 100 : 0,
            };
        } catch {
            // Non-fatal — lifecycle columns may not exist
        }

        const response: RevenueCalculatorResponse = {
            records: paginatedRecords,
            summary,
            sku_summary: skuSummary,
            waterfall,
            settlements,
            lifecycle_stats: lifecycleStats,
            pagination: { page, pageSize, totalRecords, totalPages },
            period: { start: startStr, end: endStr },
        };

        return NextResponse.json(response);
    } catch (err: any) {
        console.error('[Revenue Calculator]', err?.message?.slice?.(0, 200) || err);

        // Detect Supabase / network HTML error pages (e.g. SSL 525)
        const msg = String(err?.message || '');
        if (msg.includes('<!DOCTYPE') || msg.includes('<html') || msg.includes('SSL')) {
            return NextResponse.json(
                {
                    error: 'Supabase connection failed (SSL/network issue). Please try again in a moment.',
                    details: 'SSL_HANDSHAKE_FAILED',
                    hint: 'This is usually a temporary Supabase infrastructure issue. Retry in 30 seconds.',
                },
                { status: 503 }
            );
        }

        return NextResponse.json(
            { error: err.message || 'Unknown error', details: err.code || null, hint: err.hint || null },
            { status: 500 }
        );
    }
}
