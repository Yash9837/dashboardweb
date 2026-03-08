/**
 * API Route: Advertising Metrics (DB-backed)
 *
 * GET /api/command-center/ads?period=30d
 *
 * Reads from Supabase (ads_campaign_daily + ads_product_daily) instead of
 * live Amazon Ads API calls. Response time: <1s vs 60s.
 *
 * Also returns campaign list from Amazon Ads API for status/budget info.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { listCampaigns } from '@/lib/amazon-ads-client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

function computeDerived(impressions: number, clicks: number, cost: number, sales: number, purchases: number) {
    return {
        impressions,
        clicks,
        spend: Math.round(cost * 100) / 100,
        sales: Math.round(sales * 100) / 100,
        orders: purchases,
        acos: sales > 0 ? Math.round((cost / sales) * 10000) / 100 : 0,
        roas: cost > 0 ? Math.round((sales / cost) * 100) / 100 : 0,
        ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
        cpc: clicks > 0 ? Math.round((cost / clicks) * 100) / 100 : 0,
    };
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const period = searchParams.get('period') || '30d';

        // Parse period → date range
        const days = parseInt(period.replace('d', '')) || 30;
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

        const startStr = startDate.toISOString().slice(0, 10);
        const endStr = endDate.toISOString().slice(0, 10);

        // ── 1. Summary KPIs from campaign daily ──
        const { data: campaignRows, error: campErr } = await supabase
            .from('ads_campaign_daily')
            .select('*')
            .gte('date', startStr)
            .lte('date', endStr)
            .order('date', { ascending: true });

        if (campErr) throw new Error(`DB query failed: ${campErr.message}`);

        const allRows = campaignRows || [];

        // Totals for summary
        let totImp = 0, totClk = 0, totCost = 0, totSales = 0, totPurchases = 0;
        for (const r of allRows) {
            totImp += r.impressions || 0;
            totClk += r.clicks || 0;
            totCost += parseFloat(r.cost) || 0;
            totSales += parseFloat(r.sales14d) || 0;
            totPurchases += r.purchases14d || 0;
        }

        const summary = computeDerived(totImp, totClk, totCost, totSales, totPurchases);

        // ── 2. Daily trends ──
        const dailyMap = new Map<string, { impressions: number; clicks: number; cost: number; sales: number; purchases: number }>();
        for (const r of allRows) {
            const d = r.date;
            if (!dailyMap.has(d)) dailyMap.set(d, { impressions: 0, clicks: 0, cost: 0, sales: 0, purchases: 0 });
            const agg = dailyMap.get(d)!;
            agg.impressions += r.impressions || 0;
            agg.clicks += r.clicks || 0;
            agg.cost += parseFloat(r.cost) || 0;
            agg.sales += parseFloat(r.sales14d) || 0;
            agg.purchases += r.purchases14d || 0;
        }

        const daily = [...dailyMap.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, d]) => ({
                date,
                ...computeDerived(d.impressions, d.clicks, d.cost, d.sales, d.purchases),
            }));

        // ── 3. Campaign breakdown ──
        const campMap = new Map<string, { name: string; impressions: number; clicks: number; cost: number; sales: number; purchases: number }>();
        for (const r of allRows) {
            const id = r.campaign_id;
            if (!campMap.has(id)) campMap.set(id, { name: r.campaign_name || '', impressions: 0, clicks: 0, cost: 0, sales: 0, purchases: 0 });
            const agg = campMap.get(id)!;
            agg.impressions += r.impressions || 0;
            agg.clicks += r.clicks || 0;
            agg.cost += parseFloat(r.cost) || 0;
            agg.sales += parseFloat(r.sales14d) || 0;
            agg.purchases += r.purchases14d || 0;
        }

        // Fetch live campaign info for status/budget
        let liveCampaigns: any[] = [];
        try {
            liveCampaigns = await listCampaigns();
        } catch { /* non-critical */ }

        const liveCampMap = new Map(liveCampaigns.map((c: any) => [c.campaignId, c]));

        const campaigns = [...campMap.entries()]
            .map(([id, d]) => {
                const live = liveCampMap.get(id);
                return {
                    campaignId: id,
                    name: live?.name || d.name,
                    state: live?.state || 'UNKNOWN',
                    targetingType: live?.targetingType || '',
                    budget: live?.budget?.budget || 0,
                    budgetType: live?.budget?.budgetType || '',
                    ...computeDerived(d.impressions, d.clicks, d.cost, d.sales, d.purchases),
                };
            })
            .sort((a, b) => b.spend - a.spend);

        // ── 4. Per-SKU breakdown from products table ──
        const { data: productRows, error: prodErr } = await supabase
            .from('ads_product_daily')
            .select('*')
            .gte('date', startStr)
            .lte('date', endStr);

        if (prodErr) console.warn('[Ads API] Product query failed:', prodErr.message);

        const skuMap = new Map<string, { asin: string; impressions: number; clicks: number; cost: number; sales: number; purchases: number }>();
        for (const r of (productRows || [])) {
            const sku = r.advertised_sku || r.advertised_asin || 'UNKNOWN';
            if (!skuMap.has(sku)) skuMap.set(sku, { asin: r.advertised_asin || '', impressions: 0, clicks: 0, cost: 0, sales: 0, purchases: 0 });
            const agg = skuMap.get(sku)!;
            agg.impressions += r.impressions || 0;
            agg.clicks += r.clicks || 0;
            agg.cost += parseFloat(r.cost) || 0;
            agg.sales += parseFloat(r.sales14d) || 0;
            agg.purchases += r.purchases14d || 0;
        }

        const bySku = [...skuMap.entries()]
            .map(([sku, d]) => ({
                sku,
                asin: d.asin,
                ...computeDerived(d.impressions, d.clicks, d.cost, d.sales, d.purchases),
            }))
            .sort((a, b) => b.spend - a.spend);

        // ── 5. Data availability range ──
        const { data: minMax } = await supabase
            .from('ads_campaign_daily')
            .select('date')
            .order('date', { ascending: true })
            .limit(1);

        const dataStartDate = minMax?.[0]?.date || startStr;

        return NextResponse.json({
            success: true,
            period,
            dateRange: { start: startStr, end: endStr },
            dataAvailableFrom: dataStartDate,
            summary,
            daily,
            campaigns,
            by_sku: bySku,
            totalRows: { campaign: allRows.length, product: (productRows || []).length },
            timestamp: new Date().toISOString(),
        });
    } catch (e: any) {
        console.error('[Ads API] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
