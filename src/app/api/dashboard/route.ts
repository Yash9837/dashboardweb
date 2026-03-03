import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { formatINR } from '@/lib/utils';
import { getCached, setCache, TTL } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// ─── Period Helpers ──────────────────────────────────────────────────────────

const PERIODS: Record<string, number> = {
    '1d': 1,
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '1y': 365,
};

const DASHBOARD_TIME_ZONE = process.env.DASHBOARD_TIMEZONE || 'Asia/Kolkata';
const DASHBOARD_CACHE_VERSION = 'v5-supabase';

function getGranularity(days: number): 'daily' | 'weekly' | 'monthly' {
    if (days <= 30) return 'daily';
    if (days <= 90) return 'weekly';
    return 'monthly';
}

function getGroupKey(date: Date, granularity: 'daily' | 'weekly' | 'monthly'): string {
    if (granularity === 'daily') {
        return date.toLocaleDateString('en-IN', { month: 'short', day: '2-digit', timeZone: DASHBOARD_TIME_ZONE });
    }
    if (granularity === 'weekly') {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        return weekStart.toLocaleDateString('en-IN', { month: 'short', day: '2-digit', timeZone: DASHBOARD_TIME_ZONE });
    }
    return date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: DASHBOARD_TIME_ZONE });
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

// ─── Map Supabase order_status to display status ─────────────────────────────

function mapStatus(order: any): string {
    const s = order.order_status || '';
    if (s === 'Canceled' || s === 'Cancelled') return 'cancelled';
    if (s === 'Delivered' || order.delivery_date) return 'delivered';
    if (s === 'Shipped') return 'shipped';
    if (s === 'Unshipped') return 'processing';
    return 'pending';
}

// ─── Metrics computation ─────────────────────────────────────────────────────

const PROFIT_MARGIN = 0.30;

