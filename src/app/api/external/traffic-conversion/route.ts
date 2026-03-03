/**
 * External API: Traffic & Conversion
 *
 * GET /api/external/traffic-conversion?period=30d
 *
 * Returns: sessions, pageViews, conversionRate, detailPageViews, stateWiseOrders
 * Note: Sessions/PageViews require Amazon Brand Analytics (not yet connected) — returns 0 for now
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

        const cacheKey = `ext_traffic_${period}`;
        const cached = getCached<any>(cacheKey);
        if (cached) return jsonResponse(cached);

        const d = await fetchDashboardData(period);

        const response = {
            success: true,
            period: d.period,
            days: d.days,
            metrics: {
                sessions:        { value: 0, note: 'Requires Amazon Brand Analytics API' },
                pageViews:       { value: 0, note: 'Requires Amazon Brand Analytics API' },
                conversionRate:  { value: 0, unit: '%', note: 'Unit Session Percentage — requires Brand Analytics' },
                detailPageViews: { value: 0, note: 'Requires Amazon Brand Analytics API' },
            },
            stateWiseOrders: d.stateWiseOrders,
            totalStates: d.stateWiseOrders.length,
            timestamp: new Date().toISOString(),
        };

        setCache(cacheKey, response, TTL.DASHBOARD);
        return jsonResponse(response);
    } catch (e: any) {
        return errorResponse(e.message);
    }
}
