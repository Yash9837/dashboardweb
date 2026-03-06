/**
 * Dashboard Data Engine — shared computation layer
 *
 * All data fetching and metric computation extracted here so both
 * the internal dashboard API and external APIs share the same logic.
 */

import { supabase } from '@/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PeriodRange {
    currentStart: string;
    currentEnd: string;
    prevStart: string;
    prevEnd: string;
    days: number;
    period: string;
}

export interface OrderMetrics {
    totalRevenue: number;
    totalOrders: number;
    pendingOrders: number;
    shippedOrders: number;
    deliveredOrders: number;
    canceledOrders: number;
    returnedOrders: number;
    unitsSold: number;
    avgOrderValue: number;
    returnRate: number;
    cancelRate: number;
    grossProfit: number;
}

export interface SKUPerformanceItem {
    sku: string;
    name: string;
    asin: string;
    status: string;
    revenue: number;
    unitsSold: number;
    returns: number;
    conversionRate: number;
    reviewsCount: number;
    starRating: number;
    bsr: number;
}

export interface InventoryItem {
    sku: string;
    name: string;
    platform: string;
    stock: number;
    maxStock: number;
    status: 'in-stock' | 'low-stock' | 'out-of-stock';
    fulfillableQty: number;
    inboundQty: number;
    reservedQty: number;
}

export interface RecentOrder {
    id: string;
    date: string;
    platform: string;
    location: string;
    city: string;
    state: string;
    items: number;
    total: number;
    currency: string;
    status: string;
}

export interface StateOrderCount {
    state: string;
    count: number;
}

export interface SlowMover {
    sku: string;
    name: string;
    stock: number;
}

export interface RevenueTrendPoint {
    date: string;
    revenue: number;
    orders: number;
    profit: number;
}

export interface OrderStatusDist {
    status: string;
    count: number;
}

export interface DashboardData {
    period: string;
    days: number;
    current: OrderMetrics;
    previous: OrderMetrics;
    recentOrders: RecentOrder[];
    stateWiseOrders: StateOrderCount[];
    inventoryItems: InventoryItem[];
    skuPerformance: SKUPerformanceItem[];
    topProducts: SKUPerformanceItem[];
    slowMovers: SlowMover[];
    inventoryDaysLeft: number;
    agedInventoryCount: number;
    totalSkus: number;
    outOfStockCount: number;
    lowStockCount: number;
    totalUnits: number;
    revenueTrend: RevenueTrendPoint[];
    orderStatusDistribution: OrderStatusDist[];
    granularity: 'daily' | 'weekly' | 'monthly';
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DASHBOARD_TIME_ZONE = process.env.DASHBOARD_TIMEZONE || 'Asia/Kolkata';

export const PERIODS: Record<string, number> = {
    '1d': 1, '7d': 7, '30d': 30, '90d': 90, '1y': 365,
};

export const PROFIT_MARGIN = 0.30;

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function parsePeriod(period: string): number {
    return PERIODS[period] || 30;
}

function getGranularity(days: number): 'daily' | 'weekly' | 'monthly' {
    if (days <= 30) return 'daily';
    if (days <= 90) return 'weekly';
    return 'monthly';
}

function getGroupKey(date: Date, granularity: 'daily' | 'weekly' | 'monthly'): string {
    if (granularity === 'daily') {
        return date.toISOString().split('T')[0]; // YYYY-MM-DD for external APIs
    }
    if (granularity === 'weekly') {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        return weekStart.toISOString().split('T')[0];
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getTodayStartIST(): string {
    const now = new Date();
    return now.toLocaleDateString('en-CA', { timeZone: DASHBOARD_TIME_ZONE }) + 'T00:00:00';
}

function getYesterdayIST(): { start: string; end: string } {
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: DASHBOARD_TIME_ZONE });
    const today = new Date(todayStr + 'T00:00:00Z');
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const yStr = yesterday.toISOString().split('T')[0];
    return { start: yStr + 'T00:00:00', end: yStr + 'T23:59:59' };
}

export function buildDateRange(period: string): PeriodRange {
    const days = parsePeriod(period);
    if (period === '1d') {
        const yday = getYesterdayIST();
        return {
            currentStart: getTodayStartIST(),
            currentEnd: new Date().toISOString(),
            prevStart: yday.start,
            prevEnd: yday.end,
            days, period,
        };
    }
    const now = new Date();
    return {
        currentStart: new Date(now.getTime() - days * 86400000).toISOString(),
        currentEnd: now.toISOString(),
        prevStart: new Date(now.getTime() - days * 2 * 86400000).toISOString(),
        prevEnd: new Date(now.getTime() - days * 86400000).toISOString(),
        days, period,
    };
}

function mapStatus(order: any): string {
    const s = order.order_status || '';
    if (s === 'Canceled' || s === 'Cancelled') return 'cancelled';
    if (s === 'Delivered' || order.delivery_date) return 'delivered';
    if (s === 'Shipped') return 'shipped';
    if (s === 'Unshipped') return 'processing';
    return 'pending';
}

function computeMetrics(orders: any[]): OrderMetrics {
    let totalRevenue = 0, pendingOrders = 0, shippedOrders = 0;
    let deliveredOrders = 0, canceledOrders = 0, returnedOrders = 0, unitsSold = 0;

    for (const o of orders) {
        totalRevenue += o._order_total || 0;
        unitsSold += o._unit_count || 1;
        const status = o.order_status || '';
        if (status === 'Pending' || status === 'Unshipped') pendingOrders++;
        else if (status === 'Shipped') shippedOrders++;
        else if (status === 'Canceled' || status === 'Cancelled') canceledOrders++;
        if (o.delivery_date) deliveredOrders++;
        if (o._has_refund) returnedOrders++;
    }

    const totalOrders = orders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const returnRate = totalOrders > 0 ? (returnedOrders / totalOrders) * 100 : 0;
    const cancelRate = totalOrders > 0 ? (canceledOrders / totalOrders) * 100 : 0;
    const grossProfit = totalRevenue * PROFIT_MARGIN;

    return {
        totalRevenue, totalOrders, pendingOrders, shippedOrders, deliveredOrders,
        canceledOrders, returnedOrders, unitsSold, avgOrderValue, returnRate, cancelRate, grossProfit,
    };
}

export function pctChange(curr: number, prev: number): number {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100);
}

