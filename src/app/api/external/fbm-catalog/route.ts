/**
 * External API: FBM Catalog — Inventory & SKU Details
 *
 * GET /api/external/fbm-catalog?page=1&limit=50&sort=stock&order=desc&status=all
 *
 * Returns: Combined SKU master data (category, brand, costs) with FBM inventory
 *          levels and computed health metrics (avg daily sales, days of inventory,
 *          risk status). Supports pagination, sorting, and status filtering.
 *
 * Data sources (3 parallel Supabase queries):
 *   • skus           → catalog details (asin, title, category, brand, costs)
 *   • inventory_snapshots → latest stock levels per SKU
 *   • inventory_health    → computed health (avg daily sales, days inventory, risk)
 */

import { supabase } from '@/lib/supabase';
import { jsonResponse, errorResponse, optionsResponse, validateApiKey } from '@/lib/api-helpers';
import { getCached, setCache, TTL } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function OPTIONS() { return optionsResponse(); }

type SortField = 'sku' | 'name' | 'stock' | 'daysInventory';
type StockStatus = 'in-stock' | 'low-stock' | 'out-of-stock';

function deriveStatus(qty: number): StockStatus {
    if (qty === 0) return 'out-of-stock';
    if (qty < 10) return 'low-stock';
    return 'in-stock';
}

export async function GET(request: Request) {
    const authError = validateApiKey(request);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(request.url);
        const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
        const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
        const sort = (searchParams.get('sort') || 'stock') as SortField;
        const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc';
        const status = searchParams.get('status') || 'all';

        /* ── Cache ────────────────────────────────────────────────── */
        const cacheKey = `ext_fbm_catalog`;
        let allItems = getCached<any[]>(cacheKey);

        if (!allItems) {
            /* ── 3 parallel Supabase queries ─────────────────────── */
            const [skusRes, inventoryRes, healthRes] = await Promise.all([
                supabase
                    .from('skus')
                    .select('sku, asin, title, category, brand, cost_per_unit, packaging_cost, shipping_cost_internal'),
                supabase
                    .from('inventory_snapshots')
                    .select('sku, available_quantity, inbound_quantity, reserved_quantity, snapshot_date')
                    .order('snapshot_date', { ascending: false })
                    .limit(500),
                supabase
                    .from('inventory_health')
                    .select('sku, available_units, avg_daily_sales_7d, days_inventory, risk_status'),
            ]);

            if (skusRes.error) throw new Error(`SKUs query failed: ${skusRes.error.message}`);

            const skus = skusRes.data || [];
            const inventoryRaw = inventoryRes.data || [];
            const healthRaw = healthRes.data || [];

            // Build maps for fast lookup
            const invBySku = new Map<string, any>();
            for (const snap of inventoryRaw) {
                if (!invBySku.has(snap.sku)) invBySku.set(snap.sku, snap); // latest snapshot
            }

            const healthBySku = new Map<string, any>();
            for (const h of healthRaw) {
                healthBySku.set(h.sku, h);
            }

            // Merge all three datasets per SKU
            allItems = skus.map((s: any) => {
                const inv = invBySku.get(s.sku);
                const health = healthBySku.get(s.sku);
                const stock = inv?.available_quantity ?? 0;
                const costPerUnit = Number(s.cost_per_unit) || 0;
                const packagingCost = Number(s.packaging_cost) || 0;
                const shippingCostInternal = Number(s.shipping_cost_internal) || 0;

                return {
                    sku: s.sku,
                    asin: s.asin || '',
                    name: s.title || 'Unknown',
                    category: s.category || '',
                    brand: s.brand || '',
                    stock,
                    inboundQty: inv?.inbound_quantity ?? 0,
                    reservedQty: inv?.reserved_quantity ?? 0,
                    status: deriveStatus(stock),
                    fulfillment: 'FBM',
                    costs: {
                        costPerUnit,
                        packagingCost,
                        shippingCostInternal,
                        totalCostPerUnit: costPerUnit + packagingCost + shippingCostInternal,
                    },
                    health: {
                        avgDailySales7d: Number(health?.avg_daily_sales_7d) || 0,
                        daysInventory: Number(health?.days_inventory) || 0,
                        riskStatus: health?.risk_status || (stock === 0 ? 'red' : stock < 10 ? 'yellow' : 'green'),
                    },
                };
            });

            setCache(cacheKey, allItems, TTL.INVENTORY);
        }

        /* ── Filter by status ────────────────────────────────────── */
        let filtered = allItems;
        if (status !== 'all') {
            filtered = allItems.filter((item: any) => item.status === status);
        }

        /* ── Sort ────────────────────────────────────────────────── */
        const sorted = [...filtered].sort((a: any, b: any) => {
            let aVal: any, bVal: any;
            switch (sort) {
                case 'sku': aVal = a.sku; bVal = b.sku; break;
                case 'name': aVal = a.name; bVal = b.name; break;
                case 'daysInventory': aVal = a.health.daysInventory; bVal = b.health.daysInventory; break;
                case 'stock':
                default: aVal = a.stock; bVal = b.stock; break;
            }
            if (typeof aVal === 'string') {
                return order === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }
            return order === 'asc' ? aVal - bVal : bVal - aVal;
        });

        /* ── Paginate ────────────────────────────────────────────── */
        const total = sorted.length;
        const start = (page - 1) * limit;
        const items = sorted.slice(start, start + limit);

        /* ── Summary stats (computed from ALL items, ignoring filters/pages) ── */
        const totalUnits = allItems.reduce((sum: number, i: any) => sum + i.stock, 0);
        const inStockCount = allItems.filter((i: any) => i.status === 'in-stock').length;
        const lowStockCount = allItems.filter((i: any) => i.status === 'low-stock').length;
        const outOfStockCount = allItems.filter((i: any) => i.status === 'out-of-stock').length;

        const response = {
            success: true,
            summary: {
                totalSkus: allItems.length,
                totalUnits,
                inStock: inStockCount,
                lowStock: lowStockCount,
                outOfStock: outOfStockCount,
                fulfillmentType: 'FBM',
            },
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasNext: start + limit < total,
                hasPrev: page > 1,
            },
            sort: { field: sort, order },
            filter: status !== 'all' ? { status } : undefined,
            items,
            timestamp: new Date().toISOString(),
        };

        return jsonResponse(response);
    } catch (e: any) {
        return errorResponse(e.message);
    }
}