function computeMetrics(orders: any[]) {
    let totalRevenue = 0;
    let pendingOrders = 0;
    let shippedOrders = 0;
    let deliveredOrders = 0;
    let canceledOrders = 0;
    let returnedOrders = 0;
    let unitsSold = 0;

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

// ─── Main handler ────────────────────────────────────────────────────────────

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const period = searchParams.get('period') || '30d';
        const days = PERIODS[period] || 30;
        const forceRefresh = searchParams.get('refresh') === 'true';

        const cacheKey = `dashboard_${period}_${DASHBOARD_CACHE_VERSION}`;

        // 1. Try cache
        if (!forceRefresh) {
            const cached = getCached<any>(cacheKey);
            if (cached) {
                return NextResponse.json({ ...cached, source: 'cache' });
            }
        }

        // 2. Date ranges
        let currentStart: string;
        let currentEnd: string;
        let prevStart: string;
        let prevEnd: string;

        if (period === '1d') {
            currentStart = getTodayStartIST();
            currentEnd = new Date().toISOString();
            const yday = getYesterdayIST();
            prevStart = yday.start;
            prevEnd = yday.end;
        } else {
            const now = new Date();
            currentStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
            currentEnd = now.toISOString();
            prevStart = new Date(now.getTime() - days * 2 * 24 * 60 * 60 * 1000).toISOString();
            prevEnd = currentStart;
        }

        // 3. Fetch orders + inventory from Supabase in parallel
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
        if (prevOrdersRes.error) throw new Error(`Prev orders query failed: ${prevOrdersRes.error.message}`);

        const currentOrders = currentOrdersRes.data || [];
        const prevOrdersRaw = prevOrdersRes.data || [];

        // 4. Get unit counts from order_items
        const allOrderIds = [...currentOrders, ...prevOrdersRaw].map(o => o.amazon_order_id);
        const unitCountMap = new Map<string, number>();

        if (allOrderIds.length > 0) {
            for (let i = 0; i < allOrderIds.length; i += 200) {
                const chunk = allOrderIds.slice(i, i + 200);
                const { data: items } = await supabase
                    .from('order_items')
                    .select('amazon_order_id, quantity_ordered')
                    .in('amazon_order_id', chunk);
                for (const item of (items || [])) {
                    unitCountMap.set(item.amazon_order_id, (unitCountMap.get(item.amazon_order_id) || 0) + (item.quantity_ordered || 1));
                }
            }
        }

        // 5. Revenue: Use orders.order_total (customer-facing selling price from Amazon)
        // Fall back to sum(order_items.item_price + shipping_price) if order_total is 0/null
        const orderTotalMap = new Map<string, number>();
        const refundOrderIds = new Set<string>();

        // First: use order_total directly from orders table
        for (const o of [...currentOrders, ...prevOrdersRaw]) {
            const total = Number((o as any).order_total) || 0;
            if (total > 0) orderTotalMap.set(o.amazon_order_id, total);
        }

        // Fallback: for orders missing order_total, compute from order_items
        const missingTotalIds = allOrderIds.filter(id => !orderTotalMap.has(id));
        if (missingTotalIds.length > 0) {
            for (let i = 0; i < missingTotalIds.length; i += 200) {
                const chunk = missingTotalIds.slice(i, i + 200);
                const { data: items } = await supabase
                    .from('order_items')
                    .select('amazon_order_id, item_price, shipping_price')
                    .in('amazon_order_id', chunk);
                for (const item of (items || [])) {
                    if (!item.amazon_order_id) continue;
                    const price = (Number(item.item_price) || 0) + (Number(item.shipping_price) || 0);
                    orderTotalMap.set(item.amazon_order_id, (orderTotalMap.get(item.amazon_order_id) || 0) + price);
                }
            }
        }

        // Detect refunds from financial_events
        if (allOrderIds.length > 0) {
            for (let i = 0; i < allOrderIds.length; i += 200) {
                const chunk = allOrderIds.slice(i, i + 200);
                const { data: events } = await supabase
                    .from('financial_events')
                    .select('amazon_order_id, event_type')
                    .in('amazon_order_id', chunk)
                    .in('event_type', ['refund', 'Refund']);
                for (const e of (events || [])) {
                    if (e.amazon_order_id) refundOrderIds.add(e.amazon_order_id);
                }
            }
        }

        // Attach computed fields to orders
        for (const o of currentOrders) {
            (o as any)._unit_count = unitCountMap.get(o.amazon_order_id) || 1;
            (o as any)._order_total = orderTotalMap.get(o.amazon_order_id) || 0;
            (o as any)._has_refund = refundOrderIds.has(o.amazon_order_id);
        }
        for (const o of prevOrdersRaw) {
            (o as any)._unit_count = unitCountMap.get(o.amazon_order_id) || 1;
            (o as any)._order_total = orderTotalMap.get(o.amazon_order_id) || 0;
            (o as any)._has_refund = refundOrderIds.has(o.amazon_order_id);
        }

        const current = computeMetrics(currentOrders);
        const prev = computeMetrics(prevOrdersRaw);

        // 6. % change helpers
        function pctChange(curr: number, previous: number): number {
            if (previous === 0) return curr > 0 ? 100 : 0;
            return Math.round(((curr - previous) / previous) * 100);
        }
        function trend(curr: number, previous: number): 'up' | 'down' | 'flat' {
            const c = pctChange(curr, previous);
            return c > 0 ? 'up' : c < 0 ? 'down' : 'flat';
        }

        // 7. KPIs
        const kpis = [
            { label: 'Total Revenue', value: formatINR(current.totalRevenue), change: pctChange(current.totalRevenue, prev.totalRevenue), trend: trend(current.totalRevenue, prev.totalRevenue), icon: 'indian-rupee' },
            { label: 'Gross Profit', value: formatINR(current.grossProfit), change: pctChange(current.grossProfit, prev.grossProfit), trend: trend(current.grossProfit, prev.grossProfit), icon: 'bar-chart' },
            { label: 'Total Orders', value: current.totalOrders.toLocaleString('en-IN'), change: pctChange(current.totalOrders, prev.totalOrders), trend: trend(current.totalOrders, prev.totalOrders), icon: 'shopping-cart' },
            { label: 'Avg Order Value', value: formatINR(current.avgOrderValue), change: pctChange(current.avgOrderValue, prev.avgOrderValue), trend: trend(current.avgOrderValue, prev.avgOrderValue), icon: 'trending-up' },
            { label: 'Units Ordered', value: current.unitsSold.toLocaleString('en-IN'), change: pctChange(current.unitsSold, prev.unitsSold), trend: trend(current.unitsSold, prev.unitsSold), icon: 'package-check' },
            { label: 'Returns', value: current.returnedOrders.toString(), change: pctChange(current.returnedOrders, prev.returnedOrders), trend: trend(current.returnedOrders, prev.returnedOrders), icon: 'package-x' },
            { label: 'Cancellations', value: current.canceledOrders.toString(), change: pctChange(current.canceledOrders, prev.canceledOrders), trend: trend(current.canceledOrders, prev.canceledOrders), icon: 'x-circle' },
            { label: 'Return Rate', value: `${current.returnRate.toFixed(1)}%`, change: pctChange(current.returnRate, prev.returnRate), trend: trend(current.returnRate, prev.returnRate), icon: 'percent' },
        ];

        // 8. Revenue chart
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

        const revenueChartData = Object.entries(trendMap)
            .map(([date, d]) => ({
                date, amazon: Math.round(d.revenue), shopify: 0, walmart: 0,
                total: Math.round(d.revenue), orders: d.orders, profit: Math.round(d.profit),
            }))
            .sort((a, b) => {
                const p = (s: string) => { try { return new Date(s).getTime(); } catch { return 0; } };
                return p(a.date) - p(b.date);
            });

        // 9. Order status distribution
        const orderStatusData = [
            { status: 'Delivered', count: current.deliveredOrders, color: '#22c55e' },
            { status: 'Shipped', count: Math.max(0, current.shippedOrders - current.deliveredOrders), color: '#6366f1' },
            { status: 'Pending', count: current.pendingOrders, color: '#94a3b8' },
            { status: 'Returned', count: current.returnedOrders, color: '#ef4444' },
            { status: 'Cancelled', count: current.canceledOrders, color: '#64748b' },
        ].filter(d => d.count > 0);

        // 10. Recent orders
        const recentOrders = currentOrders.slice(0, 15).map((o: any) => {
            const city = o.ship_city || '';
            const state = o.ship_state || '';
            const location = city && state ? `${city}, ${state}` : city || state || '—';
            return {
                id: o.amazon_order_id,
                date: o.purchase_date,
                platform: 'Amazon',
                customer: location,
                items: unitCountMap.get(o.amazon_order_id) || 1,
                total: (o as any)._order_total || 0,
                currency: 'INR',
                status: mapStatus(o),
            };
        });

        // State-wise order count (for Traffic & Conversion section)
        const stateOrderCount: Record<string, number> = {};
        for (const o of currentOrders) {
            const st = (o as any).ship_state;
            if (st) stateOrderCount[st] = (stateOrderCount[st] || 0) + 1;
        }
        const stateWiseOrders = Object.entries(stateOrderCount)
            .map(([state, count]) => ({ state, count }))
            .sort((a, b) => b.count - a.count);

        // 11. Inventory from latest snapshots (dedupe by SKU)
        const inventoryRaw = inventoryRes.data || [];
        const invBySku = new Map<string, any>();
        for (const snap of inventoryRaw) {
            if (!invBySku.has(snap.sku)) invBySku.set(snap.sku, snap);
        }

        const skuList = Array.from(invBySku.keys());
        const skuNameMap = new Map<string, string>();
        if (skuList.length > 0) {
            for (let i = 0; i < skuList.length; i += 200) {
                const chunk = skuList.slice(i, i + 200);
                const { data: skuData } = await supabase.from('skus').select('sku, title').in('sku', chunk);
                for (const s of (skuData || [])) {
                    if (s.title) skuNameMap.set(s.sku, s.title);
                }
            }
        }

        const inventoryItems = Array.from(invBySku.values()).map((snap: any) => ({
            sku: snap.sku, name: skuNameMap.get(snap.sku) || 'Unknown', image: '', platform: 'Amazon',
            unitsSold: 0, revenue: 0, stock: snap.available_quantity || 0,
            maxStock: Math.max(snap.available_quantity || 0, 50),
            status: snap.available_quantity === 0 ? 'out-of-stock' : snap.available_quantity < 10 ? 'low-stock' : 'in-stock',
            asin: '', fnSku: '', fulfillableQty: snap.available_quantity || 0,
            inboundQty: snap.inbound_quantity || 0, reservedQty: snap.reserved_quantity || 0,
        }));

        const totalSkus = inventoryItems.length;
        const outOfStockCount = inventoryItems.filter((i: any) => i.status === 'out-of-stock').length;
        const lowStockCount = inventoryItems.filter((i: any) => i.status === 'low-stock').length;
        const totalUnits = inventoryItems.reduce((sum: number, i: any) => sum + i.stock, 0);

        // 12. SKU-level metrics — revenue & units per SKU (current period)
        const skuRevenueMap = new Map<string, { revenue: number; units: number; returns: number }>();
        const currentOrderIds = currentOrders.map((o: any) => o.amazon_order_id);

        if (currentOrderIds.length > 0) {
            for (let i = 0; i < currentOrderIds.length; i += 200) {
                const chunk = currentOrderIds.slice(i, i + 200);
                const { data: items } = await supabase
                    .from('order_items')
                    .select('amazon_order_id, sku, title, item_price, shipping_price, quantity_ordered')
                    .in('amazon_order_id', chunk);
                for (const item of (items || [])) {
                    const sku = item.sku || 'UNKNOWN';
                    if (!skuRevenueMap.has(sku)) skuRevenueMap.set(sku, { revenue: 0, units: 0, returns: 0 });
                    const entry = skuRevenueMap.get(sku)!;
                    entry.revenue += (Number(item.item_price) || 0) + (Number(item.shipping_price) || 0);
                    entry.units += item.quantity_ordered || 1;
                    // Use order_items.title as fallback for product name
                    if (item.title && !skuNameMap.has(sku)) {
                        skuNameMap.set(sku, item.title);
                    }
                    // check if this order had refund
                    if (refundOrderIds.has(item.amazon_order_id)) entry.returns++;
                }
            }
        }

        // Fetch names from skus table for any SKUs still missing a name
        const unmappedSkus = Array.from(skuRevenueMap.keys()).filter(s => !skuNameMap.has(s) && s !== 'UNKNOWN');
        if (unmappedSkus.length > 0) {
            for (let i = 0; i < unmappedSkus.length; i += 200) {
                const chunk = unmappedSkus.slice(i, i + 200);
                const { data: skuData } = await supabase.from('skus').select('sku, title').in('sku', chunk);
                for (const s of (skuData || [])) {
                    if (s.title) skuNameMap.set(s.sku, s.title);
                }
            }
        }

        // Fetch ALL SKUs from skus table so every product appears in SKU performance
        const { data: allSkusData } = await supabase.from('skus').select('sku, title, asin, status');
        const allSkus = allSkusData || [];
        for (const s of allSkus) {
            if (s.title && !skuNameMap.has(s.sku)) skuNameMap.set(s.sku, s.title);
        }

        // Build full SKU performance — include ALL SKUs, not just those with orders
        const skuPerformance = allSkus
            .map((s: any) => {
                const data = skuRevenueMap.get(s.sku);
                return {
                    sku: s.sku,
                    name: skuNameMap.get(s.sku) || s.title || 'Unknown',
                    asin: s.asin || '',
                    status: s.status || 'Active',
                    revenue: data ? Math.round(data.revenue) : 0,
                    unitsSold: data ? data.units : 0,
                    returns: data ? data.returns : 0,
                    conversionRate: 0,      // needs session data — unavailable
                    reviewsCount: 0,        // needs catalog API
                    starRating: 0,          // needs catalog API
                    bsr: 0,                 // needs catalog API
                };
            })
            .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));

        // Top products by revenue
        const topProducts = skuPerformance.slice(0, 5);

        // Slow movers: SKUs with inventory but low/no sales in current period
        const slowMovers = inventoryItems
            .filter((inv: any) => {
                const skuData = skuRevenueMap.get(inv.sku);
                return inv.stock > 0 && (!skuData || skuData.units === 0);
            })
            .slice(0, 5)
            .map((inv: any) => ({ sku: inv.sku, name: inv.name, stock: inv.stock }));

        // Days of inventory left: totalUnits / (unitsSold / days) 
        const avgDailySales = days > 0 && current.unitsSold > 0 ? current.unitsSold / days : 0;
        const inventoryDaysLeft = avgDailySales > 0 ? Math.round(totalUnits / avgDailySales) : totalUnits > 0 ? 999 : 0;

        // Aged inventory: items with stock but 0 sales across entire period
        const agedInventoryCount = inventoryItems.filter((inv: any) => {
            const skuData = skuRevenueMap.get(inv.sku);
            return inv.stock > 0 && (!skuData || skuData.units === 0);
        }).length;

        // 13. Build full response — all 6 sections from table.md
        const response = {
            platforms: {
                amazon: { connected: true, store: 'Amazon India', marketplace: 'IN' },
                shopify: { connected: false },
                walmart: { connected: false },
            },
            period, granularity, kpis, revenueChartData,
            platformSales: [{ name: 'Amazon', value: Math.round(current.totalRevenue), color: '#6366f1' }],
            orderStatusData, recentOrders, inventoryItems,

            // ─── Section 1: Business Dashboard ───────────────────────────
            businessDashboard: {
                totalRevenue: current.totalRevenue,
                totalOrders: current.totalOrders,
                unitsSold: current.unitsSold,
                aov: current.avgOrderValue,
                topProducts,
                adsSpend: 0,
            },

            // ─── Section 2: Traffic & Conversion (zero — no session data) ──
            trafficConversion: {
                sessions: 0,
                pageViews: 0,
                conversionRate: 0,       // unit session percentage
                detailPageViews: 0,
                stateWiseOrders,
            },

            // ─── Section 3: Advertising Metrics (zero for now) ──────────
            advertisingMetrics: {
                impressions: 0,
                clicks: 0,
                spend: 0,
                salesFromAds: 0,
                acos: 0,
                roas: 0,
                ctr: 0,
                cpc: 0,
            },

            // ─── Section 4: Sales & Revenue ─────────────────────────────
            salesRevenue: {
                revenue: current.totalRevenue,
                orders: current.totalOrders,
                sessions: 0,              // needs session data
                conversionRate: 0,        // needs session data
                slowMovers,
                inventoryDaysLeft,
                topProducts,
            },

            // ─── Section 5: Inventory Metrics ───────────────────────────
            inventoryMetrics: {
                availableInventory: totalUnits,
                daysOfInventoryLeft: inventoryDaysLeft,
                inventorySellingType: {
                    fba: 0,
                    fbm: inventoryItems.length,  // all items are FBM (Fulfilled by Merchant)
                },
                agedInventory: agedInventoryCount,
                returns: current.returnedOrders,
            },

            // ─── Section 6: Product / SKU Level Metrics ─────────────────
            skuPerformance,

            stats: {
                totalRevenue: current.totalRevenue, totalOrders: current.totalOrders,
                avgOrderValue: current.avgOrderValue, returnRate: current.returnRate,
                cancelRate: current.cancelRate, grossProfit: current.grossProfit,
                unitsSold: current.unitsSold, totalSkus, outOfStockCount, lowStockCount, totalUnits,
            },
            lastUpdated: new Date().toISOString(),
            source: 'supabase',
            error: null,
        };

        setCache(cacheKey, response, TTL.DASHBOARD);
        return NextResponse.json(response);

    } catch (e: any) {
        console.error('Dashboard API error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
