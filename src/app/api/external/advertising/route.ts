/**
 * External API: Advertising Metrics
 *
 * GET /api/external/advertising?period=30d
 *
 * Returns: impressions, clicks, spend, salesFromAds, acos, roas, ctr, cpc
 * Note: All zero — Amazon Advertising API not connected yet
 */

import { jsonResponse, errorResponse, optionsResponse, validateApiKey } from '@/lib/api-helpers';
import { parsePeriod } from '@/lib/dashboard-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function OPTIONS() { return optionsResponse(); }

export async function GET(request: Request) {
    const authError = validateApiKey(request);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(request.url);
        const period = searchParams.get('period') || '30d';
        const days = parsePeriod(period);

        const response = {
            success: true,
            period,
            days,
            note: 'Amazon Advertising API not connected. All metrics return 0.',
            metrics: {
                impressions:  { value: 0, description: 'Total ad impressions' },
                clicks:       { value: 0, description: 'Total ad clicks' },
                spend:        { value: 0, currency: 'INR', description: 'Total advertising spend' },
                salesFromAds: { value: 0, currency: 'INR', description: 'Revenue attributed to ads' },
                acos:         { value: 0, unit: '%', description: 'Advertising Cost of Sales (spend / salesFromAds × 100)' },
                roas:         { value: 0, description: 'Return on Ad Spend (salesFromAds / spend)' },
                ctr:          { value: 0, unit: '%', description: 'Click-Through Rate (clicks / impressions × 100)' },
                cpc:          { value: 0, currency: 'INR', description: 'Cost per Click (spend / clicks)' },
            },
            timestamp: new Date().toISOString(),
        };

        return jsonResponse(response);
    } catch (e: any) {
        return errorResponse(e.message);
    }
}
