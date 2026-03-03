/**
 * External API: SKU Performance
 *
 * GET /api/external/sku-performance?period=30d&page=1&limit=50&sort=revenue&order=desc
 *
 * Returns: per-SKU revenue, units, returns, conversion rate,
 *          reviews, rating, BSR — with pagination
 */

import { fetchDashboardData } from '@/lib/dashboard-engine';
import { jsonResponse, errorResponse, optionsResponse, validateApiKey } from '@/lib/api-helpers';
import { getCached, setCache, TTL } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function OPTIONS() { return optionsResponse(); }

type SortField = 'revenue' | 'unitsSold' | 'returns' | 'sku' | 'name';

export async function GET(request: Request) {
    const authError = validateApiKey(request);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(request.url);
        const period = searchParams.get('period') || '30d';
        const page   = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
        const limit  = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
        const sort   = (searchParams.get('sort') || 'revenue') as SortField;
        const order  = searchParams.get('order') === 'asc' ? 'asc' : 'desc';

        const cacheKey = `ext_sku_${period}`;
        let allSkus = getCached<any[]>(cacheKey);

        if (!allSkus) {
            const d = await fetchDashboardData(period);
            allSkus = d.skuPerformance.map(s => ({
                sku:            s.sku,
                name:           s.name,
                asin:           s.asin,
                revenue:        s.revenue,
                unitsSold:      s.unitsSold,
                returns:        s.returns,
                conversionRate: s.conversionRate,
                reviews:        s.reviewsCount,
                rating:         s.starRating,
                bsr:            s.bsr,
            }));
            setCache(cacheKey, allSkus, TTL.DASHBOARD);
        }

        // Sort
        const sorted = [...allSkus].sort((a, b) => {
            const aVal = a[sort] ?? '';
            const bVal = b[sort] ?? '';
            if (typeof aVal === 'string') {
                return order === 'asc'
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            }
            return order === 'asc' ? aVal - bVal : bVal - aVal;
        });

        // Paginate
        const total  = sorted.length;
        const start  = (page - 1) * limit;
        const items  = sorted.slice(start, start + limit);

        const response = {
            success: true,
            period,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasNext:    start + limit < total,
                hasPrev:    page > 1,
            },
            sort: { field: sort, order },
            items,
            timestamp: new Date().toISOString(),
        };

        return jsonResponse(response);
    } catch (e: any) {
        return errorResponse(e.message);
    }
}
