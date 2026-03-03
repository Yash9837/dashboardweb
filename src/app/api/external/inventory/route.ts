/**
 * External API: Inventory Metrics
 *
 * GET /api/external/inventory?period=30d
 *
 * Returns: available inventory, days left, selling type (FBM),
 *          aged inventory, returns, per-SKU stock details
 */

import { fetchDashboardData } from '@/lib/dashboard-engine';
import { jsonResponse, errorResponse, optionsResponse, validateApiKey } from '@/lib/api-helpers';
import { getCached, setCache, TTL } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function OPTIONS() { return optionsResponse(); }

export async function GET(request: Request) {
    const authError = validateApiKey(request);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(request.url);
        const period = searchParams.get('period') || '30d';

        const cacheKey = `ext_inventory_${period}`;
        const cached = getCached<any>(cacheKey);
        if (cached) return jsonResponse(cached);

        const d = await fetchDashboardData(period);

        const response = {
            success: true,
            period: d.period,
            days: d.days,
            granularity: d.granularity,
            summary: {
                availableInventory: d.totalUnits,
                inventoryDaysLeft:  d.inventoryDaysLeft === 999 ? null : d.inventoryDaysLeft,
                sellingType: {
                    fba: 0,
                    fbm: d.totalUnits,
                    note: 'Business is 100% FBM (Fulfilled by Merchant)',
                },
                agedInventory: d.agedInventoryCount,
                returnCount:   d.current.returnedOrders,
                totalSkus:     d.totalSkus,
                outOfStock:    d.outOfStockCount,
                lowStock:      d.lowStockCount,
            },
            items: d.inventoryItems.map(i => ({
                sku:            i.sku,
                name:           i.name,
                stock:          i.stock,
                fulfillableQty: i.fulfillableQty,
                inboundQty:     i.inboundQty,
                reservedQty:    i.reservedQty,
                status:         i.status,
            })),
            timestamp: new Date().toISOString(),
        };

        setCache(cacheKey, response, TTL.DASHBOARD);
        return jsonResponse(response);
    } catch (e: any) {
        return errorResponse(e.message);
    }
}