export function trend(curr: number, prev: number): 'up' | 'down' | 'flat' {
    const c = pctChange(curr, prev);
    return c > 0 ? 'up' : c < 0 ? 'down' : 'flat';
}

// ─── Main Data Fetch ─────────────────────────────────────────────────────────

export async function fetchDashboardData(period: string): Promise<DashboardData> {
    const range = buildDateRange(period);
    const { currentStart, currentEnd, prevStart, prevEnd, days } = range;

    // 1. Fetch orders + inventory in parallel
    const [currentOrdersRes, prevOrdersRes, inventoryRes] = await Promise.all([
        supabase
            .from('orders')
            .select('amazon_order_id, purchase_date, shipment_date, delivery_date, order_status, fulfillment_channel, is_prime, financial_status, order_total, ship_city, ship_state')
            .gte('purchase_date', currentStart)
            .lte('purchase_date', currentEnd)
            .order('purchase_date', { ascending: false }),
        supabase
            .from('orders')
            .select('amazon_order_id, purchase_date, shipment_date, delivery_date, order_status, fulfillment_channel, is_prime, financial_status, order_total, ship_city, ship_state')
            .gte('purchase_date', prevStart)
            .lt('purchase_date', prevEnd)
            .order('purchase_date', { ascending: false }),
        supabase
            .from('inventory_snapshots')
            .select('sku, available_quantity, inbound_quantity, reserved_quantity, snapshot_date')
            .order('snapshot_date', { ascending: false })
            .limit(500),
    ]);

    if (currentOrdersRes.error) throw new Error(`Orders query failed: ${currentOrdersRes.error.message}`);
    if (prevOrdersRes.error) throw new Error(`Prev orders query: ${prevOrdersRes.error.message}`);

    const currentOrders = currentOrdersRes.data || [];
    const prevOrdersRaw = prevOrdersRes.data || [];

    // 2. Unit counts
    const allOrderIds = [...currentOrders, ...prevOrdersRaw].map(o => o.amazon_order_id);
    const unitCountMap = new Map<string, number>();
    if (allOrderIds.length > 0) {
        for (let i = 0; i < allOrderIds.length; i += 200) {
            const chunk = allOrderIds.slice(i, i + 200);
            const { data: items } = await supabase.from('order_items').select('amazon_order_id, quantity_ordered').in('amazon_order_id', chunk);
            for (const item of (items || [])) {
                unitCountMap.set(item.amazon_order_id, (unitCountMap.get(item.amazon_order_id) || 0) + (item.quantity_ordered || 1));
            }
        }
    }

    // 3. Revenue (order_total → fallback to order_items)
    const orderTotalMap = new Map<string, number>();
    const refundOrderIds = new Set<string>();

    for (const o of [...currentOrders, ...prevOrdersRaw]) {
        const total = Number((o as any).order_total) || 0;
        if (total > 0) orderTotalMap.set(o.amazon_order_id, total);
    }

    const missingTotalIds = allOrderIds.filter(id => !orderTotalMap.has(id));
    if (missingTotalIds.length > 0) {
        for (let i = 0; i < missingTotalIds.length; i += 200) {
            const chunk = missingTotalIds.slice(i, i + 200);
            const { data: items } = await supabase.from('order_items').select('amazon_order_id, item_price, shipping_price').in('amazon_order_id', chunk);
            for (const item of (items || [])) {
                if (!item.amazon_order_id) continue;
                const price = (Number(item.item_price) || 0) + (Number(item.shipping_price) || 0);
                orderTotalMap.set(item.amazon_order_id, (orderTotalMap.get(item.amazon_order_id) || 0) + price);
            }
        }
    }

    // 4. Refund detection
    if (allOrderIds.length > 0) {
        for (let i = 0; i < allOrderIds.length; i += 200) {
            const chunk = allOrderIds.slice(i, i + 200);
            const { data: events } = await supabase.from('financial_events').select('amazon_order_id, event_type').in('amazon_order_id', chunk).in('event_type', ['refund', 'Refund']);
            for (const e of (events || [])) {
                if (e.amazon_order_id) refundOrderIds.add(e.amazon_order_id);
            }
        }
    }

    // 5. Attach computed fields
    for (const o of [...currentOrders, ...prevOrdersRaw]) {
        (o as any)._unit_count = unitCountMap.get(o.amazon_order_id) || 1;
        (o as any)._order_total = orderTotalMap.get(o.amazon_order_id) || 0;
        (o as any)._has_refund = refundOrderIds.has(o.amazon_order_id);
    }

    const current = computeMetrics(currentOrders);
    const previous = computeMetrics(prevOrdersRaw);

    // 6. Recent orders with location
    const recentOrders: RecentOrder[] = currentOrders.slice(0, 50).map((o: any) => {
        const city = o.ship_city || '';
        const state = o.ship_state || '';
        return {
            id: o.amazon_order_id,
            date: o.purchase_date,
            platform: 'Amazon',
            location: city && state ? `${city}, ${state}` : city || state || '',
            city, state,
            items: unitCountMap.get(o.amazon_order_id) || 1,
            total: (o as any)._order_total || 0,
            currency: 'INR',
            status: mapStatus(o),
        };
    });

    // 7. State-wise order count
    const stateCount: Record<string, number> = {};
    for (const o of currentOrders) {
        const st = (o as any).ship_state;
        if (st) stateCount[st] = (stateCount[st] || 0) + 1;
    }
    const stateWiseOrders = Object.entries(stateCount)
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count);

    // 8. Inventory
    const inventoryRaw = inventoryRes.data || [];
    const invBySku = new Map<string, any>();
    for (const snap of inventoryRaw) {
        if (!invBySku.has(snap.sku)) invBySku.set(snap.sku, snap);
    }

    const skuNameMap = new Map<string, string>();
    const skuList = Array.from(invBySku.keys());
    if (skuList.length > 0) {
        for (let i = 0; i < skuList.length; i += 200) {
            const chunk = skuList.slice(i, i + 200);
            const { data: skuData } = await supabase.from('skus').select('sku, title').in('sku', chunk);
            for (const s of (skuData || [])) { if (s.title) skuNameMap.set(s.sku, s.title); }
        }
    }

    const inventoryItems: InventoryItem[] = Array.from(invBySku.values()).map((snap: any) => ({
        sku: snap.sku,
        name: skuNameMap.get(snap.sku) || 'Unknown',
        platform: 'Amazon',
        stock: snap.available_quantity || 0,
        maxStock: Math.max(snap.available_quantity || 0, 50),
        status: snap.available_quantity === 0 ? 'out-of-stock' as const : snap.available_quantity < 10 ? 'low-stock' as const : 'in-stock' as const,
        fulfillableQty: snap.available_quantity || 0,
        inboundQty: snap.inbound_quantity || 0,
        reservedQty: snap.reserved_quantity || 0,
    }));

    const totalSkus = inventoryItems.length;
    const outOfStockCount = inventoryItems.filter(i => i.status === 'out-of-stock').length;
    const lowStockCount = inventoryItems.filter(i => i.status === 'low-stock').length;
    const totalUnits = inventoryItems.reduce((sum, i) => sum + i.stock, 0);

    // 9. SKU-level metrics
    const skuRevenueMap = new Map<string, { revenue: number; units: number; returns: number }>();
    const currentOrderIds = currentOrders.map((o: any) => o.amazon_order_id);

    const skuAsinMap = new Map<string, string>();
    if (currentOrderIds.length > 0) {
        for (let i = 0; i < currentOrderIds.length; i += 200) {
            const chunk = currentOrderIds.slice(i, i + 200);
            const { data: items } = await supabase.from('order_items').select('amazon_order_id, sku, asin, title, item_price, shipping_price, quantity_ordered').in('amazon_order_id', chunk);
            for (const item of (items || [])) {
                const sku = item.sku || 'UNKNOWN';
                if (!skuRevenueMap.has(sku)) skuRevenueMap.set(sku, { revenue: 0, units: 0, returns: 0 });
                const entry = skuRevenueMap.get(sku)!;
                entry.revenue += (Number(item.item_price) || 0) + (Number(item.shipping_price) || 0);
                entry.units += item.quantity_ordered || 1;
                if (item.title && !skuNameMap.has(sku)) skuNameMap.set(sku, item.title);
                if (item.asin && !skuAsinMap.has(sku)) skuAsinMap.set(sku, item.asin);
                if (refundOrderIds.has(item.amazon_order_id)) entry.returns++;
            }
        }
    }

    // Fetch ALL SKUs from master table
    const { data: allSkusData } = await supabase.from('skus').select('sku, title, asin, status');
    const allSkusMaster = allSkusData || [];
    const skuMasterMap = new Map<string, any>();
    for (const s of allSkusMaster) {
        skuMasterMap.set(s.sku, s);
        if (s.title && !skuNameMap.has(s.sku)) skuNameMap.set(s.sku, s.title);
        if (s.asin && !skuAsinMap.has(s.sku)) skuAsinMap.set(s.sku, s.asin);
    }

    // Merge SKUs from ALL sources: skus table + order_items + inventory_snapshots
    const allSkuKeys = new Set<string>([
        ...skuMasterMap.keys(),
        ...skuRevenueMap.keys(),
        ...invBySku.keys(),
    ]);
    // Remove placeholder
    allSkuKeys.delete('UNKNOWN');

    const skuPerformance: SKUPerformanceItem[] = Array.from(allSkuKeys).map(sku => {
        const master = skuMasterMap.get(sku);
        const data = skuRevenueMap.get(sku);
        return {
            sku,
            name: skuNameMap.get(sku) || master?.title || 'Unknown',
            asin: skuAsinMap.get(sku) || master?.asin || '',
            status: master?.status || 'Active',
            revenue: data ? Math.round(data.revenue) : 0,
            unitsSold: data ? data.units : 0,
            returns: data ? data.returns : 0,
            conversionRate: 0,
            reviewsCount: 0,
            starRating: 0,
            bsr: 0,
        };
    }).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));

    const topProducts = skuPerformance.filter(s => s.revenue > 0).slice(0, 10);

    // 10. Slow movers & aged inventory
    const slowMovers: SlowMover[] = inventoryItems
        .filter(inv => {
            const d = skuRevenueMap.get(inv.sku);
            return inv.stock > 0 && (!d || d.units === 0);
        })
        .map(inv => ({ sku: inv.sku, name: inv.name, stock: inv.stock }));

    const avgDailySales = days > 0 && current.unitsSold > 0 ? current.unitsSold / days : 0;
    const inventoryDaysLeft = avgDailySales > 0 ? Math.round(totalUnits / avgDailySales) : totalUnits > 0 ? 999 : 0;
    const agedInventoryCount = slowMovers.length;

    // 11. Revenue trend
    const granularity = getGranularity(days);
    const trendMap: Record<string, { revenue: number; orders: number; profit: number }> = {};
    for (const o of currentOrders) {
        const date = new Date(o.purchase_date);
        const key = getGroupKey(date, granularity);
        if (!trendMap[key]) trendMap[key] = { revenue: 0, orders: 0, profit: 0 };
        trendMap[key].orders++;
        const rev = (o as any)._order_total || 0;
        trendMap[key].revenue += rev;
        trendMap[key].profit += rev * PROFIT_MARGIN;
    }
    const revenueTrend = Object.entries(trendMap)
        .map(([date, d]) => ({ date, revenue: Math.round(d.revenue), orders: d.orders, profit: Math.round(d.profit) }))
        .sort((a, b) => a.date.localeCompare(b.date));

    // 12. Order status distribution
    const orderStatusDistribution: OrderStatusDist[] = [
        { status: 'delivered', count: current.deliveredOrders },
        { status: 'shipped', count: Math.max(0, current.shippedOrders - current.deliveredOrders) },
        { status: 'pending', count: current.pendingOrders },
        { status: 'returned', count: current.returnedOrders },
        { status: 'cancelled', count: current.canceledOrders },
    ].filter(d => d.count > 0);

    return {
        period, days, current, previous,
        recentOrders, stateWiseOrders, inventoryItems, skuPerformance, topProducts,
        slowMovers, inventoryDaysLeft, agedInventoryCount,
        totalSkus, outOfStockCount, lowStockCount, totalUnits,
        revenueTrend, orderStatusDistribution, granularity,
    };
}
