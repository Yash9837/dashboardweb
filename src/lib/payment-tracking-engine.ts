// ============================================================================
// Payment Tracking Engine — Settlement-Based Order Payment Status
// ============================================================================
//
// Pipeline: Amazon SP-API → Sync → DB → This Engine → API → UI
//
// Payment Status States:
//   PENDING    → No financial transactions recorded for this order
//   POSTED     → Transactions exist, but settlement is still Open
//   CLOSED     → All settlements for this order's transactions are Closed
//   DISBURSED  → All settlements Closed + fund_transfer_status = 'Succeeded'
//
// Finalization Rule:
//   An order is finalized when ALL transactions belong to closed settlements
//   AND all settlements are disbursed (fund_transfer_status = 'Succeeded').
//
// "Payments Finalized Till Date":
//   Find the max order date where ALL orders on that date are DISBURSED.
//   Revenue up to that date = solid, unchangeable figures.
// ============================================================================

import { supabase, fetchAllRows } from './supabase';

// ── Types ────────────────────────────────────────────────────────────────────

export type PaymentStatus = 'PENDING' | 'POSTED' | 'CLOSED' | 'DISBURSED';

export interface SettlementGroupInfo {
    event_group_id: string;
    processing_status: 'Open' | 'Closed';
    fund_transfer_status: string;  // Initiated | Processing | Succeeded | Unknown
    fund_transfer_date: string | null;
    original_total: number;
    group_start: string | null;
    group_end: string | null;
}

export interface OrderTransaction {
    settlement_id: string;
    transaction_type: string;    // Order, Refund, ServiceFee, Adjustment
    amount_type: string;         // ItemPrice, ItemFees, Other
    amount_description: string;  // Principal, Commission, etc.
    amount: number;
    quantity: number;
    posted_date: string | null;
    sku: string | null;
}

export interface OrderPaymentRecord {
    amazon_order_id: string;
    order_date: string | null;
    order_status: string;
    payment_status: PaymentStatus;
    net_payment: number;
    transaction_count: number;
    transactions: OrderTransaction[];
    settlement_ids: string[];
    settlement_groups: SettlementGroupInfo[];
    // Timeline
    earliest_posted_date: string | null;
    latest_posted_date: string | null;
    settlement_closed_date: string | null;   // When last settlement closed
    disbursement_date: string | null;        // When funds were transferred
    // Breakdown
    product_sales: number;
    fees: number;
    refunds: number;
    taxes: number;
    other: number;
    // SKU info
    skus: string[];
    product_name: string;
    quantity: number;
}

export interface PaymentTrackingSummary {
    total_orders: number;
    pending_count: number;
    posted_count: number;
    closed_count: number;
    disbursed_count: number;
    pending_amount: number;
    posted_amount: number;
    closed_amount: number;
    disbursed_amount: number;
    finalized_till_date: string | null;
    finalized_revenue: number;
    finalized_order_count: number;
    // Unfinalized orders on the boundary date
    boundary_date: string | null;
    boundary_total_orders: number;
    boundary_disbursed_orders: number;
    boundary_remaining_orders: number;
}

export interface DailySettlementEntry {
    date: string;
    total_orders: number;
    pending: number;
    posted: number;
    closed: number;
    disbursed: number;
    total_amount: number;
    disbursed_amount: number;
    is_finalized: boolean;
}

