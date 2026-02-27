import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const PERIOD_DAYS: Record<string, number> = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
};

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const period = searchParams.get('period') || '30d';
        const customStart = searchParams.get('startDate');
        const customEnd = searchParams.get('endDate');

        let startStr: string;
        let endStr: string | null = null;
        let days: number;

        if (customStart) {
            // Custom date range
            startStr = customStart; // YYYY-MM-DD
            endStr = customEnd || new Date().toISOString().split('T')[0];
            days = Math.max(1, Math.round((new Date(endStr).getTime() - new Date(startStr).getTime()) / (86400000)));
        } else {
            // Preset period
            days = PERIOD_DAYS[period] || 30;
            const now = new Date();
            const startDate = new Date(now);
            startDate.setDate(startDate.getDate() - days);
            startStr = startDate.toISOString().split('T')[0];
        }

        // Previous period for comparison (same length window before start)
        const prevStart = new Date(new Date(startStr).getTime() - days * 86400000);
        const prevStartStr = prevStart.toISOString().split('T')[0];

        // 1. Current period account daily metrics
        let currentQuery = supabase
            .from('account_daily_metrics')
            .select('*')
            .gte('date', startStr);
        if (endStr) currentQuery = currentQuery.lte('date', endStr);
        const { data: currentMetrics } = await currentQuery.order('date', { ascending: true });

        // 2. Previous period for comparison
        const { data: prevMetrics } = await supabase
            .from('account_daily_metrics')
            .select('*')
            .gte('date', prevStartStr)
            .lt('date', startStr);

        // 3. Revenue state breakdown from financial_events ledger
        let revQuery = supabase
            .from('financial_events')
            .select('event_type, amount, delivery_date, posted_date')
            .gte('posted_date', startStr)
            .in('event_type', ['shipment', 'refund']);
        if (endStr) revQuery = revQuery.lte('posted_date', endStr + 'T23:59:59');
        const { data: revenueStates } = await revQuery;

        // 4. SKU-level data for real COGS/Shipping waterfall + return units
        let skuQuery = supabase
            .from('sku_daily_metrics')
            .select('sku, revenue_live, units_sold_live, refund_units, refund_amount, ad_spend, net_contribution')
            .gte('date', startStr);
        if (endStr) skuQuery = skuQuery.lte('date', endStr);
        const { data: skuMetrics } = await skuQuery;

        const { data: prevSkuMetrics } = await supabase
            .from('sku_daily_metrics')
            .select('sku, units_sold_live, refund_units')
            .gte('date', prevStartStr)
            .lt('date', startStr);

        const { data: skuMaster } = await supabase
            .from('skus')
            .select('sku, cost_per_unit, packaging_cost, shipping_cost_internal');

        // 5. Inventory data for Inventory Value and Active SKUs KPIs
        const { data: inventoryHealth } = await supabase
            .from('inventory_health')
            .select('sku, available_units, days_inventory');

        // Aggregate current & previous periods
        const curr = aggregateMetrics(currentMetrics || []);
        const prev = aggregateMetrics(prevMetrics || []);

        // Aggregate total refund units from SKU metrics (unit-based return rate)
        let totalRefundUnits = 0;
        let totalUnitsSold = 0;
        let prevTotalRefundUnits = 0;
        let prevTotalUnitsSold = 0;

        for (const m of (skuMetrics || [])) {
            totalRefundUnits += Number(m.refund_units) || 0;
            totalUnitsSold += Number(m.units_sold_live) || 0;
        }
        for (const m of (prevSkuMetrics || [])) {
            prevTotalRefundUnits += Number(m.refund_units) || 0;
            prevTotalUnitsSold += Number(m.units_sold_live) || 0;
        }

        const returnRate = totalUnitsSold > 0 ? (totalRefundUnits / totalUnitsSold) * 100 : 0;
        const prevReturnRate = prevTotalUnitsSold > 0 ? (prevTotalRefundUnits / prevTotalUnitsSold) * 100 : 0;

        // Revenue state breakdown
        const breakdown = computeRevenueBreakdown(revenueStates || []);

        // Compute real COGS, Shipping, Packaging from skus table
        const costMap = new Map((skuMaster || []).map((s: any) => [s.sku, {
            cogs: Number(s.cost_per_unit) || 0,
            packaging: Number(s.packaging_cost) || 0,
            shipping: Number(s.shipping_cost_internal) || 0,
        }]));

        let totalCogs = 0;
        let totalShippingAndLogistics = 0;
        let totalReturnsCost = 0;
        for (const m of (skuMetrics || [])) {
            const costs = costMap.get(m.sku);
            const units = Number(m.units_sold_live) || 0;
            const refundUnits = Number(m.refund_units) || 0;
            if (costs) {
                totalCogs += costs.cogs * units;
                totalShippingAndLogistics += (costs.shipping + costs.packaging) * units;
                totalReturnsCost += costs.cogs * refundUnits;
            }
        }

        // Compute avg selling price per SKU (fallback when COGS not set)
        const avgPriceMap = new Map<string, number>();
        const skuRevMap = new Map<string, { rev: number; units: number }>();
        for (const m of (skuMetrics || [])) {
            const existing = skuRevMap.get(m.sku);
            const rev = Number(m.revenue_live) || 0;
            const units = Number(m.units_sold_live) || 0;
            if (existing) {
                existing.rev += rev;
                existing.units += units;
            } else {
                skuRevMap.set(m.sku, { rev, units });
            }
        }
        for (const [sku, data] of skuRevMap) {
            if (data.units > 0) {
                avgPriceMap.set(sku, data.rev / data.units);
            }
        }

        // Compute Inventory Value and Active SKUs
        let inventoryValue = 0;
        let activeSkus = 0;
        let atRiskSkus = 0;
        for (const h of (inventoryHealth || [])) {
            const available = Number(h.available_units) || 0;
            if (available > 0) {
                activeSkus++;
                const costs = costMap.get(h.sku);
                const unitCost = costs?.cogs || 0;
                // Use cost_per_unit if set, otherwise use avg selling price as proxy
                const valuePerUnit = unitCost > 0 ? unitCost : (avgPriceMap.get(h.sku) || 0);
                inventoryValue += available * valuePerUnit;
                if (Number(h.days_inventory) < 7) {
                    atRiskSkus++;
                }
            }
        }

        // Contribution % and TACOS
        const contributionPct = curr.total_revenue_live > 0
            ? (curr.net_contribution_live / curr.total_revenue_live) * 100 : 0;
        const prevContributionPct = prev.total_revenue_live > 0
            ? (prev.net_contribution_live / prev.total_revenue_live) * 100 : 0;
        const tacos = curr.total_revenue_live > 0
            ? (curr.total_ad_spend / curr.total_revenue_live) * 100 : 0;
        const prevTacos = prev.total_revenue_live > 0
            ? (prev.total_ad_spend / prev.total_revenue_live) * 100 : 0;

        // ── Financial Summary ──
        const financial_summary = {
            total_revenue_live: round2(curr.total_revenue_live),
            total_revenue_locked: round2(curr.total_revenue_locked),
            total_fees: round2(curr.total_fees),
            total_refund_amount: round2(curr.total_refund_amount),
            total_ad_spend: round2(curr.total_ad_spend),
            net_contribution_live: round2(curr.net_contribution_live),
            net_contribution_locked: round2(curr.net_contribution_locked),
            total_profit: round2(curr.net_contribution_live),
        };

        // ── Net Contribution Breakdown ──
        const net_contribution_breakdown = [
            { label: 'Gross Revenue', value: round2(curr.total_revenue_live), kind: 'positive' as const },
            { label: 'Amazon Fees', value: round2(-curr.total_fees), kind: 'negative' as const },
            { label: 'COGS', value: round2(-totalCogs), kind: 'negative' as const },
            { label: 'Shipping & Logistics', value: round2(-totalShippingAndLogistics), kind: 'negative' as const },
            { label: 'Returns Cost', value: round2(-totalReturnsCost), kind: 'negative' as const },
            { label: 'Refunds', value: round2(-curr.total_refund_amount), kind: 'negative' as const },
            { label: 'Ad Spend', value: round2(-curr.total_ad_spend), kind: 'negative' as const },
            { label: 'Net Contribution', value: round2(curr.net_contribution_live), kind: 'total' as const },
        ];

        const total_profit_breakdown = [
            { label: 'Net Contribution', value: round2(curr.net_contribution_live), kind: 'positive' as const },
            { label: 'Total Profit', value: round2(curr.net_contribution_live), kind: 'total' as const },
        ];

        // ── Waterfall (real data, not hardcoded percentages) ──
        const waterfall = [
            { name: 'Gross Revenue', value: round2(curr.total_revenue_live), type: 'revenue' as const },
            { name: 'Marketplace Fees', value: round2(-curr.total_fees), type: 'deduction' as const },
            { name: 'COGS', value: round2(-totalCogs), type: 'deduction' as const },
            { name: 'Shipping & Logistics', value: round2(-totalShippingAndLogistics), type: 'deduction' as const },
            { name: 'Returns Cost', value: round2(-totalReturnsCost), type: 'deduction' as const },
            { name: 'Ad Spend', value: round2(-curr.total_ad_spend), type: 'deduction' as const },
            { name: 'Net Contribution', value: round2(curr.net_contribution_live), type: 'net' as const },
        ];

        // ── KPIs (8 cards matching imp formulas spec) ──
        const kpis = [
            {
                label: 'Total Revenue',
                live_value: round2(curr.total_revenue_live),
                locked_value: round2(curr.total_revenue_locked),
                live_change: pctChange(curr.total_revenue_live, prev.total_revenue_live),
                locked_change: pctChange(curr.total_revenue_locked, prev.total_revenue_locked),
                prefix: '₹',
                format: 'currency',
            },
            {
                label: 'Net Contribution',
                live_value: round2(curr.net_contribution_live),
                locked_value: round2(curr.net_contribution_locked),
                live_change: pctChange(curr.net_contribution_live, prev.net_contribution_live),
                locked_change: pctChange(curr.net_contribution_locked, prev.net_contribution_locked),
                prefix: '₹',
                format: 'currency',
            },
            {
                label: 'Contribution %',
                live_value: round2(contributionPct),
                locked_value: curr.total_revenue_locked > 0
                    ? round2((curr.net_contribution_locked / curr.total_revenue_locked) * 100) : 0,
                live_change: round2(contributionPct - prevContributionPct),
                locked_change: round2(contributionPct - prevContributionPct),
                suffix: '%',
                format: 'percent',
            },
            {
                label: 'Total Ad Spend',
                live_value: round2(curr.total_ad_spend),
                locked_value: round2(curr.total_ad_spend),
                live_change: pctChange(curr.total_ad_spend, prev.total_ad_spend),
                locked_change: pctChange(curr.total_ad_spend, prev.total_ad_spend),
                prefix: '₹',
                format: 'currency',
            },
            {
                label: 'Blended TACOS',
                live_value: round2(tacos),
                locked_value: round2(tacos),
                live_change: round2(tacos - prevTacos),
                locked_change: round2(tacos - prevTacos),
                suffix: '%',
                format: 'percent',
            },
            {
                label: 'Units Sold',
                live_value: curr.total_units_live,
                locked_value: curr.total_units_locked,
                live_change: pctChange(curr.total_units_live, prev.total_units_live),
                locked_change: pctChange(curr.total_units_locked, prev.total_units_locked),
                format: 'number',
            },
            {
                label: 'Inventory Value',
                live_value: round2(inventoryValue),
                locked_value: round2(inventoryValue),
                live_change: 0, // No previous snapshot comparison yet
                locked_change: 0,
                prefix: '₹',
                format: 'currency',
            },
            {
                label: 'Active SKUs',
                live_value: activeSkus,
                locked_value: activeSkus,
                live_change: atRiskSkus, // Trend shows at-risk count, not %
                locked_change: atRiskSkus,
                format: 'number',
            },
        ];

        // Daily trends
        const daily_trends = (currentMetrics || []).map((m: any) => ({
            date: m.date,
            revenue_live: Number(m.total_revenue_live) || 0,
            revenue_locked: Number(m.total_revenue_locked) || 0,
            units_live: Number(m.total_units_live) || 0,
            units_locked: Number(m.total_units_locked) || 0,
        }));

        return NextResponse.json({
            kpis,
            revenue_breakdown: breakdown,
            waterfall,
            financial_summary,
            net_contribution_breakdown,
            total_profit_breakdown,
            daily_trends,
            period,
        });
    } catch (err: any) {
        console.error('[Command Center Metrics]', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// ── Helpers ──────────────────────────────────────────────

function aggregateMetrics(rows: any[]) {
    const result = {
        total_revenue_live: 0,
        total_revenue_locked: 0,
        net_contribution_live: 0,
        net_contribution_locked: 0,
        total_units_live: 0,
        total_units_locked: 0,
        total_refund_amount: 0,
        total_fees: 0,
        total_ad_spend: 0,
        total_profit: 0,
    };
    for (const r of rows) {
        result.total_revenue_live += Number(r.total_revenue_live) || 0;
        result.total_revenue_locked += Number(r.total_revenue_locked) || 0;
        result.net_contribution_live += Number(r.net_contribution_live) || 0;
        result.net_contribution_locked += Number(r.net_contribution_locked) || 0;
        result.total_units_live += Number(r.total_units_live) || 0;
        result.total_units_locked += Number(r.total_units_locked) || 0;
        result.total_refund_amount += Number(r.total_refund_amount) || 0;
        result.total_fees += Number(r.total_fees) || 0;
        result.total_ad_spend += Number(r.total_ad_spend) || 0;
        result.total_profit += Number(r.total_profit) || 0;
    }
    return result;
}

function computeRevenueBreakdown(events: any[]) {
    const now = new Date();
    const fifteenDaysAgo = new Date(now);
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

    const breakdown = { pending: 0, at_risk: 0, locked: 0, refunded: 0 };

    for (const e of events) {
        const amount = Math.abs(Number(e.amount) || 0);
        if (e.event_type === 'refund') {
            breakdown.refunded += amount;
            continue;
        }
        // shipment events
        if (!e.delivery_date) {
            breakdown.pending += amount;
        } else {
            const deliveryDate = new Date(e.delivery_date);
            if (deliveryDate > fifteenDaysAgo) {
                breakdown.at_risk += amount;
            } else {
                breakdown.locked += amount;
            }
        }
    }
    return breakdown;
}

function pctChange(curr: number, prev: number): number {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / Math.abs(prev)) * 100);
}

function round2(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
}
