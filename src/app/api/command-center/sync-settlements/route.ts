import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// ── Amazon SP-API helpers ────────────────────────────────────────────────────

let _accessToken: string | null = null;
let _tokenExpiry = 0;

async function getAccessToken(): Promise<string> {
    if (_accessToken && Date.now() < _tokenExpiry - 60000) return _accessToken;
    const res = await fetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: process.env.LWA_REFRESH_TOKEN!,
            client_id: process.env.LWA_CLIENT_ID!,
            client_secret: process.env.LWA_CLIENT_SECRET!,
        }).toString(),
    });
    if (!res.ok) throw new Error(`LWA token failed: ${res.status}`);
    const data = await res.json();
    _accessToken = data.access_token;
    _tokenExpiry = Date.now() + data.expires_in * 1000;
    return _accessToken!;
}

const endpoint = process.env.SP_API_ENDPOINT || 'https://sellingpartnerapi-eu.amazon.com';

async function spGet(path: string, params: Record<string, string> = {}): Promise<any> {
    const token = await getAccessToken();
    const url = new URL(`${endpoint}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    for (let attempt = 0; attempt <= 3; attempt++) {
        const res = await fetch(url.toString(), {
            headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
            cache: 'no-store',
        });
        if (res.ok) return res.json();
        if (res.status === 429 && attempt < 3) {
            await new Promise(r => setTimeout(r, Math.min(5000 * Math.pow(2, attempt), 30000)));
            continue;
        }
        throw new Error(`SP-API ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
}

function toAmount(v: any): number {
    if (v == null) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') { const n = parseFloat(v.replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; }
    if (typeof v === 'object') {
        if ('CurrencyAmount' in v) return toAmount(v.CurrencyAmount);
        if ('Amount' in v) return toAmount(v.Amount);
        if ('amount' in v) return toAmount(v.amount);
    }
    return 0;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── POST: Sync settlements from Amazon ───────────────────────────────────────

export async function POST() {
    const startTime = Date.now();
    const errors: string[] = [];
    let groupsSynced = 0;
    let itemsSynced = 0;

    try {
        console.log('[sync-settlements] Starting settlement sync from Amazon...');

        // ── 1. Fetch all financial event groups ──
        const allGroups: any[] = [];
        let nextToken: string | undefined;

        do {
            const params: Record<string, string> = {
                FinancialEventGroupStartedAfter: new Date(Date.now() - 548 * 86400000).toISOString(),
                MaxResultsPerPage: '100',
            };
            if (nextToken) params.NextToken = nextToken;

            const data = await spGet('/finances/v0/financialEventGroups', params);
            const groups = data.payload?.FinancialEventGroupList || [];
            allGroups.push(...groups);
            nextToken = data.payload?.NextToken;
            if (nextToken) await sleep(2100);
        } while (nextToken);

        console.log(`[sync-settlements] Fetched ${allGroups.length} event groups from Amazon`);

        // ── 2. Upsert financial_event_groups ──
        const groupRows = allGroups.map((g: any) => ({
            event_group_id: g.FinancialEventGroupId,
            account_id: 'default',
            processing_status: g.ProcessingStatus || 'Open',
            fund_transfer_status: g.FundTransferStatus || 'Initiated',
            fund_transfer_date: g.FundTransferDate || null,
            original_total: toAmount(g.OriginalTotal),
            beginning_balance: toAmount(g.BeginningBalance),
            trace_id: g.TraceId || null,
        }));

        for (let i = 0; i < groupRows.length; i += 200) {
            const chunk = groupRows.slice(i, i + 200);
            const { error } = await supabase.from('financial_event_groups').upsert(chunk, {
                onConflict: 'event_group_id',
                ignoreDuplicates: false,
            });
            if (error) errors.push(`Group upsert: ${error.message}`);
            else groupsSynced += chunk.length;
        }

        // ── 3. Upsert settlement_periods ──
        const settlementRows = allGroups.map((g: any) => ({
            settlement_id: g.FinancialEventGroupId,
            account_id: 'default',
            financial_event_group_start: g.FinancialEventGroupStart || null,
            financial_event_group_end: g.FinancialEventGroupEnd || null,
            fund_transfer_date: g.FundTransferDate || null,
            original_total: toAmount(g.OriginalTotal),
            converted_total: toAmount(g.ConvertedTotal || g.OriginalTotal),
            currency: g.OriginalTotal?.CurrencyCode || 'INR',
            processing_status: g.ProcessingStatus === 'Closed' ? 'Closed' : 'Open',
        }));

        for (let i = 0; i < settlementRows.length; i += 200) {
            const chunk = settlementRows.slice(i, i + 200);
            await supabase.from('settlement_periods').upsert(chunk, {
                onConflict: 'settlement_id',
                ignoreDuplicates: false,
            });
        }

        // ── 4. Fetch settlement items for Open groups + groups without items ──
        const { data: existingItems } = await supabase
            .from('settlement_items')
            .select('settlement_id');
        const groupsWithItems = new Set((existingItems || []).map((r: any) => r.settlement_id));

        const groupsToFetch = allGroups.filter((g: any) =>
            g.ProcessingStatus === 'Open' || !groupsWithItems.has(g.FinancialEventGroupId)
        );

        console.log(`[sync-settlements] Fetching items for ${groupsToFetch.length} groups`);

        for (const group of groupsToFetch) {
            const groupId = group.FinancialEventGroupId;
            try {
                const eventPages: any[] = [];
                let nt: string | undefined;
                do {
                    const params: Record<string, string> = {};
                    if (nt) params.NextToken = nt;
                    const data = await spGet(`/finances/v0/financialEventGroups/${groupId}/financialEvents`, params);
                    if (data.payload?.FinancialEvents) eventPages.push(data.payload.FinancialEvents);
                    nt = data.payload?.NextToken;
                    if (nt) await sleep(2100);
                } while (nt);

                const items: any[] = [];
                for (const page of eventPages) {
                    // Shipment events
                    for (const evt of (page.ShipmentEventList || [])) {
                        for (const item of (evt.ShipmentItemList || [])) {
                            for (const charge of (item.ItemChargeList || [])) {
                                const a = toAmount(charge.ChargeAmount);
                                if (!a) continue;
                                items.push({
                                    settlement_id: groupId,
                                    amazon_order_id: evt.AmazonOrderId || null,
                                    sku: item.SellerSKU || null,
                                    transaction_type: 'Order',
                                    amount_type: 'ItemPrice',
                                    amount_description: charge.ChargeType || 'Principal',
                                    amount: a,
                                    quantity: item.QuantityShipped || 1,
                                    posted_date: evt.PostedDate,
                                });
                            }
                            for (const fee of (item.ItemFeeList || [])) {
                                const a = toAmount(fee.FeeAmount);
                                if (!a) continue;
                                items.push({
                                    settlement_id: groupId,
                                    amazon_order_id: evt.AmazonOrderId || null,
                                    sku: item.SellerSKU || null,
                                    transaction_type: 'Order',
                                    amount_type: 'ItemFees',
                                    amount_description: fee.FeeType || 'Fee',
                                    amount: a,
                                    quantity: 0,
                                    posted_date: evt.PostedDate,
                                });
                            }
                        }
                    }
                    // Refund events
                    for (const evt of (page.RefundEventList || [])) {
                        for (const item of (evt.ShipmentItemAdjustmentList || evt.ShipmentItemList || [])) {
                            for (const charge of (item.ItemChargeAdjustmentList || item.ItemChargeList || [])) {
                                const a = toAmount(charge.ChargeAmount);
                                if (!a) continue;
                                items.push({
                                    settlement_id: groupId,
                                    amazon_order_id: evt.AmazonOrderId || null,
                                    sku: item.SellerSKU || null,
                                    transaction_type: 'Refund',
                                    amount_type: 'ItemPrice',
                                    amount_description: charge.ChargeType || 'Refund',
                                    amount: a,
                                    quantity: -(item.QuantityShipped || 1),
                                    posted_date: evt.PostedDate,
                                });
                            }
                        }
                    }
                    // Service fees
                    for (const evt of (page.ServiceFeeEventList || [])) {
                        for (const fee of (evt.FeeList || [])) {
                            const a = toAmount(fee.FeeAmount);
                            if (!a) continue;
                            items.push({
                                settlement_id: groupId,
                                amazon_order_id: evt.AmazonOrderId || null,
                                sku: evt.SellerSKU || null,
                                transaction_type: 'ServiceFee',
                                amount_type: 'Other',
                                amount_description: fee.FeeType || 'ServiceFee',
                                amount: a,
                                quantity: 0,
                                posted_date: null,
                            });
                        }
                    }
                    // Adjustments
                    for (const evt of (page.AdjustmentEventList || [])) {
                        for (const item of (evt.AdjustmentItemList || [])) {
                            const a = toAmount(item.TotalAmount);
                            if (!a) continue;
                            items.push({
                                settlement_id: groupId,
                                amazon_order_id: null,
                                sku: item.SellerSKU || null,
                                transaction_type: 'Adjustment',
                                amount_type: 'Other',
                                amount_description: evt.AdjustmentType || 'Adjustment',
                                amount: a,
                                quantity: item.Quantity || 0,
                                posted_date: evt.PostedDate,
                            });
                        }
                    }
                }

                // Delete old items for this group and re-insert
                if (items.length > 0) {
                    await supabase.from('settlement_items').delete().eq('settlement_id', groupId);
                    for (let i = 0; i < items.length; i += 200) {
                        const chunk = items.slice(i, i + 200);
                        const { error } = await supabase.from('settlement_items').insert(chunk);
                        if (error) errors.push(`Items insert ${groupId}: ${error.message}`);
                        else itemsSynced += chunk.length;
                    }
                }

                await sleep(1200);
            } catch (err: any) {
                errors.push(`Group ${groupId}: ${err.message?.slice(0, 100)}`);
            }
        }

        console.log(`[sync-settlements] Done: ${groupsSynced} groups, ${itemsSynced} items, ${errors.length} errors`);

        return NextResponse.json({
            success: true,
            groups_synced: groupsSynced,
            items_synced: itemsSynced,
            groups_total: allGroups.length,
            groups_fetched: groupsToFetch.length,
            duration_ms: Date.now() - startTime,
            errors: errors.length > 0 ? errors : undefined,
        });
    } catch (err: any) {
        console.error('[sync-settlements] Fatal:', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
