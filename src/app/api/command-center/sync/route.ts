import { NextResponse } from 'next/server';
import {
    fetchAmazonOrders,
    fetchAmazonInventory,
    fetchAllListings,
    fetchFinancialEvents,
    fetchFinancialEventGroups,
    fetchFinancialEventsByGroup,
    checkAmazonConnection,
} from '@/lib/amazon-client';
import { supabase } from '@/lib/supabase';
import { detectClosedOrders } from '@/lib/order-lifecycle-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const RETURN_WINDOW_DAYS = 15;

function toAmount(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'string') {
        const parsed = parseFloat(value.replace(/[^0-9.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if ('CurrencyAmount' in obj) {
            return toAmount(obj.CurrencyAmount);
        }
        if ('Amount' in obj) {
            return toAmount(obj.Amount);
        }
        if ('amount' in obj) {
            return toAmount(obj.amount);
        }
    }

    const raw = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(raw) ? raw : 0;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Sync Metadata Helpers ───────────────────────────────────────────────────

async function getLastSyncedAt(): Promise<string | null> {
    const { data } = await supabase
        .from('sync_metadata')
        .select('value')
        .eq('key', 'last_synced_at')
        .single();
    return data?.value || null;
}

async function setLastSyncedAt(iso: string): Promise<void> {
    await supabase
        .from('sync_metadata')
        .upsert({ key: 'last_synced_at', value: iso, updated_at: new Date().toISOString() },
            { onConflict: 'key' });
}

async function hasLedgerData(): Promise<boolean> {
    const { count, error } = await supabase
        .from('financial_events')
        .select('id', { count: 'exact', head: true });

    if (error) {
        console.warn('[Sync] Could not read financial_events count; defaulting to full sync:', error.message);
        return false;
    }

    return (count || 0) > 0;
}

// ─── Step 1: Sync SKU catalog ────────────────────────────────────────────────

async function syncSkus(): Promise<Map<string, any>> {
    const listings = await fetchAllListings();
    const skuMap = new Map<string, any>();

    const rows = listings.map((item: any) => {
        const sku = item['seller-sku'] || item['Seller SKU'] || item.sku;
        const asin = item['asin1'] || item['ASIN1'] || item.asin || '';
        const title = item['item-name'] || item['Product Name'] || item.title || '';
        const price = parseFloat(item['price'] || item['Price'] || '0') || 0;

        skuMap.set(sku, { asin, title, price });

        return {
            sku,
            asin,
            title,
            category: item['product-type'] || item['Product Type'] || null,
            brand: item['brand'] || item['Brand'] || null,
            cost_per_unit: 0, // User can enter real COGS later
        };
    }).filter((r: any) => r.sku);

    if (rows.length > 0) {
        for (let i = 0; i < rows.length; i += 200) {
            const chunk = rows.slice(i, i + 200);
            const { error } = await supabase
                .from('skus')
                .upsert(chunk, { onConflict: 'sku', ignoreDuplicates: false });
            if (error) console.error('SKU upsert error:', error.message);
        }
    }

    return skuMap;
}

// ─── Step 2: Sync orders (metadata only — delivery dates, status) ────────────

async function syncOrders(daysBack: number): Promise<number> {
    const rawOrders = await fetchAmazonOrders(daysBack);
    if (rawOrders.length === 0) return 0;

    const orderRows = rawOrders.map((o: any) => ({
        amazon_order_id: o.AmazonOrderId,
        account_id: 'default',
        purchase_date: o.PurchaseDate,
        shipment_date: o.LastUpdateDate || null,
        delivery_date: o.EasyShipShipmentStatus === 'Delivered' ? o.LastUpdateDate : null,
        order_status: o.OrderStatus,
        currency: o.OrderTotal?.CurrencyCode || 'INR',
        fulfillment_channel: o.FulfillmentChannel || 'MFN',
        is_prime: o.IsPrime || false,
    }));

    for (let i = 0; i < orderRows.length; i += 200) {
        const chunk = orderRows.slice(i, i + 200);
        const { error } = await supabase
            .from('orders')
            .upsert(chunk, { onConflict: 'amazon_order_id', ignoreDuplicates: false });
        if (error) console.error('Orders upsert error:', error.message);
    }

    return rawOrders.length;
}

// ─── Step 3: Sync financial events (Finances API — SOURCE OF TRUTH) ──────────

async function syncFinancialEvents(postedAfter: string): Promise<number> {
    const eventPages = await fetchFinancialEvents({ postedAfter });
    const ledgerRows: any[] = [];

    // Get order delivery dates for revenue state classification
    const { data: ordersData } = await supabase
        .from('orders')
        .select('amazon_order_id, delivery_date, order_status');
    const orderMap = new Map((ordersData || []).map((o: any) => [o.amazon_order_id, o]));

    for (const page of eventPages) {
        // Process ShipmentEventList (revenue events)
        for (const evt of (page.ShipmentEventList || [])) {
            const orderId = evt.AmazonOrderId || '';
            const orderInfo = orderMap.get(orderId);
            const postedDate = evt.PostedDate;

            for (const item of (evt.ShipmentItemList || [])) {
                const sku = item.SellerSKU || 'UNKNOWN';
                const quantity = item.QuantityShipped || 1;

                // Item charges (revenue)
                for (const charge of (item.ItemChargeList || [])) {
                    const amount = toAmount(charge.ChargeAmount);
                    if (amount === 0) continue;

                    ledgerRows.push({
                        account_id: 'default',
                        amazon_order_id: orderId,
                        sku,
                        event_type: 'shipment',
                        amount,
                        quantity,
                        currency: charge.ChargeAmount?.CurrencyCode || 'INR',
                        posted_date: postedDate,
                        delivery_date: orderInfo?.delivery_date || null,
                        reference_id: `${orderId}-${sku}-${charge.ChargeType || 'Principal'}`,
                    });
                }

                // Item fees (Amazon commission, FBA fees, etc.)
                for (const fee of (item.ItemFeeList || [])) {
                    const amount = toAmount(fee.FeeAmount);
                    if (amount === 0) continue;

                    ledgerRows.push({
                        account_id: 'default',
                        amazon_order_id: orderId,
                        sku,
                        event_type: 'fee',
                        amount, // Already negative from Amazon
                        quantity: 0,
                        currency: fee.FeeAmount?.CurrencyCode || 'INR',
                        posted_date: postedDate,
                        fee_type: fee.FeeType || 'unknown',
                        reference_id: `${orderId}-${sku}-fee-${fee.FeeType || 'unknown'}`,
                    });
                }

                // Item promotions (coupons, Lightning Deals, etc.)
                // NOTE: Multiple promo rows can share the same PromotionId/Type but have different amounts
                // (e.g. −18.54 main discount + −0.56 GST-on-promo adjustment). We include the amount
                // in the reference_id so the dedup step treats them as distinct rows.
                for (let pi = 0; pi < (item.PromotionList || []).length; pi++) {
                    const promo = item.PromotionList[pi];
                    const amount = toAmount(promo.PromotionAmount);
                    if (amount === 0) continue;

                    ledgerRows.push({
                        account_id: 'default',
                        amazon_order_id: orderId,
                        sku,
                        event_type: 'promotion',
                        amount,
                        quantity: 0,
                        currency: promo.PromotionAmount?.CurrencyCode || 'INR',
                        posted_date: postedDate,
                        fee_type: promo.PromotionType || 'Promotion',
                        // Include amount AND index to uniquely identify each promo row
                        reference_id: `${orderId}-${sku}-promo-${promo.PromotionId || promo.PromotionType || 'unknown'}-${amount}-${pi}`,
                    });
                }

                // TDS / Tax withheld at source (ItemTaxWithheldList)
                for (const taxItem of (item.ItemTaxWithheldList || [])) {
                    for (const comp of (taxItem.TaxesWithheld || [])) {
                        const amount = toAmount(comp.ChargeAmount);
                        if (amount === 0) continue;

                        ledgerRows.push({
                            account_id: 'default',
                            amazon_order_id: orderId,
                            sku,
                            event_type: 'tax_withheld',
                            amount, // Negative from Amazon
                            quantity: 0,
                            currency: comp.ChargeAmount?.CurrencyCode || 'INR',
                            posted_date: postedDate,
                            fee_type: comp.ChargeType || taxItem.TaxCollectionModel || 'TDS',
                            reference_id: `${orderId}-${sku}-tds-${comp.ChargeType || 'TDS'}`,
                        });
                    }
                }
            }
        }

        // Process RefundEventList
        for (const evt of (page.RefundEventList || [])) {
            const orderId = evt.AmazonOrderId || '';
            const postedDate = evt.PostedDate;

            for (const item of (evt.ShipmentItemAdjustmentList || evt.ShipmentItemList || [])) {
                const sku = item.SellerSKU || 'UNKNOWN';
                const quantity = item.QuantityShipped || 1;

                // Refund charges (negative Principal, ShippingCharge, etc.)
                for (const charge of (item.ItemChargeAdjustmentList || item.ItemChargeList || [])) {
                    const amount = toAmount(charge.ChargeAmount);
                    if (amount === 0) continue;

                    ledgerRows.push({
                        account_id: 'default',
                        amazon_order_id: orderId,
                        sku,
                        event_type: 'refund',
                        amount, // Already negative from Amazon
                        quantity: -Math.abs(quantity),
                        currency: charge.ChargeAmount?.CurrencyCode || 'INR',
                        posted_date: postedDate,
                        reference_id: `${orderId}-${sku}-refund-${charge.ChargeType || 'Principal'}`,
                    });
                }

                // Refund fee adjustments (RefundCommission, FixedClosingFee reversal, etc.)
                for (const fee of (item.ItemFeeAdjustmentList || item.ItemFeeList || [])) {
                    const amount = toAmount(fee.FeeAmount);
                    if (amount === 0) continue;

                    ledgerRows.push({
                        account_id: 'default',
                        amazon_order_id: orderId,
                        sku,
                        event_type: 'refund_fee',
                        amount, // RefundCommission = negative, fee reversals = positive
                        quantity: 0,
                        currency: fee.FeeAmount?.CurrencyCode || 'INR',
                        posted_date: postedDate,
                        fee_type: fee.FeeType || 'RefundFee',
                        reference_id: `${orderId}-${sku}-refundfee-${fee.FeeType || 'unknown'}`,
                    });
                }

                // Refund promotion adjustments
                const refundPromoList = item.PromotionAdjustmentList || item.PromotionList || [];
                for (let pi = 0; pi < refundPromoList.length; pi++) {
                    const promo = refundPromoList[pi];
                    const amount = toAmount(promo.PromotionAmount);
                    if (amount === 0) continue;

                    ledgerRows.push({
                        account_id: 'default',
                        amazon_order_id: orderId,
                        sku,
                        event_type: 'promotion',
                        amount,
                        quantity: 0,
                        currency: promo.PromotionAmount?.CurrencyCode || 'INR',
                        posted_date: postedDate,
                        fee_type: promo.PromotionType || 'RefundPromotion',
                        reference_id: `${orderId}-${sku}-refundpromo-${promo.PromotionId || promo.PromotionType || 'unknown'}-${amount}-${pi}`,
                    });
                }

                // TDS / Tax withheld on refunds
                for (const taxItem of (item.ItemTaxWithheldList || [])) {
                    for (const comp of (taxItem.TaxesWithheld || [])) {
                        const amount = toAmount(comp.ChargeAmount);
                        if (amount === 0) continue;

                        ledgerRows.push({
                            account_id: 'default',
                            amazon_order_id: orderId,
                            sku,
                            event_type: 'tax_withheld',
                            amount,
                            quantity: 0,
                            currency: comp.ChargeAmount?.CurrencyCode || 'INR',
                            posted_date: postedDate,
                            fee_type: comp.ChargeType || taxItem.TaxCollectionModel || 'TDS_Refund',
                            reference_id: `${orderId}-${sku}-tds-refund-${comp.ChargeType || 'TDS'}`,
                        });
                    }
                }
            }
        }

        // Process ServiceFeeEventList
        for (const evt of (page.ServiceFeeEventList || [])) {
            for (const fee of (evt.FeeList || [])) {
                const amount = toAmount(fee.FeeAmount);
                if (amount === 0) continue;

                ledgerRows.push({
                    account_id: 'default',
                    amazon_order_id: evt.AmazonOrderId || null,
                    sku: evt.SellerSKU || null,
                    event_type: 'fee',
                    amount,
                    quantity: 0,
                    currency: fee.FeeAmount?.CurrencyCode || 'INR',
                    posted_date: evt.PostedDate || new Date().toISOString(),
                    fee_type: fee.FeeType || evt.FeeReason || 'service_fee',
                    reference_id: `svc-${evt.AmazonOrderId || 'none'}-${fee.FeeType || 'unknown'}`,
                });
            }
        }

        // Process AdjustmentEventList (PostageRefund, REVERSAL_REIMBURSEMENT, etc.)
        for (const evt of (page.AdjustmentEventList || [])) {
            const postedDate = evt.PostedDate || new Date().toISOString();
            const adjustmentType = evt.AdjustmentType || 'unknown';
            // Some adjustment events include an AmazonOrderId at the event level
            const adjustmentOrderId = evt.AmazonOrderId || null;

            for (const item of (evt.AdjustmentItemList || [])) {
                const amount = toAmount(item.TotalAmount);
                if (amount === 0) continue;

                ledgerRows.push({
                    account_id: 'default',
                    amazon_order_id: adjustmentOrderId,
                    sku: item.SellerSKU || null,
                    event_type: 'adjustment',
                    amount,
                    quantity: item.Quantity || 0,
                    currency: item.TotalAmount?.CurrencyCode || 'INR',
                    posted_date: postedDate,
                    fee_type: adjustmentType,
                    reference_id: `adj-${adjustmentType}-${item.SellerSKU || 'none'}-${item.AsinIsbnCode || 'none'}-${postedDate}`,
                });
            }

            // Some adjustments have no item list but still carry a TotalAmount at event level
            if ((!evt.AdjustmentItemList || evt.AdjustmentItemList.length === 0) && evt.AdjustmentAmount) {
                const amount = toAmount(evt.AdjustmentAmount);
                if (amount !== 0) {
                    ledgerRows.push({
                        account_id: 'default',
                        amazon_order_id: adjustmentOrderId,
                        sku: null,
                        event_type: 'adjustment',
                        amount,
                        quantity: 0,
                        currency: evt.AdjustmentAmount?.CurrencyCode || 'INR',
                        posted_date: postedDate,
                        fee_type: adjustmentType,
                        reference_id: `adj-${adjustmentType}-evt-${postedDate}`,
                    });
                }
            }
        }
    }

    // Deduplicate rows in-memory to avoid unique index conflicts on (reference_id, event_type)
    const dedupedRows: any[] = [];
    const seen = new Set<string>();
    for (const row of ledgerRows) {
        const dedupeKey = row.reference_id
            ? `${row.event_type}|${row.reference_id}`
            : `${row.event_type}|${row.amazon_order_id || 'none'}|${row.sku || 'none'}|${row.posted_date}|${row.amount}|${row.quantity}|${row.fee_type || 'none'}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        dedupedRows.push(row);
    }

    // ── Resolve missing SKUs for fee events (MFNPostageFee etc.) ──
    // Build order_id → SKU map from shipment events in this batch
    const orderSkuMap = new Map<string, string>();
    for (const row of dedupedRows) {
        if (row.event_type === 'shipment' && row.amazon_order_id && row.sku && row.sku !== 'UNKNOWN') {
            // If order has multiple SKUs, first one wins (most common case is single-item orders)
            if (!orderSkuMap.has(row.amazon_order_id)) {
                orderSkuMap.set(row.amazon_order_id, row.sku);
            }
        }
    }
    // Resolve null/UNKNOWN SKUs on fee events that have an order_id
    let resolvedCount = 0;
    for (const row of dedupedRows) {
        if (row.event_type === 'fee' && row.amazon_order_id && (!row.sku || row.sku === 'UNKNOWN')) {
            const resolvedSku = orderSkuMap.get(row.amazon_order_id);
            if (resolvedSku) {
                row.sku = resolvedSku;
                resolvedCount++;
            }
        }
    }
    if (resolvedCount > 0) {
        console.log(`[Sync] Resolved ${resolvedCount} fee events to their order's SKU`);
    }

    // Idempotent insert: delete existing by reference_id, then insert
    if (dedupedRows.length > 0) {
        const refIds = [...new Set(dedupedRows.map(r => r.reference_id).filter(Boolean))];
        for (let i = 0; i < refIds.length; i += 100) {
            const chunk = refIds.slice(i, i + 100);
            await supabase.from('financial_events').delete().in('reference_id', chunk);
        }
        for (let i = 0; i < dedupedRows.length; i += 200) {
            const chunk = dedupedRows.slice(i, i + 200);
            const { error } = await supabase.from('financial_events').insert(chunk);
            if (error) console.error('Financial events insert error:', error.message);
        }
    }

    return dedupedRows.length;
}

// ─── Step 4: Sync inventory ──────────────────────────────────────────────────

async function syncInventory(): Promise<number> {
    const inventory = await fetchAmazonInventory();
    if (inventory.length === 0) return 0;

    const today = new Date().toISOString().slice(0, 10);

    const snapshotRows = inventory.map((item: any) => ({
        account_id: 'default',
        sku: item.sellerSku,
        available_quantity: item.inventoryDetails?.fulfillableQuantity || 0,
        inbound_quantity:
            (item.inventoryDetails?.inboundWorkingQuantity || 0) +
            (item.inventoryDetails?.inboundShippedQuantity || 0) +
            (item.inventoryDetails?.inboundReceivingQuantity || 0),
        reserved_quantity: item.inventoryDetails?.totalReservedQuantity || 0,
        snapshot_date: today,
    })).filter((r: any) => r.sku);

    const { data: existingSkus } = await supabase.from('skus').select('sku');
    const skuSet = new Set((existingSkus || []).map((s: any) => s.sku));

    // Ensure inventory-only SKUs are present in master table before snapshot insert (FK-safe).
    const missingSkuMap = new Map<string, { sku: string; asin: string | null; title: string | null }>();
    for (const item of inventory) {
        const sku = item.sellerSku;
        if (!sku || skuSet.has(sku) || missingSkuMap.has(sku)) continue;
        missingSkuMap.set(sku, {
            sku,
            asin: item.asin || null,
            title: item.productName || sku,
        });
    }

    const missingSkus = [...missingSkuMap.values()];
    for (let i = 0; i < missingSkus.length; i += 200) {
        const chunk = missingSkus.slice(i, i + 200);
        const { error } = await supabase
            .from('skus')
            .upsert(chunk, { onConflict: 'sku', ignoreDuplicates: false });
        if (error) console.error('Missing SKU upsert error:', error.message);
    }

    for (let i = 0; i < snapshotRows.length; i += 200) {
        const chunk = snapshotRows.slice(i, i + 200);
        const { error } = await supabase
            .from('inventory_snapshots')
            .upsert(chunk, { onConflict: 'sku,snapshot_date', ignoreDuplicates: false });
        if (error) console.error('Inventory snapshot upsert error:', error.message);
    }

    return snapshotRows.length;
}

// ─── Step 5: Sync Financial Event Groups (Settlements) ─────────────────────

async function syncSettlements(postedAfter: string): Promise<{ groups: number; items: number; linked: number }> {
    const eventGroups = await fetchFinancialEventGroups({
        financialEventGroupStartedAfter: postedAfter,
    });

    if (eventGroups.length === 0) {
        return { groups: 0, items: 0, linked: 0 };
    }

    // ── Upsert financial_event_groups ──
    const groupRows = eventGroups.map((g: any) => ({
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
        const { error } = await supabase
            .from('financial_event_groups')
            .upsert(chunk, { onConflict: 'event_group_id', ignoreDuplicates: false });
        if (error) console.error('Event groups upsert error:', error.message);
    }

    // ── Upsert settlement_periods (one per group) ──
    const settlementRows = eventGroups.map((g: any) => ({
        settlement_id: g.FinancialEventGroupId,
        account_id: 'default',
        financial_event_group_start: g.FinancialEventGroupStart || null,
        financial_event_group_end: g.FinancialEventGroupEnd || null,
        fund_transfer_date: g.FundTransferDate || null,
        original_total: toAmount(g.OriginalTotal),
        converted_total: toAmount(g.ConvertedTotal || g.OriginalTotal),
        currency: g.OriginalTotal?.CurrencyCode || g.ConvertedTotal?.CurrencyCode || 'INR',
        processing_status: g.ProcessingStatus === 'Closed' ? 'Closed' : 'Open',
    }));

    for (let i = 0; i < settlementRows.length; i += 200) {
        const chunk = settlementRows.slice(i, i + 200);
        const { error } = await supabase
            .from('settlement_periods')
            .upsert(chunk, { onConflict: 'settlement_id', ignoreDuplicates: false });
        if (error) console.error('Settlement periods upsert error:', error.message);
    }

    // ── Fetch per-group events and build settlement_items ──
    let totalItems = 0;
    let totalLinked = 0;

    // Only fetch detailed events for groups we haven't fully processed yet
    // (Open groups or recently closed ones)
    const groupsToDetail = eventGroups.filter((g: any) =>
        g.ProcessingStatus === 'Open' ||
        (g.ProcessingStatus === 'Closed' && g.FundTransferDate &&
            new Date(g.FundTransferDate).getTime() > Date.now() - 60 * 24 * 60 * 60 * 1000)
    );

    for (const group of groupsToDetail) {
        const groupId = group.FinancialEventGroupId;
        try {
            const eventPages = await fetchFinancialEventsByGroup(groupId);
            const itemRows: any[] = [];

            for (const page of eventPages) {
                // Process shipment events → Order items
                for (const evt of (page.ShipmentEventList || [])) {
                    for (const item of (evt.ShipmentItemList || [])) {
                        for (const charge of (item.ItemChargeList || [])) {
                            const amount = toAmount(charge.ChargeAmount);
                            if (amount === 0) continue;
                            itemRows.push({
                                settlement_id: groupId,
                                amazon_order_id: evt.AmazonOrderId || null,
                                sku: item.SellerSKU || null,
                                transaction_type: 'Order',
                                amount_type: 'ItemPrice',
                                amount_description: charge.ChargeType || 'Principal',
                                amount,
                                quantity: item.QuantityShipped || 1,
                                posted_date: evt.PostedDate,
                            });
                        }
                        for (const fee of (item.ItemFeeList || [])) {
                            const amount = toAmount(fee.FeeAmount);
                            if (amount === 0) continue;
                            itemRows.push({
                                settlement_id: groupId,
                                amazon_order_id: evt.AmazonOrderId || null,
                                sku: item.SellerSKU || null,
                                transaction_type: 'Order',
                                amount_type: 'ItemFees',
                                amount_description: fee.FeeType || 'Fee',
                                amount,
                                quantity: 0,
                                posted_date: evt.PostedDate,
                            });
                        }
                        // Promotions (include index so multiple promos with same type are all captured)
                        for (let pi = 0; pi < (item.PromotionList || []).length; pi++) {
                            const promo = item.PromotionList[pi];
                            const amount = toAmount(promo.PromotionAmount);
                            if (amount === 0) continue;
                            itemRows.push({
                                settlement_id: groupId,
                                amazon_order_id: evt.AmazonOrderId || null,
                                sku: item.SellerSKU || null,
                                transaction_type: 'Order',
                                amount_type: 'Promotion',
                                amount_description: promo.PromotionType || 'Promotion',
                                amount,
                                quantity: 0,
                                posted_date: evt.PostedDate,
                            });
                        }
                        // TDS / Tax withheld
                        for (const taxItem of (item.ItemTaxWithheldList || [])) {
                            for (const comp of (taxItem.TaxesWithheld || [])) {
                                const amount = toAmount(comp.ChargeAmount);
                                if (amount === 0) continue;
                                itemRows.push({
                                    settlement_id: groupId,
                                    amazon_order_id: evt.AmazonOrderId || null,
                                    sku: item.SellerSKU || null,
                                    transaction_type: 'Order',
                                    amount_type: 'TaxWithheld',
                                    amount_description: comp.ChargeType || 'TDS',
                                    amount,
                                    quantity: 0,
                                    posted_date: evt.PostedDate,
                                });
                            }
                        }
                    }
                }

                // Process refund events
                for (const evt of (page.RefundEventList || [])) {
                    for (const item of (evt.ShipmentItemAdjustmentList || evt.ShipmentItemList || [])) {
                        // Refund charges
                        for (const charge of (item.ItemChargeAdjustmentList || item.ItemChargeList || [])) {
                            const amount = toAmount(charge.ChargeAmount);
                            if (amount === 0) continue;
                            itemRows.push({
                                settlement_id: groupId,
                                amazon_order_id: evt.AmazonOrderId || null,
                                sku: item.SellerSKU || null,
                                transaction_type: 'Refund',
                                amount_type: 'ItemPrice',
                                amount_description: charge.ChargeType || 'RefundPrincipal',
                                amount,
                                quantity: -(item.QuantityShipped || 1),
                                posted_date: evt.PostedDate,
                            });
                        }
                        // Refund fee adjustments (RefundCommission, fee reversals)
                        for (const fee of (item.ItemFeeAdjustmentList || item.ItemFeeList || [])) {
                            const amount = toAmount(fee.FeeAmount);
                            if (amount === 0) continue;
                            itemRows.push({
                                settlement_id: groupId,
                                amazon_order_id: evt.AmazonOrderId || null,
                                sku: item.SellerSKU || null,
                                transaction_type: 'Refund',
                                amount_type: 'ItemFees',
                                amount_description: fee.FeeType || 'RefundFee',
                                amount,
                                quantity: 0,
                                posted_date: evt.PostedDate,
                            });
                        }
                        // Refund promotion adjustments (include index for uniqueness)
                        const settlRefundPromos = item.PromotionAdjustmentList || item.PromotionList || [];
                        for (let pi = 0; pi < settlRefundPromos.length; pi++) {
                            const promo = settlRefundPromos[pi];
                            const amount = toAmount(promo.PromotionAmount);
                            if (amount === 0) continue;
                            itemRows.push({
                                settlement_id: groupId,
                                amazon_order_id: evt.AmazonOrderId || null,
                                sku: item.SellerSKU || null,
                                transaction_type: 'Refund',
                                amount_type: 'Promotion',
                                amount_description: promo.PromotionType || 'RefundPromotion',
                                amount,
                                quantity: 0,
                                posted_date: evt.PostedDate,
                            });
                        }
                        // TDS / Tax withheld on refunds
                        for (const taxItem of (item.ItemTaxWithheldList || [])) {
                            for (const comp of (taxItem.TaxesWithheld || [])) {
                                const amount = toAmount(comp.ChargeAmount);
                                if (amount === 0) continue;
                                itemRows.push({
                                    settlement_id: groupId,
                                    amazon_order_id: evt.AmazonOrderId || null,
                                    sku: item.SellerSKU || null,
                                    transaction_type: 'Refund',
                                    amount_type: 'TaxWithheld',
                                    amount_description: comp.ChargeType || 'TDS_Refund',
                                    amount,
                                    quantity: 0,
                                    posted_date: evt.PostedDate,
                                });
                            }
                        }
                    }
                }

                // Process service fee events
                for (const evt of (page.ServiceFeeEventList || [])) {
                    for (const fee of (evt.FeeList || [])) {
                        const amount = toAmount(fee.FeeAmount);
                        if (amount === 0) continue;
                        itemRows.push({
                            settlement_id: groupId,
                            amazon_order_id: evt.AmazonOrderId || null,
                            sku: evt.SellerSKU || null,
                            transaction_type: 'ServiceFee',
                            amount_type: 'Other',
                            amount_description: fee.FeeType || evt.FeeReason || 'ServiceFee',
                            amount,
                            quantity: 0,
                            posted_date: null,
                        });
                    }
                }

                // Process adjustment events
                for (const evt of (page.AdjustmentEventList || [])) {
                    for (const item of (evt.AdjustmentItemList || [])) {
                        const amount = toAmount(item.TotalAmount);
                        if (amount === 0) continue;
                        itemRows.push({
                            settlement_id: groupId,
                            amazon_order_id: null,
                            sku: item.SellerSKU || null,
                            transaction_type: 'Adjustment',
                            amount_type: 'Other',
                            amount_description: evt.AdjustmentType || 'Adjustment',
                            amount,
                            quantity: item.Quantity || 0,
                            posted_date: evt.PostedDate,
                        });
                    }
                }
            }

            // Delete existing items for this group, then insert fresh
            if (itemRows.length > 0) {
                await supabase.from('settlement_items').delete().eq('settlement_id', groupId);
                for (let i = 0; i < itemRows.length; i += 200) {
                    const chunk = itemRows.slice(i, i + 200);
                    const { error } = await supabase.from('settlement_items').insert(chunk);
                    if (error) console.error(`Settlement items insert error (${groupId}):`, error.message);
                }
                totalItems += itemRows.length;
            }

            // Link financial_events to this event group
            // Match by posted_date within the group's time window
            if (group.FinancialEventGroupStart && group.FinancialEventGroupEnd) {
                const { data: linked, error: linkErr } = await supabase
                    .from('financial_events')
                    .update({ event_group_id: groupId })
                    .gte('posted_date', group.FinancialEventGroupStart)
                    .lte('posted_date', group.FinancialEventGroupEnd)
                    .is('event_group_id', null)
                    .select('id');
                if (!linkErr && linked) {
                    totalLinked += linked.length;
                }
            }

            // Small delay between groups to respect rate limits
            await sleep(1000);
        } catch (err: any) {
            console.error(`[Sync] Failed to fetch events for group ${groupId}:`, err.message);
        }
    }

    return { groups: eventGroups.length, items: totalItems, linked: totalLinked };
}

// ─── Step 6: Compute aggregations ────────────────────────────────────────────

async function computeAggregations(): Promise<void> {
    const now = new Date();
    const lockCutoff = new Date(now.getTime() - RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const { data: events, error: fetchError } = await supabase
        .from('financial_events')
        .select('*')
        .order('posted_date', { ascending: true });

    if (fetchError || !events) {
        console.error('Failed to fetch events for aggregation:', fetchError?.message);
        return;
    }

    const { data: skuData } = await supabase.from('skus').select('sku, cost_per_unit');
    const costMap = new Map((skuData || []).map((s: any) => [s.sku, s.cost_per_unit || 0]));

    // Build daily SKU-level aggregations
    const skuDailyMap = new Map<string, any>();
    const refundedOrders = new Set<string>();

    for (const evt of events) {
        if (evt.event_type === 'refund') {
            refundedOrders.add(`${evt.amazon_order_id}-${evt.sku}`);
        }
    }

    for (const evt of events) {
        const dateKey = new Date(evt.posted_date).toISOString().slice(0, 10);
        const sku = evt.sku || 'UNKNOWN';
        const mapKey = `${sku}|${dateKey}`;

        if (!skuDailyMap.has(mapKey)) {
            skuDailyMap.set(mapKey, {
                date: dateKey,
                sku,
                revenue_live: 0,
                revenue_locked: 0,
                units_sold_live: 0,
                units_sold_locked: 0,
                refund_amount: 0,
                refund_units: 0,
                ad_spend: 0,
                fee_amount: 0,
            });
        }

        const agg = skuDailyMap.get(mapKey)!;

        if (evt.event_type === 'shipment') {
            const orderKey = `${evt.amazon_order_id}-${evt.sku}`;
            const isRefunded = refundedOrders.has(orderKey);
            const deliveryDate = evt.delivery_date ? new Date(evt.delivery_date) : null;
            const isLocked = deliveryDate && deliveryDate < lockCutoff && !isRefunded;

            agg.revenue_live += evt.amount;
            agg.units_sold_live += evt.quantity;

            if (isLocked) {
                agg.revenue_locked += evt.amount;
                agg.units_sold_locked += evt.quantity;
            }
        } else if (evt.event_type === 'refund') {
            agg.refund_amount += Math.abs(evt.amount);
            agg.refund_units += Math.abs(evt.quantity);
        } else if (evt.event_type === 'fee' || evt.event_type === 'refund_fee') {
            agg.fee_amount += Math.abs(evt.amount);
        } else if (evt.event_type === 'tax_withheld') {
            agg.fee_amount += Math.abs(evt.amount); // TDS treated as deduction
        } else if (evt.event_type === 'promotion') {
            // Promotions are negative amounts (discounts), reduce revenue
            agg.revenue_live += evt.amount;
        } else if (evt.event_type === 'adjustment') {
            // Positive adjustments (PostageRefund) reduce refund impact
            if (evt.amount > 0) {
                agg.refund_amount = Math.max(0, agg.refund_amount - evt.amount);
            } else {
                agg.refund_amount += Math.abs(evt.amount);
            }
        } else if (evt.event_type === 'ad_spend') {
            agg.ad_spend += Math.abs(evt.amount);
        }
    }

    const skuDailyAggregates = [...skuDailyMap.values()].map(agg => {
        const cost = costMap.get(agg.sku) || 0;
        const totalCost = cost * agg.units_sold_live;
        const netContribution = agg.revenue_live - agg.fee_amount - totalCost - agg.ad_spend - agg.refund_amount;
        const margin = agg.revenue_live > 0 ? (netContribution / agg.revenue_live) * 100 : 0;
        const tacos = agg.revenue_live > 0 ? (agg.ad_spend / agg.revenue_live) * 100 : 0;
        const returnRate = agg.units_sold_live > 0 ? (agg.refund_units / agg.units_sold_live) * 100 : 0;

        return {
            date: agg.date,
            sku: agg.sku,
            revenue_live: Math.round(agg.revenue_live * 100) / 100,
            revenue_locked: Math.round(agg.revenue_locked * 100) / 100,
            units_sold_live: agg.units_sold_live,
            units_sold_locked: agg.units_sold_locked,
            refund_amount: Math.round(agg.refund_amount * 100) / 100,
            refund_units: agg.refund_units,
            ad_spend: Math.round(agg.ad_spend * 100) / 100,
            fee_amount: Math.round(agg.fee_amount * 100) / 100,
            net_contribution: Math.round(netContribution * 100) / 100,
            margin_percent: Math.round(margin * 100) / 100,
            tacos: Math.round(tacos * 100) / 100,
            return_rate: Math.round(returnRate * 100) / 100,
        };
    });

    // sku_daily_metrics table does not have fee_amount; keep it only for account-level rollups.
    const skuDailyRows = skuDailyAggregates.map(({ fee_amount, ...row }) => row);

    await supabase.from('sku_daily_metrics').delete().neq('sku', '__impossible__');
    for (let i = 0; i < skuDailyRows.length; i += 200) {
        const chunk = skuDailyRows.slice(i, i + 200);
        const { error } = await supabase.from('sku_daily_metrics').insert(chunk);
        if (error) console.error('SKU daily metrics insert error:', error.message);
    }

    // Build account-level daily aggregations
    const accountDailyMap = new Map<string, any>();
    for (const row of skuDailyAggregates) {
        if (!accountDailyMap.has(row.date)) {
            accountDailyMap.set(row.date, {
                date: row.date,
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
                total_refund_units: 0,
            });
        }
        const acc = accountDailyMap.get(row.date)!;
        acc.total_revenue_live += row.revenue_live;
        acc.total_revenue_locked += row.revenue_locked;
        acc.total_units_live += row.units_sold_live;
        acc.total_units_locked += row.units_sold_locked;
        acc.total_refund_amount += row.refund_amount;
        acc.total_refund_units += row.refund_units;
        acc.total_fees += row.fee_amount;
        acc.total_ad_spend += row.ad_spend;
        acc.net_contribution_live += row.net_contribution;
        acc.net_contribution_locked += row.revenue_locked > 0 && row.revenue_live > 0
            ? row.net_contribution * (row.revenue_locked / row.revenue_live)
            : 0;
    }

    const accountDailyRows = [...accountDailyMap.values()].map(acc => {
        // Compute return_rate from refund_units before stripping the field
        const return_rate = acc.total_units_live > 0
            ? Math.round((acc.total_refund_units / acc.total_units_live) * 10000) / 100
            : 0;

        return {
            date: acc.date,
            total_revenue_live: Math.round(acc.total_revenue_live * 100) / 100,
            total_revenue_locked: Math.round(acc.total_revenue_locked * 100) / 100,
            net_contribution_live: Math.round(acc.net_contribution_live * 100) / 100,
            net_contribution_locked: Math.round(acc.net_contribution_locked * 100) / 100,
            total_units_live: acc.total_units_live,
            total_units_locked: acc.total_units_locked,
            total_refund_amount: Math.round(acc.total_refund_amount * 100) / 100,
            total_fees: Math.round(acc.total_fees * 100) / 100,
            total_ad_spend: Math.round(acc.total_ad_spend * 100) / 100,
            acos: acc.total_revenue_live > 0 ? Math.round((acc.total_ad_spend / acc.total_revenue_live) * 10000) / 100 : 0,
            total_profit: Math.round(acc.net_contribution_live * 100) / 100,
            return_rate,
            // NOTE: total_refund_units is NOT included — column doesn't exist in schema
        };
    });

    await supabase.from('account_daily_metrics').delete().neq('date', '1900-01-01');
    for (let i = 0; i < accountDailyRows.length; i += 200) {
        const chunk = accountDailyRows.slice(i, i + 200);
        const { error } = await supabase.from('account_daily_metrics').insert(chunk);
        if (error) console.error('Account daily metrics insert error:', error.message);
    }
}

// ─── Step 7: Compute inventory health + alerts ───────────────────────────────

async function computeInventoryHealth(): Promise<void> {
    const { data: snapshots } = await supabase
        .from('inventory_snapshots')
        .select('sku, available_quantity')
        .order('snapshot_date', { ascending: false });

    // Also fetch all SKUs from master to determine fulfillment type
    const { data: skuMaster } = await supabase
        .from('skus')
        .select('sku, cost_per_unit');
    const costMap = new Map((skuMaster || []).map((s: any) => [s.sku, Number(s.cost_per_unit) || 0]));

    // Get all active orders to determine which SKUs are FBM (have recent sales but no FBA inventory)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: allSalesData } = await supabase
        .from('sku_daily_metrics')
        .select('sku, units_sold_live, revenue_live')
        .gte('date', thirtyDaysAgo);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: recentSales } = await supabase
        .from('sku_daily_metrics')
        .select('sku, units_sold_live')
        .gte('date', sevenDaysAgo);

    const salesMap = new Map<string, number>();
    for (const row of (recentSales || [])) {
        salesMap.set(row.sku, (salesMap.get(row.sku) || 0) + row.units_sold_live);
    }

    // Track total 30d sales per SKU to identify active FBM SKUs
    const totalSalesMap = new Map<string, number>();
    for (const row of (allSalesData || [])) {
        totalSalesMap.set(row.sku, (totalSalesMap.get(row.sku) || 0) + (Number(row.units_sold_live) || 0));
    }

    // FBA inventory from snapshots
    const inventoryMap = new Map<string, number>();
    for (const snap of (snapshots || [])) {
        if (!inventoryMap.has(snap.sku)) {
            inventoryMap.set(snap.sku, snap.available_quantity);
        }
    }

    // For FBM SKUs (or any SKU with sales but no FBA inventory snapshot):
    // Amazon doesn't track FBM inventory, so we estimate stock from sales velocity.
    // This ensures Active SKUs and Inventory Value KPIs work for FBM sellers.
    const fbmSkus = new Set<string>();
    for (const [sku, totalUnits] of totalSalesMap) {
        if (totalUnits > 0 && !inventoryMap.has(sku)) {
            // Estimate: seller has ~30 days of stock (reasonable default for FBM)
            const dailyRate = (salesMap.get(sku) || 0) / 7;
            const estimatedStock = Math.max(Math.round(dailyRate * 30), 1);
            inventoryMap.set(sku, estimatedStock);
            fbmSkus.add(sku);
        }
    }

    const healthRows = [...inventoryMap.entries()].map(([sku, available_units]) => {
        const totalSales7d = salesMap.get(sku) || 0;
        const avgDaily = totalSales7d / 7;
        const isFbm = fbmSkus.has(sku);

        let daysInventory: number;
        let riskStatus: string;

        if (isFbm) {
            // FBM: We can't accurately track stock, estimate based on sales velocity
            daysInventory = avgDaily > 0 ? available_units / avgDaily : available_units > 0 ? 999 : 0;
            // FBM sellers manage their own stock — mark healthy by default unless no sales
            riskStatus = avgDaily > 0 ? 'green' : 'yellow';
        } else {
            // FBA: Use actual inventory data
            daysInventory = avgDaily > 0 ? available_units / avgDaily : available_units > 0 ? 999 : 0;
            riskStatus = daysInventory <= 7 ? 'red' : daysInventory <= 20 ? 'yellow' : 'green';
        }

        return {
            sku,
            available_units,
            avg_daily_sales_7d: Math.round(avgDaily * 100) / 100,
            days_inventory: Math.round(daysInventory * 10) / 10,
            risk_status: riskStatus,
            last_updated: new Date().toISOString(),
        };
    });

    if (healthRows.length > 0) {
        await supabase.from('inventory_health').delete().neq('sku', '__impossible__');
        for (let i = 0; i < healthRows.length; i += 200) {
            const chunk = healthRows.slice(i, i + 200);
            const { error } = await supabase
                .from('inventory_health')
                .upsert(chunk, { onConflict: 'sku', ignoreDuplicates: false });
            if (error) console.error('Inventory health upsert error:', error.message);
        }
    }

    // Generate alerts
    const alerts: any[] = [];
    await supabase.from('alerts').delete().neq('alert_type', '__impossible__');

    // ── Fetch all SKU-level aggregates for alert computation ──
    const { data: allSkuMetrics } = await supabase
        .from('sku_daily_metrics')
        .select('sku, return_rate, revenue_live, units_sold_live, refund_units, ad_spend, margin_percent, net_contribution');

    // Aggregate per-SKU totals (metrics are daily rows)
    const skuAggMap = new Map<string, {
        revenue: number; units: number; refundUnits: number;
        adSpend: number; netContribution: number; maxReturnRate: number;
    }>();
    for (const m of (allSkuMetrics || [])) {
        const existing = skuAggMap.get(m.sku);
        if (!existing) {
            skuAggMap.set(m.sku, {
                revenue: Number(m.revenue_live) || 0,
                units: Number(m.units_sold_live) || 0,
                refundUnits: Number(m.refund_units) || 0,
                adSpend: Number(m.ad_spend) || 0,
                netContribution: Number(m.net_contribution) || 0,
                maxReturnRate: Number(m.return_rate) || 0,
            });
        } else {
            existing.revenue += Number(m.revenue_live) || 0;
            existing.units += Number(m.units_sold_live) || 0;
            existing.refundUnits += Number(m.refund_units) || 0;
            existing.adSpend += Number(m.ad_spend) || 0;
            existing.netContribution += Number(m.net_contribution) || 0;
            existing.maxReturnRate = Math.max(existing.maxReturnRate, Number(m.return_rate) || 0);
        }
    }

    for (const h of healthRows) {
        const skuAgg = skuAggMap.get(h.sku);

        // 1. Low Stock Alert: Days of Inventory < 4
        if (h.days_inventory <= 4 && h.available_units > 0) {
            alerts.push({
                sku: h.sku,
                alert_type: 'low_inventory',
                severity: h.days_inventory <= 2 ? 'critical' : 'warning',
                title: `Low Stock: ${h.sku}`,
                message: `Only ${h.available_units} units left (${h.days_inventory.toFixed(0)} days of stock at current velocity)`,
                trigger_value: h.days_inventory,
                threshold_value: 4,
            });
        }

        // 2. Out of Stock Alert: Available Stock = 0
        if (h.available_units === 0) {
            alerts.push({
                sku: h.sku,
                alert_type: 'out_of_stock',
                severity: 'critical',
                title: `Out of Stock: ${h.sku}`,
                message: `SKU has zero available stock — no longer sellable`,
                trigger_value: 0,
                threshold_value: 0,
            });
        }

        // 3. Overstock Alert: Days of Inventory > 60
        if (h.days_inventory > 60) {
            alerts.push({
                sku: h.sku,
                alert_type: 'overstock',
                severity: 'warning',
                title: `Overstock: ${h.sku}`,
                message: `${h.days_inventory.toFixed(0)} days of inventory — too much stock compared to selling pace`,
                trigger_value: h.days_inventory,
                threshold_value: 60,
            });
        }

        // 4. Dead Inventory Alert: 0 sales in 30 days AND stock > 0
        if (h.available_units > 0 && skuAgg && skuAgg.units === 0) {
            alerts.push({
                sku: h.sku,
                alert_type: 'dead_inventory',
                severity: 'warning',
                title: `Dead Inventory: ${h.sku}`,
                message: `Zero sales with ${h.available_units} units in stock — consider liquidation`,
                trigger_value: 0,
                threshold_value: 0,
            });
        }

        if (skuAgg) {
            const margin = skuAgg.revenue > 0 ? (skuAgg.netContribution / skuAgg.revenue) * 100 : 0;
            const tacos = skuAgg.revenue > 0 ? (skuAgg.adSpend / skuAgg.revenue) * 100 : 0;
            const returnRate = skuAgg.units > 0 ? (skuAgg.refundUnits / skuAgg.units) * 100 : 0;

            // 5. High TACOS Alert: TACOS % > Contribution %
            if (tacos > 0 && tacos > margin) {
                alerts.push({
                    sku: h.sku,
                    alert_type: 'high_tacos',
                    severity: tacos > margin * 2 ? 'critical' : 'warning',
                    title: `High TACOS: ${h.sku}`,
                    message: `TACOS ${tacos.toFixed(1)}% exceeds margin ${margin.toFixed(1)}% — ads unprofitable`,
                    trigger_value: tacos,
                    threshold_value: margin,
                });
            }

            // 6. Low Margin Alert: Margin % < 10%
            if (skuAgg.revenue > 0 && margin < 10) {
                alerts.push({
                    sku: h.sku,
                    alert_type: 'low_margin',
                    severity: margin < 0 ? 'critical' : 'warning',
                    title: `Low Margin: ${h.sku}`,
                    message: `Margin at ${margin.toFixed(1)}% — below minimum acceptable threshold`,
                    trigger_value: margin,
                    threshold_value: 10,
                });
            }

            // 7. High Return Rate Alert: Return Rate > 10% (simplified from 3× category avg)
            if (returnRate > 10) {
                alerts.push({
                    sku: h.sku,
                    alert_type: 'high_return_rate',
                    severity: returnRate > 20 ? 'critical' : 'warning',
                    title: `High Return Rate: ${h.sku}`,
                    message: `Return rate of ${returnRate.toFixed(1)}% detected — investigation recommended`,
                    trigger_value: returnRate,
                    threshold_value: 10,
                });
            }
        }
    }

    if (alerts.length > 0) {
        for (let i = 0; i < alerts.length; i += 200) {
            const chunk = alerts.slice(i, i + 200);
            const { error } = await supabase.from('alerts').insert(chunk);
            if (error) console.error('Alerts insert error:', error.message);
        }
    }
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const period = searchParams.get('period') || '90d';
        const daysBack = parseInt(period.replace('d', '')) || 90;
        const forceFullSyncRequested = searchParams.get('full') === 'true';

        // Check Amazon connection
        const status = await checkAmazonConnection();
        if (!status.connected) {
            return NextResponse.json({
                error: 'Amazon SP-API not connected. Check your credentials in .env.local',
            }, { status: 502 });
        }

        const startTime = Date.now();
        const results: Record<string, any> = {};
        const steps: string[] = [];
        const warnings: string[] = [];

        // Determine sync range (incremental vs full)
        let postedAfter: string;
        const lastSynced = await getLastSyncedAt();
        const shouldForceFullSync = forceFullSyncRequested || !(await hasLedgerData());

        if (!forceFullSyncRequested && shouldForceFullSync) {
            steps.push('Ledger empty — forcing full backfill sync');
        }

        if (!shouldForceFullSync && lastSynced) {
            // Incremental: sync from last sync minus 1 day buffer for late events
            const bufferDate = new Date(new Date(lastSynced).getTime() - 24 * 60 * 60 * 1000);
            postedAfter = bufferDate.toISOString();
            console.log(`[Sync] Incremental sync from ${postedAfter}`);
            steps.push(`Incremental sync from ${bufferDate.toISOString().slice(0, 10)}`);
        } else {
            postedAfter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
            console.log(`[Sync] Full sync — last ${daysBack} days`);
            steps.push(`Full sync — last ${daysBack} days`);
        }

        // Step 1: Sync SKU catalog from listings report
        console.log('[Sync] Step 1/8: Syncing SKU catalog...');
        const skuMap = await syncSkus();
        results.skus = skuMap.size;
        steps.push(`${skuMap.size} SKUs synced`);

        // Step 2: Sync orders (metadata only — no item fetching!)
        console.log('[Sync] Step 2/8: Syncing orders...');
        const ordersCount = await syncOrders(daysBack);
        results.orders = ordersCount;
        steps.push(`${ordersCount} orders synced`);

        // Step 3: Sync financial events from Finances API (SOURCE OF TRUTH)
        console.log('[Sync] Step 3/8: Fetching financial events from Finances API...');
        const eventsCount = await syncFinancialEvents(postedAfter);
        results.financial_events = eventsCount;
        steps.push(`${eventsCount} financial events ingested`);
        if (eventsCount === 0) {
            warnings.push('No financial events ingested in this run (check sync range or Finances feed availability).');
        }

        // Step 4: Sync inventory snapshots
        console.log('[Sync] Step 4/8: Syncing inventory...');
        results.inventory_snapshots = await syncInventory();
        steps.push(`${results.inventory_snapshots} inventory snapshots`);
        if (results.inventory_snapshots === 0) {
            warnings.push('No inventory snapshots ingested in this run.');
        }

        // Step 5: Sync Financial Event Groups (Settlements)
        console.log('[Sync] Step 5/8: Syncing settlement event groups...');
        try {
            const settlementResult = await syncSettlements(postedAfter);
            results.settlement_groups = settlementResult.groups;
            results.settlement_items = settlementResult.items;
            results.settlement_events_linked = settlementResult.linked;
            steps.push(`${settlementResult.groups} settlement groups, ${settlementResult.items} settlement items, ${settlementResult.linked} events linked`);
        } catch (settleErr: any) {
            console.error('[Sync] Settlement sync failed (non-fatal):', settleErr.message);
            warnings.push(`Settlement sync failed: ${settleErr.message}`);
            results.settlement_groups = 0;
        }

        // Step 6: Compute aggregations
        console.log('[Sync] Step 6/8: Computing aggregations...');
        await computeAggregations();
        results.aggregations_computed = true;

        // Step 7: Compute inventory health + generate alerts
        console.log('[Sync] Step 7/8: Computing inventory health & alerts...');
        await computeInventoryHealth();
        results.inventory_health_computed = true;

        // Step 8: Detect financially closed orders
        console.log('[Sync] Step 8/8: Running closed order detection...');
        try {
            const lifecycleResult = await detectClosedOrders('sync');
            results.lifecycle = {
                orders_processed: lifecycleResult.orders_processed,
                orders_closed: lifecycleResult.orders_closed,
                orders_promoted: lifecycleResult.orders_promoted,
                state_transitions: lifecycleResult.state_transitions,
                duration_ms: lifecycleResult.duration_ms,
            };
            steps.push(
                `Lifecycle: ${lifecycleResult.orders_processed} processed, ` +
                `${lifecycleResult.orders_closed} closed, ` +
                `${lifecycleResult.orders_promoted} promoted`
            );
            if (lifecycleResult.errors.length > 0) {
                warnings.push(`Lifecycle warnings: ${lifecycleResult.errors.join('; ')}`);
            }
        } catch (lifecycleErr: any) {
            console.error('[Sync] Closed order detection failed (non-fatal):', lifecycleErr.message);
            warnings.push(`Closed order detection failed: ${lifecycleErr.message}`);
        }

        // Update last synced timestamp
        await setLastSyncedAt(new Date().toISOString());

        const durationMs = Date.now() - startTime;
        console.log(`[Sync] Complete in ${(durationMs / 1000).toFixed(1)}s`);

        return NextResponse.json({
            success: true,
            counts: results,
            steps,
            warnings,
            duration_ms: durationMs,
            synced_at: new Date().toISOString(),
            sync_type: (!shouldForceFullSync && lastSynced) ? 'incremental' : 'full',
        });
    } catch (e: any) {
        console.error('[Sync] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
