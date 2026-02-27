import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const HIGH_VELOCITY_THRESHOLD = 28;
const LOW_VELOCITY_THRESHOLD = 10;

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const period = searchParams.get('period') || '30d';
        const customStart = searchParams.get('startDate');
        const customEnd = searchParams.get('endDate');

        let startStr: string;
        let endStr: string | null = null;

        if (customStart) {
            startStr = customStart;
            endStr = customEnd || new Date().toISOString().split('T')[0];
        } else {
            const days = { '7d': 7, '30d': 30, '90d': 90 }[period] || 30;
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            startStr = startDate.toISOString().split('T')[0];
        }

        // Read pre-aggregated SKU metrics
        let skuQuery = supabase
            .from('sku_daily_metrics')
            .select('*')
            .gte('date', startStr);
        if (endStr) skuQuery = skuQuery.lte('date', endStr);
        const { data: skuMetrics, error: skuErr } = await skuQuery;

        if (skuErr) throw skuErr;

        // Get SKU titles
        const { data: skuMaster } = await supabase.from('skus').select('sku, title, cost_per_unit');

        // Get inventory health
        const { data: healthData } = await supabase.from('inventory_health').select('*');

        // Aggregate per-SKU
        const skuMap = new Map<string, any>();
        for (const m of skuMetrics || []) {
            if (!skuMap.has(m.sku)) {
                skuMap.set(m.sku, {
                    sku: m.sku,
                    revenue_live: 0, revenue_locked: 0,
                    units_sold_live: 0, units_sold_locked: 0,
                    refund_amount: 0, refund_units: 0, ad_spend: 0,
                    net_contribution: 0,
                });
            }
            const s = skuMap.get(m.sku)!;
            s.revenue_live += Number(m.revenue_live) || 0;
            s.revenue_locked += Number(m.revenue_locked) || 0;
            s.units_sold_live += Number(m.units_sold_live) || 0;
            s.units_sold_locked += Number(m.units_sold_locked) || 0;
            s.refund_amount += Number(m.refund_amount) || 0;
            s.refund_units += Number(m.refund_units) || 0;
            s.ad_spend += Number(m.ad_spend) || 0;
            s.net_contribution += Number(m.net_contribution) || 0;
        }

        const titleMap = new Map((skuMaster || []).map((s: any) => [s.sku, s]));
        const healthMap = new Map((healthData || []).map((h: any) => [h.sku, h]));

        const skus = Array.from(skuMap.values()).map((s) => {
            const info = titleMap.get(s.sku) || {};
            const health = healthMap.get(s.sku);
            const margin = s.revenue_live > 0 ? ((s.net_contribution / s.revenue_live) * 100) : 0;
            const tacos = s.revenue_live > 0 ? ((s.ad_spend / s.revenue_live) * 100) : 0;
            const returnRate = s.units_sold_live > 0 ? ((s.refund_units / s.units_sold_live) * 100) : 0;
            const roas = s.ad_spend > 0 ? (s.revenue_live / s.ad_spend) : 0;
            const unitsSold = s.units_sold_live;

            // Priority matrix: Velocity vs Contribution Margin
            const highVelocity = unitsSold >= HIGH_VELOCITY_THRESHOLD;
            const lowVelocity = unitsSold <= LOW_VELOCITY_THRESHOLD;
            const highMargin = margin >= 20;
            let priority: string;
            if (highVelocity && highMargin) priority = 'scale';
            else if (highVelocity && !highMargin) priority = 'volume_risk';
            else if (!highVelocity && highMargin) priority = 'premium_niche';
            else priority = 'kill';

            return {
                sku: s.sku,
                title: (info as any).title || s.sku,
                revenue_live: Math.round(s.revenue_live),
                revenue_locked: Math.round(s.revenue_locked),
                units_sold_live: s.units_sold_live,
                units_sold_locked: s.units_sold_locked,
                refund_amount: Math.round(s.refund_amount),
                ad_spend: Math.round(s.ad_spend),
                net_contribution: Math.round(s.net_contribution),
                margin_percent: Math.round(margin * 10) / 10,
                tacos: Math.round(tacos * 10) / 10,
                roas: Math.round(roas * 10) / 10,
                return_rate: Math.round(returnRate * 10) / 10,
                priority,
                available_stock: health ? health.available_units : 0,
                days_inventory: health ? Number(health.days_inventory) : 0,
                inventory: health ? {
                    available_units: health.available_units,
                    days_inventory: Number(health.days_inventory),
                    risk_status: health.risk_status,
                } : null,
            };
        });

        // Sort by revenue descending
        skus.sort((a, b) => b.revenue_live - a.revenue_live);

        return NextResponse.json({ skus, period });
    } catch (err: any) {
        console.error('[SKU Performance]', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
