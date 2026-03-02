'use client';

import type { OrderRevenueRecord } from '@/lib/revenue-types';

interface Props {
    record: OrderRevenueRecord;
}

function formatExact(n: number): string {
    if (n === 0) return '₹0.00';
    const prefix = n < 0 ? '-' : '';
    return `${prefix}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    try {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
        });
    } catch {
        return dateStr;
    }
}

function Row({ label, value, color, bold, mono }: {
    label: string;
    value: string;
    color?: string;
    bold?: boolean;
    mono?: boolean;
}) {
    return (
        <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">{label}</span>
            <span className={`text-[11px] tabular-nums ${bold ? 'font-semibold' : 'font-medium'} ${mono ? 'font-mono' : ''} ${color || 'text-slate-300'}`}>
                {value}
            </span>
        </div>
    );
}

export default function OrderDetailPanel({ record: r }: Props) {
    const calc = r.calculations;

    return (
        <div className="bg-[#0d1117] border-l-2 border-indigo-500/30 px-6 py-5">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
                {/* Column 1: Order & Product Info */}
                <div className="space-y-4">
                    <div>
                        <h4 className="text-[11px] font-semibold text-indigo-400 uppercase tracking-wider mb-2">Order Details</h4>
                        <div className="space-y-1.5">
                            <Row label="Order ID" value={r.order_id} mono />
                            <Row label="Order Date" value={formatDate(r.order_date)} />
                            <Row label="Shipment Date" value={formatDate(r.shipment_date)} />
                            <Row label="Delivery Date" value={formatDate(r.delivery_date)} />
                            <Row label="Status" value={r.order_status} />
                            <Row label="Fulfillment" value={r.fulfillment_channel} />
                            <Row label="Prime" value={r.is_prime ? 'Yes' : 'No'} />
                        </div>
                    </div>
                    <div>
                        <h4 className="text-[11px] font-semibold text-indigo-400 uppercase tracking-wider mb-2">Product</h4>
                        <div className="space-y-1.5">
                            <Row label="SKU" value={r.sku} mono />
                            <Row label="ASIN" value={r.asin || '—'} mono />
                            <Row label="Product Name" value={r.product_name} />
                            <Row label="Quantity" value={String(r.quantity)} />
                            {r.category && <Row label="Category" value={r.category} />}
                        </div>
                    </div>
                    <div>
                        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Transaction Types</h4>
                        <div className="flex flex-wrap gap-1.5">
                            {r.transaction_types.map(t => (
                                <span key={t} className="px-2 py-0.5 text-[9px] font-medium rounded-full bg-white/5 border border-white/10 text-slate-400">
                                    {t}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Column 2: Revenue */}
                <div className="space-y-4">
                    <div>
                        <h4 className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider mb-2">Product Sales</h4>
                        <div className="space-y-1.5">
                            <Row label="Product Sales" value={formatExact(r.product_sales)} color="text-emerald-400" />
                            <Row label="Shipping Credits" value={formatExact(r.shipping_credits)} color="text-emerald-400" />
                            <Row label="Gift Wrap Credits" value={formatExact(r.gift_wrap_credits)} />
                        </div>
                    </div>
                    <div>
                        <h4 className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider mb-2">Promotional Rebates</h4>
                        <div className="space-y-1.5">
                            <Row label="Promotions" value={formatExact(r.promotional_rebates)} color={r.promotional_rebates < 0 ? 'text-amber-400' : 'text-slate-300'} />
                        </div>
                    </div>
                    <div>
                        <h4 className="text-[11px] font-semibold text-orange-400 uppercase tracking-wider mb-2">Taxes</h4>
                        <div className="space-y-1.5">
                            <Row label="GST" value={formatExact(r.taxes.gst)} color="text-orange-400" />
                            <Row label="TCS" value={formatExact(r.taxes.tcs)} color="text-orange-400" />
                            <Row label="TDS" value={formatExact(r.taxes.tds)} color="text-orange-400" />
                            <div className="border-t border-white/5 pt-1.5">
                                <Row label="Total Taxes" value={formatExact(r.taxes.total)} color="text-orange-400" bold />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Column 3: Fees */}
                <div className="space-y-4">
                    <div>
                        <h4 className="text-[11px] font-semibold text-red-400 uppercase tracking-wider mb-2">Amazon Fees</h4>
                        <div className="space-y-1.5">
                            <Row label="Referral Fee" value={formatExact(r.amazon_fees.referral_fee)} color="text-red-400" />
                            <Row label="Closing Fee" value={formatExact(r.amazon_fees.closing_fee)} color="text-red-400" />
                            <Row label="FBA Fee" value={formatExact(r.amazon_fees.fba_fee)} color="text-red-400" />
                            <Row label="Easy Ship Fee" value={formatExact(r.amazon_fees.easy_ship_fee)} color="text-red-400" />
                            <Row label="Weight Handling" value={formatExact(r.amazon_fees.weight_handling_fee)} color="text-red-400" />
                            {r.amazon_fees.technology_fee > 0 && (
                                <Row label="Technology Fee" value={formatExact(r.amazon_fees.technology_fee)} color="text-red-400" />
                            )}
                            <div className="border-t border-white/5 pt-1.5">
                                <Row label="Total Amazon Fees" value={formatExact(r.amazon_fees.total)} color="text-red-400" bold />
                            </div>
                        </div>
                    </div>
                    <div>
                        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Other Charges</h4>
                        <div className="space-y-1.5">
                            {r.other_charges.shipping_chargeback > 0 && <Row label="Shipping Chargeback" value={formatExact(r.other_charges.shipping_chargeback)} color="text-red-400" />}
                            {r.other_charges.adjustment_fees !== 0 && <Row label="Adjustment Fees" value={formatExact(r.other_charges.adjustment_fees)} color={r.other_charges.adjustment_fees > 0 ? 'text-red-400' : 'text-emerald-400'} />}
                            {r.other_charges.storage_fees > 0 && <Row label="Storage Fees" value={formatExact(r.other_charges.storage_fees)} color="text-red-400" />}
                            {r.other_charges.removal_fees > 0 && <Row label="Removal Fees" value={formatExact(r.other_charges.removal_fees)} color="text-red-400" />}
                            {r.other_charges.long_term_storage_fees > 0 && <Row label="Long Term Storage" value={formatExact(r.other_charges.long_term_storage_fees)} color="text-red-400" />}
                            {r.other_charges.other_fees > 0 && <Row label="Other Fees" value={formatExact(r.other_charges.other_fees)} color="text-red-400" />}
                            <div className="border-t border-white/5 pt-1.5">
                                <Row label="Total Other Charges" value={formatExact(r.other_charges.total)} color="text-red-400" bold />
                            </div>
                        </div>
                    </div>
                    {/* Fee Detail Breakdown (audit trail) */}
                    {Object.keys(r.fee_details).length > 0 && (
                        <div>
                            <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Raw Fee Types</h4>
                            <div className="space-y-0.5 max-h-[120px] overflow-y-auto">
                                {Object.entries(r.fee_details).sort(([, a], [, b]) => (b as number) - (a as number)).map(([type, amt]) => (
                                    <div key={type} className="flex items-center justify-between">
                                        <span className="text-[9px] text-slate-600 truncate max-w-[120px]">{type}</span>
                                        <span className="text-[9px] font-mono text-red-400/70">{formatExact(amt as number)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Column 4: Returns + Final Settlement */}
                <div className="space-y-4">
                    {/* Return Details */}
                    {r.return_details.is_returned && (
                        <div>
                            <h4 className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider mb-2">Return Details</h4>
                            <div className="space-y-1.5">
                                <Row label="Return Type" value={r.return_details.return_type || '—'} color={r.return_details.return_type === 'RTO' ? 'text-red-400' : 'text-amber-400'} />
                                <Row label="Return Date" value={formatDate(r.return_details.return_date)} />
                                <Row label="Refund Amount" value={formatExact(r.return_details.refund_amount)} color="text-amber-400" />
                                <Row label="Refund Commission" value={formatExact(r.return_details.refund_commission)} color="text-amber-400" />
                                <Row label="Return Processing Fee" value={formatExact(r.return_details.return_processing_fee)} color="text-red-400" />
                                {r.return_details.refund_shipping > 0 && (
                                    <Row label="Refund Shipping" value={formatExact(r.return_details.refund_shipping)} color="text-amber-400" />
                                )}
                                {r.return_details.refund_tax > 0 && (
                                    <Row label="Refund Tax" value={formatExact(r.return_details.refund_tax)} />
                                )}
                                <div className="border-t border-white/5 pt-1.5">
                                    <Row label="Total Refund Impact" value={formatExact(r.return_details.total_refund_impact)} color="text-amber-400" bold />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Advertising */}
                    {r.ad_spend > 0 && (
                        <div>
                            <h4 className="text-[11px] font-semibold text-violet-400 uppercase tracking-wider mb-2">Advertising Cost</h4>
                            <div className="space-y-1.5">
                                <Row label="Ad Spend" value={formatExact(r.ad_spend)} color="text-violet-400" />
                            </div>
                        </div>
                    )}

                    {/* Final Settlement Box */}
                    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
                        <h4 className="text-[11px] font-semibold text-white uppercase tracking-wider mb-3">Final Calculations</h4>
                        <div className="space-y-2">
                            <Row label="Gross Revenue" value={formatExact(calc.gross_revenue)} color="text-emerald-400" />
                            <Row label="Total Fees" value={`-${formatExact(calc.total_fees)}`} color="text-red-400" />
                            <Row label="Total Taxes" value={`-${formatExact(calc.total_taxes)}`} color="text-orange-400" />
                            {calc.total_refund_impact > 0 && (
                                <Row label="Refund Impact" value={`-${formatExact(calc.total_refund_impact)}`} color="text-amber-400" />
                            )}
                            {calc.total_ad_spend > 0 && (
                                <Row label="Ad Spend" value={`-${formatExact(calc.total_ad_spend)}`} color="text-violet-400" />
                            )}
                            {r.promotional_rebates !== 0 && (
                                <Row label="Promotions" value={formatExact(r.promotional_rebates)} color="text-amber-400" />
                            )}
                            <div className="border-t border-white/10 pt-2 mt-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-white">Net Settlement Amount</span>
                                    <span className={`text-base font-bold ${calc.net_settlement >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {formatExact(calc.net_settlement)}
                                    </span>
                                </div>
                                <p className="text-[9px] text-slate-600 mt-1 text-right">
                                    Exact amount credited to seller
                                </p>
                            </div>
                            {r.posted_date && (
                                <Row label="Posted Date" value={formatDate(r.posted_date)} />
                            )}
                            <Row label="Financial Events" value={String(r.event_count)} />
                            {r.event_group_id && (
                                <Row label="Event Group" value={r.event_group_id} mono />
                            )}
                        </div>
                    </div>

                    {/* Financial Lifecycle Status */}
                    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
                        <h4 className="text-[11px] font-semibold text-indigo-400 uppercase tracking-wider mb-3">Financial Lifecycle</h4>
                        <div className="space-y-2">
                            <Row
                                label="Financial Status"
                                value={
                                    r.financial_status === 'FINANCIALLY_CLOSED' ? '🔒 Closed'
                                    : r.financial_status === 'DELIVERED_PENDING_SETTLEMENT' ? '⏳ Pending (Return Window)'
                                    : '🔓 Open'
                                }
                                color={
                                    r.financial_status === 'FINANCIALLY_CLOSED' ? 'text-emerald-400'
                                    : r.financial_status === 'DELIVERED_PENDING_SETTLEMENT' ? 'text-amber-400'
                                    : 'text-slate-400'
                                }
                                bold
                            />
                            <Row label="Settlement Status" value={r.settlement_status || 'Unsettled'} />
                            {r.return_deadline && (
                                <Row label="Return Deadline" value={formatDate(r.return_deadline)} />
                            )}
                            {r.financial_closed_at && (
                                <Row label="Closed At" value={formatDate(r.financial_closed_at)} color="text-emerald-400" />
                            )}
                            {r.financial_status === 'FINANCIALLY_CLOSED' && (
                                <p className="text-[9px] text-emerald-500/70 mt-1">
                                    ✓ Delivery + 30 days passed, no refund — this is your solid revenue
                                </p>
                            )}
                            {r.financial_status === 'DELIVERED_PENDING_SETTLEMENT' && r.return_deadline && (
                                <p className="text-[9px] text-amber-400/70 mt-1">
                                    Return window expires {formatDate(r.return_deadline)} — order will auto-close if no refund
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
