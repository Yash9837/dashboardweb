import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/command-center/closed-settlement
 *
 * Returns all shipment events where delivery_date + 30 days < Today.
 * These orders have permanently closed return windows — revenue is settled.
 *
 * Response:
 *   summary  – firm-wide aggregate totals
 *   monthly  – per-month breakdown for chart
 *   orders   – individual closed order rows
 */
export async function GET() {
    try {
        const today = new Date();
        // Cutoff: 30 days ago — any order delivered before this is CLOSED
        const cutoff = new Date(today);
        cutoff.setDate(cutoff.getDate() - 30);
        const cutoffStr = cutoff.toISOString().split('T')[0]; // YYYY-MM-DD

        // ── 1. Fetch shipment events where delivery_date <= cutoff ────────────
        const { data: shipments, error: shipErr } = await supabase
            .from('financial_events')
            .select('amazon_order_id, sku, amount, delivery_date, posted_date')
            .eq('event_type', 'shipment')
            .not('delivery_date', 'is', null)
            .lte('delivery_date', cutoffStr)
            .order('delivery_date', { ascending: false });

        if (shipErr) throw shipErr;

        // ── 2. Fetch all refund events ────────────────────────────────────────
        const { data: refunds } = await supabase
            .from('financial_events')
            .select('amazon_order_id, amount')
            .eq('event_type', 'refund');

        // ── 3. Fetch all fee events ───────────────────────────────────────────
        const { data: fees } = await supabase
            .from('financial_events')
            .select('amazon_order_id, amount')
            .eq('event_type', 'fee');

        // ── Build lookup maps by amazon_order_id ──────────────────────────────
        const refundMap = new Map<string, number>();
        for (const r of refunds || []) {
            if (!r.amazon_order_id) continue;
            const prev = refundMap.get(r.amazon_order_id) || 0;
            refundMap.set(r.amazon_order_id, prev + Math.abs(Number(r.amount) || 0));
        }

        const feeMap = new Map<string, number>();
        for (const f of fees || []) {
            if (!f.amazon_order_id) continue;
            const prev = feeMap.get(f.amazon_order_id) || 0;
            feeMap.set(f.amazon_order_id, prev + Math.abs(Number(f.amount) || 0));
        }

        // ── 4. Build per-order rows ───────────────────────────────────────────
        const orders: ClosedOrder[] = (shipments || []).map((s: any) => {
            const orderId = s.amazon_order_id || '—';
            const gross = Math.abs(Number(s.amount) || 0);
            const feeAmt = feeMap.get(orderId) || 0;
            const refundAmt = refundMap.get(orderId) || 0;
            const net = gross - feeAmt - refundAmt;

            // Settlement date = DeliveryDate + 30 days
            const delivDate = new Date(s.delivery_date);
            const settlDate = new Date(delivDate);
            settlDate.setDate(settlDate.getDate() + 30);

            return {
                order_id: orderId,
                sku: s.sku || '—',
                delivery_date: s.delivery_date.split('T')[0],
                settlement_date: settlDate.toISOString().split('T')[0],
                posted_date: s.posted_date ? s.posted_date.split('T')[0] : null,
                gross_amount: round2(gross),
                fees: round2(feeAmt),
                refund_amount: round2(refundAmt),
                net_settled: round2(net),
                status: 'CLOSED' as const,
            };
        });

        // ── 5. Aggregate firm-wide summary ───────────────────────────────────
        let totalRevenue = 0;
        let totalFees = 0;
        let totalRefunds = 0;

        for (const o of orders) {
            totalRevenue += o.gross_amount;
            totalFees += o.fees;
            totalRefunds += o.refund_amount;
        }

        const summary: ClosedSummary = {
            total_closed_revenue: round2(totalRevenue),
            total_closed_orders: orders.length,
            total_fees_on_closed: round2(totalFees),
            total_refunds_on_closed: round2(totalRefunds),
            net_settled_revenue: round2(totalRevenue - totalFees - totalRefunds),
            cutoff_date: cutoffStr,
        };

        // ── 6. Monthly breakdown for bar chart (by settlement_date month) ─────
        const monthMap = new Map<string, { revenue: number; orders: number; net: number }>();
        for (const o of orders) {
            const month = o.settlement_date.slice(0, 7); // YYYY-MM
            const existing = monthMap.get(month) || { revenue: 0, orders: 0, net: 0 };
            existing.revenue += o.gross_amount;
            existing.orders += 1;
            existing.net += o.net_settled;
            monthMap.set(month, existing);
        }

        const monthly = Array.from(monthMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, data]) => ({
                month: formatMonth(month),
                month_key: month,
                revenue: round2(data.revenue),
                orders: data.orders,
                net: round2(data.net),
            }));

        return NextResponse.json({ summary, monthly, orders });
    } catch (err: any) {
        console.error('[Closed Settlement API]', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClosedOrder {
    order_id: string;
    sku: string;
    delivery_date: string;
    settlement_date: string;
    posted_date: string | null;
    gross_amount: number;
    fees: number;
    refund_amount: number;
    net_settled: number;
    status: 'CLOSED';
}

interface ClosedSummary {
    total_closed_revenue: number;
    total_closed_orders: number;
    total_fees_on_closed: number;
    total_refunds_on_closed: number;
    net_settled_revenue: number;
    cutoff_date: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(v: number): number {
    return Math.round((Number(v) || 0) * 100) / 100;
}

function formatMonth(yyyymm: string): string {
    const [y, m] = yyyymm.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[parseInt(m, 10) - 1]} ${y}`;
}