export interface PaymentTrackingResult {
    records: OrderPaymentRecord[];
    summary: PaymentTrackingSummary;
    daily_timeline: DailySettlementEntry[];
    settlement_groups: SettlementGroupInfo[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function classifyAmount(txnType: string, amountType: string, amountDesc: string): 'product_sales' | 'fees' | 'refunds' | 'taxes' | 'other' {
    const desc = (amountDesc || '').toLowerCase();
    const type = (txnType || '').toLowerCase();
    const aType = (amountType || '').toLowerCase();

    if (type === 'refund') return 'refunds';

    if (aType === 'itemfees' || aType === 'item_fees') return 'fees';
    if (desc.includes('commission') || desc.includes('fee') || desc.includes('closing') ||
        desc.includes('fba') || desc.includes('shipping') || desc.includes('chargeback')) return 'fees';

    if (desc.includes('tax') || desc.includes('gst') || desc.includes('igst') ||
        desc.includes('tcs') || desc.includes('tds') || desc.includes('cgst') || desc.includes('sgst')) return 'taxes';

    if (desc.includes('principal') || desc.includes('itemprice') || aType === 'itemprice') return 'product_sales';

    if (type === 'order' && aType === 'itemprice') return 'product_sales';
    if (type === 'adjustment' || type === 'servicefee') return 'other';

    return 'other';
}

// ── Main Engine ──────────────────────────────────────────────────────────────

export async function computePaymentTracking(options?: {
    startDate?: string;
    endDate?: string;
    statusFilter?: PaymentStatus | 'all';
    search?: string;
    page?: number;
    pageSize?: number;
}): Promise<PaymentTrackingResult> {
    const {
        startDate,
        endDate,
        statusFilter = 'all',
        search = '',
        page = 1,
        pageSize = 50,
    } = options || {};

    // ── 1. Fetch all settlement groups ──
    const { data: groupsRaw } = await supabase
        .from('financial_event_groups')
        .select('event_group_id, processing_status, fund_transfer_status, fund_transfer_date, original_total');

    const { data: periodsRaw } = await supabase
        .from('settlement_periods')
        .select('settlement_id, financial_event_group_start, financial_event_group_end');

    const periodsMap = new Map<string, { start: string | null; end: string | null }>();
    for (const p of (periodsRaw || [])) {
        periodsMap.set(p.settlement_id, {
            start: p.financial_event_group_start,
            end: p.financial_event_group_end,
        });
    }

    const settlementGroups: SettlementGroupInfo[] = (groupsRaw || []).map(g => {
        const period = periodsMap.get(g.event_group_id);
        return {
            event_group_id: g.event_group_id,
            processing_status: g.processing_status === 'Closed' ? 'Closed' : 'Open',
            fund_transfer_status: g.fund_transfer_status || 'Unknown',
            fund_transfer_date: g.fund_transfer_date,
            original_total: Number(g.original_total) || 0,
            group_start: period?.start || null,
            group_end: period?.end || null,
        };
    });

    const groupMap = new Map<string, SettlementGroupInfo>();
    for (const g of settlementGroups) {
        groupMap.set(g.event_group_id, g);
    }

    // ── 2. Fetch all settlement items (order→settlement links) ──
    const settlementItems = await fetchAllRows(
        'settlement_items',
        'settlement_id, amazon_order_id, sku, transaction_type, amount_type, amount_description, amount, quantity, posted_date',
        q => q,
        'posted_date',
        false,
    );

    // ── 3. Fetch all orders ──
    let ordersQuery = supabase
        .from('orders')
        .select('amazon_order_id, purchase_date, order_status, fulfillment_channel')
        .order('purchase_date', { ascending: false });

    if (startDate) ordersQuery = ordersQuery.gte('purchase_date', startDate);
    if (endDate) ordersQuery = ordersQuery.lte('purchase_date', endDate + 'T23:59:59');

    const { data: ordersRaw } = await ordersQuery;

    const orderMap = new Map<string, { purchase_date: string | null; order_status: string; fulfillment_channel: string }>();
    for (const o of (ordersRaw || [])) {
        orderMap.set(o.amazon_order_id, {
            purchase_date: o.purchase_date,
            order_status: o.order_status || 'Unknown',
            fulfillment_channel: o.fulfillment_channel || 'MFN',
        });
    }

    // ── 4. Fetch SKU titles ──
    const { data: skuMaster } = await supabase.from('skus').select('sku, title');
    const titleMap = new Map<string, string>();
    for (const s of (skuMaster || [])) {
        if (s.sku && s.title) titleMap.set(s.sku, s.title);
    }

    // ── 5. Group settlement_items by order ──
    const orderTransactions = new Map<string, OrderTransaction[]>();
    for (const item of (settlementItems || [])) {
        const orderId = item.amazon_order_id;
        if (!orderId) continue;
        if (!orderTransactions.has(orderId)) orderTransactions.set(orderId, []);
        orderTransactions.get(orderId)!.push({
            settlement_id: item.settlement_id,
            transaction_type: item.transaction_type || 'Unknown',
            amount_type: item.amount_type || 'Other',
            amount_description: item.amount_description || '',
            amount: Number(item.amount) || 0,
            quantity: Number(item.quantity) || 0,
            posted_date: item.posted_date,
            sku: item.sku,
        });
    }

    // ── 6. Build per-order payment records ──
    // Include all orders from the orders table that match the date range
    const allOrderIds = new Set<string>([
        ...orderMap.keys(),
        ...orderTransactions.keys(),
    ]);

    const records: OrderPaymentRecord[] = [];

    for (const orderId of allOrderIds) {
        const orderInfo = orderMap.get(orderId);
        const txns = orderTransactions.get(orderId) || [];

        // Apply date filter (skip orders outside range if they came from settlement_items only)
        if (!orderInfo && (startDate || endDate)) continue;

        // Get unique settlement IDs
        const settlementIds = [...new Set(txns.map(t => t.settlement_id))];
        const relatedGroups = settlementIds
            .map(sid => groupMap.get(sid))
            .filter(Boolean) as SettlementGroupInfo[];

        // ── Determine payment status ──
        let paymentStatus: PaymentStatus;
        if (txns.length === 0) {
            paymentStatus = 'PENDING';
        } else if (relatedGroups.length === 0) {
            // Transactions exist but no matching groups found
            paymentStatus = 'POSTED';
        } else {
            const allClosed = relatedGroups.every(g => g.processing_status === 'Closed');
            const allDisbursed = allClosed && relatedGroups.every(g =>
                g.fund_transfer_status === 'Succeeded'
            );

            if (allDisbursed) {
                paymentStatus = 'DISBURSED';
            } else if (allClosed) {
                paymentStatus = 'CLOSED';
            } else {
                paymentStatus = 'POSTED';
            }
        }

        // ── Calculate net payment and breakdowns ──
        let netPayment = 0;
        let productSales = 0;
        let fees = 0;
        let refunds = 0;
        let taxes = 0;
        let other = 0;
        const skuSet = new Set<string>();
        const qtyCounted = new Set<string>();
        let totalQuantity = 0;
        let earliestPosted: string | null = null;
        let latestPosted: string | null = null;

        for (const txn of txns) {
            netPayment += txn.amount;

            const cat = classifyAmount(txn.transaction_type, txn.amount_type, txn.amount_description);
            switch (cat) {
                case 'product_sales': productSales += txn.amount; break;
                case 'fees': fees += txn.amount; break;
                case 'refunds': refunds += txn.amount; break;
                case 'taxes': taxes += txn.amount; break;
                case 'other': other += txn.amount; break;
            }

            if (txn.sku) skuSet.add(txn.sku);

            // Dedup quantity (same fix as revenue engine — count once per order+sku)
            if (txn.quantity > 0 && txn.sku) {
                const qKey = `${orderId}|${txn.sku}`;
                if (!qtyCounted.has(qKey)) {
                    totalQuantity += txn.quantity;
                    qtyCounted.add(qKey);
                }
            }

            if (txn.posted_date) {
                if (!earliestPosted || txn.posted_date < earliestPosted) earliestPosted = txn.posted_date;
                if (!latestPosted || txn.posted_date > latestPosted) latestPosted = txn.posted_date;
            }
        }

        // Settlement timeline dates
        let settlementClosedDate: string | null = null;
        let disbursementDate: string | null = null;
        for (const g of relatedGroups) {
            if (g.processing_status === 'Closed') {
                const end = g.group_end;
                if (end && (!settlementClosedDate || end > settlementClosedDate)) {
                    settlementClosedDate = end;
                }
            }
            if (g.fund_transfer_status === 'Succeeded' && g.fund_transfer_date) {
                if (!disbursementDate || g.fund_transfer_date > disbursementDate) {
                    disbursementDate = g.fund_transfer_date;
                }
            }
        }

        // Product name from first SKU
        const skuList = [...skuSet];
        const productName = skuList.length > 0
            ? (titleMap.get(skuList[0]) || skuList[0])
            : 'Unknown Product';

        records.push({
            amazon_order_id: orderId,
            order_date: orderInfo?.purchase_date || null,
            order_status: orderInfo?.order_status || 'Unknown',
            payment_status: paymentStatus,
            net_payment: Math.round(netPayment * 100) / 100,
            transaction_count: txns.length,
            transactions: txns,
            settlement_ids: settlementIds,
            settlement_groups: relatedGroups,
            earliest_posted_date: earliestPosted,
            latest_posted_date: latestPosted,
            settlement_closed_date: settlementClosedDate,
            disbursement_date: disbursementDate,
            product_sales: Math.round(productSales * 100) / 100,
            fees: Math.round(fees * 100) / 100,
            refunds: Math.round(refunds * 100) / 100,
            taxes: Math.round(taxes * 100) / 100,
            other: Math.round(other * 100) / 100,
            skus: skuList,
            product_name: productName,
            quantity: totalQuantity,
        });
    }

    // Sort by order date desc
    records.sort((a, b) => {
        if (!a.order_date && !b.order_date) return 0;
        if (!a.order_date) return 1;
        if (!b.order_date) return -1;
        return b.order_date.localeCompare(a.order_date);
    });

    // ── 7. Compute "Payments Finalized Till Date" ──
    // Group orders by day (order_date), walk from earliest to latest.
    // Finalized-till = the latest date where ALL orders on that date are DISBURSED.
    const dayOrders = new Map<string, { total: number; disbursed: number; amount: number }>();
    for (const r of records) {
        if (!r.order_date) continue;
        const day = r.order_date.slice(0, 10);
        if (!dayOrders.has(day)) dayOrders.set(day, { total: 0, disbursed: 0, amount: 0 });
        const d = dayOrders.get(day)!;
        d.total++;
        if (r.payment_status === 'DISBURSED') {
            d.disbursed++;
            d.amount += r.net_payment;
        }
    }

    const sortedDays = [...dayOrders.keys()].sort();
    let finalizedTillDate: string | null = null;
    let finalizedRevenue = 0;
    let finalizedOrderCount = 0;

    for (const day of sortedDays) {
        const d = dayOrders.get(day)!;
        if (d.total === d.disbursed) {
            // All orders on this day are disbursed — extend finalized date
            finalizedTillDate = day;
            finalizedRevenue += d.amount;
            finalizedOrderCount += d.total;
        } else {
            // Gap: not all orders disbursed on this day — stop advancing
            break;
        }
    }

    // Find boundary date (first date after finalized that still has undisbursed orders)
    let boundaryDate: string | null = null;
    let boundaryTotal = 0;
    let boundaryDisbursed = 0;
    for (const day of sortedDays) {
        if (finalizedTillDate && day <= finalizedTillDate) continue;
        const d = dayOrders.get(day)!;
        if (d.total !== d.disbursed) {
            boundaryDate = day;
            boundaryTotal = d.total;
            boundaryDisbursed = d.disbursed;
            break;
        }
    }

    // ── 8. Compute summary stats ──
    let pendingCount = 0, postedCount = 0, closedCount = 0, disbursedCount = 0;
    let pendingAmt = 0, postedAmt = 0, closedAmt = 0, disbursedAmt = 0;

    for (const r of records) {
        switch (r.payment_status) {
            case 'PENDING': pendingCount++; pendingAmt += r.net_payment; break;
            case 'POSTED': postedCount++; postedAmt += r.net_payment; break;
            case 'CLOSED': closedCount++; closedAmt += r.net_payment; break;
            case 'DISBURSED': disbursedCount++; disbursedAmt += r.net_payment; break;
        }
    }

    const summary: PaymentTrackingSummary = {
        total_orders: records.length,
        pending_count: pendingCount,
        posted_count: postedCount,
        closed_count: closedCount,
        disbursed_count: disbursedCount,
        pending_amount: Math.round(pendingAmt * 100) / 100,
        posted_amount: Math.round(postedAmt * 100) / 100,
        closed_amount: Math.round(closedAmt * 100) / 100,
        disbursed_amount: Math.round(disbursedAmt * 100) / 100,
        finalized_till_date: finalizedTillDate,
        finalized_revenue: Math.round(finalizedRevenue * 100) / 100,
        finalized_order_count: finalizedOrderCount,
        boundary_date: boundaryDate,
        boundary_total_orders: boundaryTotal,
        boundary_disbursed_orders: boundaryDisbursed,
        boundary_remaining_orders: boundaryTotal - boundaryDisbursed,
    };

    // ── 9. Daily timeline ──
    const dailyTimeline: DailySettlementEntry[] = sortedDays.map(day => {
        const d = dayOrders.get(day)!;
        // Count by status for this day
        let pending = 0, posted = 0, closed = 0, disbursed = 0, totalAmt = 0, disbAmt = 0;
        for (const r of records) {
            if (!r.order_date || r.order_date.slice(0, 10) !== day) continue;
            switch (r.payment_status) {
                case 'PENDING': pending++; break;
                case 'POSTED': posted++; break;
                case 'CLOSED': closed++; break;
                case 'DISBURSED': disbursed++; disbAmt += r.net_payment; break;
            }
            totalAmt += r.net_payment;
        }
        return {
            date: day,
            total_orders: d.total,
            pending,
            posted,
            closed,
            disbursed,
            total_amount: Math.round(totalAmt * 100) / 100,
            disbursed_amount: Math.round(disbAmt * 100) / 100,
            is_finalized: finalizedTillDate !== null && day <= finalizedTillDate,
        };
    });

    // ── 10. Apply status filter + search + pagination ──
    let filtered = records;

    if (statusFilter && statusFilter !== 'all') {
        filtered = filtered.filter(r => r.payment_status === statusFilter);
    }

    if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(r =>
            r.amazon_order_id.toLowerCase().includes(q) ||
            r.skus.some(s => s.toLowerCase().includes(q)) ||
            r.product_name.toLowerCase().includes(q)
        );
    }

    const totalRecords = filtered.length;
    const totalPages = Math.ceil(totalRecords / pageSize) || 1;
    const offset = (page - 1) * pageSize;
    const paginated = filtered.slice(offset, offset + pageSize);

    return {
        records: paginated,
        summary,
        daily_timeline: dailyTimeline,
        settlement_groups: settlementGroups,
    };
}

// ── Sync Settlements from Amazon SP-API ──────────────────────────────────────

export async function syncSettlementsFromAmazon(): Promise<{
    groups_synced: number;
    items_synced: number;
    duration_ms: number;
    errors: string[];
}> {
    const startTime = Date.now();
    const errors: string[] = [];

    // This function is called from the API route which handles the actual
    // Amazon API calls. It returns the sync results.
    // The actual SP-API calls are done in the sync-settlements route.

    return {
        groups_synced: 0,
        items_synced: 0,
        duration_ms: Date.now() - startTime,
        errors,
    };
}
