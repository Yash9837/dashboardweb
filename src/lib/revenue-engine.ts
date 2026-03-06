// ============================================================================
// Revenue Calculation Engine
// Processes financial events into per-order/SKU net revenue records
// ============================================================================
// Handles transaction types:
//   Order (ShipmentEvent)    → revenue + fees
//   Refund (RefundEvent)     → reverses order transaction (time-shifted)
//   Shipping Services        → Easy Ship / logistics charges
//   Service Fee              → advertising, storage, subscriptions
//   Adjustment               → weight correction, reimbursements
//   Chargeback               → buyer disputes
//   Retrocharge              → late adjustments (shipping recalc, FBA reimbursement)
//
// Revenue Formula (industry standard):
//   Gross Revenue   = Principal + ShippingCredits + GiftWrap
//   Total Deductions = ReferralFee + FBAFee + ClosingFee + EasyShipFee + WeightHandling
//                    + Promotions + TCS + TDS + ShippingChargeback + StorageFees
//   Net Settlement  = Gross Revenue + Promotions - Total Fees - Total Taxes - Refund Impact
// ============================================================================

import type {
  OrderRevenueRecord,
  RevenueSummary,
  SKURevenueSummary,
  WaterfallStep,
  TransactionType,
} from './revenue-types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function round2(v: number): number {
  return Math.round((Number(v) || 0) * 100) / 100;
}

// ── Blank Record Factory ─────────────────────────────────────────────────────

interface RawRecord {
  // Identifiers
  order_id: string;
  sku: string;
  asin: string;
  product_name: string;
  category: string;
  brand: string;
  quantity: number;

  // Dates
  order_date: string | null;
  shipment_date: string | null;
  delivery_date: string | null;
  posted_date: string | null;

  // Status
  order_status: string;
  fulfillment_channel: string;
  is_prime: boolean;

  // Revenue
  product_sales: number;
  shipping_credits: number;
  gift_wrap_credits: number;
  promotional_rebates: number;

  // Taxes
  gst: number;
  tcs: number;
  tds: number;

  // Amazon Fees
  referral_fee: number;
  closing_fee: number;
  fba_fee: number;
  easy_ship_fee: number;
  weight_handling_fee: number;
  technology_fee: number;

  // Other Charges
  shipping_chargeback: number;
  adjustment_fees: number;
  storage_fees: number;
  removal_fees: number;
  long_term_storage_fees: number;
  other_fees: number;

  // Returns
  is_returned: boolean;
  return_date: string | null;
  return_type: 'Customer Return' | 'RTO' | null;
  refund_amount: number;
  refund_commission: number;
  return_processing_fee: number;
  refund_shipping: number;
  refund_tax: number;

  // Advertising
  ad_spend: number;

  // Fee audit
  fee_details: Record<string, number>;

  // Transaction types
  transaction_types: Set<TransactionType>;

  // Settlement
  event_group_id: string | null;
  settlement_id: string | null;
  event_count: number;
}

function createBlankRecord(
  orderId: string,
  sku: string,
  orderInfo: any,
  skuInfo: any,
  adSpend: number,
  postedDate: string | null,
): RawRecord {
  return {
    order_id: orderId,
    sku,
    asin: skuInfo?.asin || '',
    product_name: skuInfo?.title || sku,
    category: skuInfo?.category || '',
    brand: skuInfo?.brand || '',
    quantity: 0,

    order_date: orderInfo?.purchase_date || postedDate,
    shipment_date: orderInfo?.shipment_date || null,
    delivery_date: orderInfo?.delivery_date || null,
    posted_date: postedDate,

    order_status: orderInfo?.order_status || 'Unknown',
    fulfillment_channel: orderInfo?.fulfillment_channel || 'Unknown',
    is_prime: orderInfo?.is_prime || false,

    product_sales: 0,
    shipping_credits: 0,
    gift_wrap_credits: 0,
    promotional_rebates: 0,

    gst: 0,
    tcs: 0,
    tds: 0,

    referral_fee: 0,
    closing_fee: 0,
    fba_fee: 0,
    easy_ship_fee: 0,
    weight_handling_fee: 0,
    technology_fee: 0,

    shipping_chargeback: 0,
    adjustment_fees: 0,
    storage_fees: 0,
    removal_fees: 0,
    long_term_storage_fees: 0,
    other_fees: 0,

    is_returned: false,
    return_date: null,
    return_type: null,
    refund_amount: 0,
    refund_commission: 0,
    return_processing_fee: 0,
    refund_shipping: 0,
    refund_tax: 0,

    ad_spend: adSpend,

    fee_details: {},
    transaction_types: new Set(),
    event_group_id: null,
    settlement_id: null,
    event_count: 0,
  };
}

// ── Event Interface ──────────────────────────────────────────────────────────

export interface FinancialEvent {
  event_type: string;       // 'shipment' | 'fee' | 'refund' | 'adjustment' | 'ad_spend'
  amount: number;
  quantity?: number;
  fee_type?: string;
  sku?: string;
  amazon_order_id?: string;
  posted_date: string;
  delivery_date?: string;
  reference_id?: string;
  event_group_id?: string;
  transaction_type?: string; // 'Order' | 'Refund' | 'ShippingServices' | etc.
  amount_description?: string;
}

// ── Main Engine ──────────────────────────────────────────────────────────────

export interface EngineInput {
  events: FinancialEvent[];
  orders: any[];       // Order metadata
  skuMaster: any[];    // SKU master data
  adSpendMap: Map<string, number>;
}

export interface EngineOutput {
  records: OrderRevenueRecord[];
  summary: RevenueSummary;
  skuSummary: SKURevenueSummary[];
  waterfall: WaterfallStep[];
}

export function calculateRevenue(input: EngineInput): EngineOutput {
  const { events, orders, skuMaster, adSpendMap } = input;

  // Build lookup maps
  const skuMap = new Map<string, any>();
  for (const s of skuMaster) skuMap.set(s.sku, s);

  const orderMap = new Map<string, any>();
  for (const o of orders) orderMap.set(o.amazon_order_id, o);

  // ── Step 1: Resolve null SKUs for fee/refund events ──
  const orderSkuLookup = new Map<string, string>();
  for (const e of events) {
    if (e.event_type === 'shipment' && e.amazon_order_id && e.sku && e.sku !== 'UNKNOWN') {
      if (!orderSkuLookup.has(e.amazon_order_id)) {
        orderSkuLookup.set(e.amazon_order_id, e.sku);
      }
    }
  }
  for (const e of events) {
    if (['fee', 'refund', 'adjustment'].includes(e.event_type) && e.amazon_order_id && (!e.sku || e.sku === 'UNKNOWN')) {
      const resolved = orderSkuLookup.get(e.amazon_order_id);
      if (resolved) e.sku = resolved;
    }
  }

  // ── Step 2: Build per-order/SKU ledger ──
  const ledger = new Map<string, RawRecord>();

  function getRecord(orderId: string, sku: string, evt: FinancialEvent): RawRecord {
    const key = `${orderId}|${sku}`;
    if (!ledger.has(key)) {
      ledger.set(key, createBlankRecord(
        orderId,
        sku,
        orderMap.get(orderId),
        skuMap.get(sku),
        adSpendMap.get(sku) || 0,
        evt.posted_date,
      ));
    }
    return ledger.get(key)!;
  }

  // ── Step 3: Process every financial event ──
  // Track which order+SKU pairs have already had their quantity counted.
  // The sync script stores the same QuantityShipped on EVERY ItemChargeList
  // entry (Principal, Tax, TCS-IGST, etc.), so without dedup we inflate by ~3x.
  const quantityCounted = new Set<string>();

  for (const evt of events) {
    const orderId = evt.amazon_order_id || 'NO_ORDER';
    const sku = evt.sku || 'UNKNOWN';
    const rec = getRecord(orderId, sku, evt);
    rec.event_count++;

    const amount = Number(evt.amount) || 0;
    const absAmount = Math.abs(amount);
    const refId = (evt.reference_id || '').toLowerCase();
    const feeType = (evt.fee_type || '').toLowerCase();

    // Track event group
    if (evt.event_group_id && !rec.event_group_id) {
      rec.event_group_id = evt.event_group_id;
    }

    switch (evt.event_type) {
      // ═══════════════════════════════════════════════════════════════════
      // ORDER (ShipmentEvent) — Revenue + Fees
      // Contains: ItemChargeList, ItemFeeList, ItemTaxList, PromotionList
      // ═══════════════════════════════════════════════════════════════════
      case 'shipment': {
        rec.transaction_types.add('Order');

        // Only count quantity ONCE per order+SKU. The DB has multiple shipment
        // rows per item (one per charge type: Principal, Tax, TCS-IGST, etc.),
        // each carrying the same QuantityShipped. Summing all would inflate ~3x.
        const qtyKey = `${orderId}|${sku}`;
        if (!quantityCounted.has(qtyKey) && (Number(evt.quantity) || 0) > 0) {
          rec.quantity += Number(evt.quantity) || 0;
          quantityCounted.add(qtyKey);
        }

        // Classify charge type from reference_id / amount_description
        const desc = (evt.amount_description || '').toLowerCase();
        const classifyKey = desc || refId;

        if (classifyKey.includes('principal') || classifyKey.includes('itemprice') || classifyKey.includes('item_price')) {
          rec.product_sales += amount;
        } else if (classifyKey.includes('shippingcharge') || classifyKey.includes('shipping_credit') || classifyKey.includes('shippingcredit')) {
          rec.shipping_credits += amount;
        } else if (classifyKey.includes('giftwrap') || classifyKey.includes('gift_wrap')) {
          rec.gift_wrap_credits += amount;
        } else if (classifyKey.includes('taxonpromotion') || classifyKey.includes('taxpromotion') || classifyKey.includes('promotiontax')) {
          // GST credit on the promotional discount (e.g. "TaxOnPromotion" −0.56).
          // This reduces GST liability — NOT a seller-facing promo discount.
          rec.gst += amount; // negative amount reduces net GST → 5.56 + (−0.56) = 5.00
        } else if (classifyKey.includes('promotion') || classifyKey.includes('discount')) {
          rec.promotional_rebates += amount; // Already negative from Amazon
        } else if (
          // TCS must be checked BEFORE the generic gst/igst/tax check —
          // otherwise 'tcs-igst' matches includes('igst') and ends up in the GST bucket.
          classifyKey.includes('tcs-cgst') || classifyKey.includes('tcs-sgst') || classifyKey.includes('tcs-igst') ||
          classifyKey.includes('tcs_cgst') || classifyKey.includes('tcs_sgst') || classifyKey.includes('tcs_igst')
        ) {
          rec.tcs += absAmount; // TCS deducted by Amazon (stored as absolute, subtracted in net calc)
        } else if (classifyKey.includes('tax') || classifyKey.includes('gst') || classifyKey.includes('igst')) {
          rec.gst += amount; // GST collected from buyer (positive amount, subtracted in net calc)
        } else {
          // Default: treat as product sales if positive, promo if negative
          if (amount >= 0) {
            rec.product_sales += amount;
          } else {
            rec.promotional_rebates += amount;
          }
        }
        break;
      }

      // ═══════════════════════════════════════════════════════════════════
      // FEE — Amazon deductions
      // Handles all fee sub-types from ItemFeeList
      // ═══════════════════════════════════════════════════════════════════
      case 'fee': {
        const rawType = evt.fee_type || 'Unknown';
        rec.fee_details[rawType] = (rec.fee_details[rawType] || 0) + absAmount;

        // ── Amazon Fees ──
        if (feeType.includes('commission') || feeType.includes('referral')) {
          rec.referral_fee += absAmount;
          rec.transaction_types.add('Order');
        } else if (feeType.includes('fixedclosing') || feeType.includes('closingfee') || feeType.includes('variableclosing')) {
          rec.closing_fee += absAmount;
          rec.transaction_types.add('Order');
        } else if (feeType.includes('fbaperunit') || (feeType.includes('fba') && !feeType.includes('storage') && !feeType.includes('removal') && !feeType.includes('longterm'))) {
          rec.fba_fee += absAmount;
          rec.transaction_types.add('Order');
        } else if (feeType.includes('easyship') || feeType.includes('easy_ship')) {
          rec.easy_ship_fee += absAmount;
          rec.transaction_types.add('ShippingServices');
        } else if (feeType.includes('weighthandling') || feeType.includes('weight_handling') || feeType.includes('fbaweight')) {
          rec.weight_handling_fee += absAmount;
          rec.transaction_types.add('ShippingServices');
        } else if (feeType.includes('technologyfee') || feeType.includes('technology')) {
          rec.technology_fee += absAmount;
          rec.transaction_types.add('Order');

          // ── Shipping Services (MFN/Easy Ship) ──
        } else if (feeType.includes('mfnpostage') || feeType.includes('shippinglabel') || feeType.includes('shippingcharge') || feeType.includes('forwardshipping') || feeType.includes('returnshipping') || feeType.includes('shippingchargeback')) {
          rec.shipping_chargeback += absAmount;
          rec.transaction_types.add('ShippingServices');

          // ── Taxes ──
        } else if (feeType.includes('tcs') || feeType === 'tcs-cgst' || feeType === 'tcs-sgst' || feeType === 'tcs-igst') {
          rec.tcs += absAmount;
        } else if (feeType.includes('tds')) {
          rec.tds += absAmount;
        } else if (feeType.includes('gst') || feeType.includes('igst') || feeType.includes('cgst') || feeType.includes('sgst')) {
          rec.gst += absAmount;

          // ── Service Fees ──
        } else if (feeType.includes('longtermstorage') || feeType.includes('longterm')) {
          rec.long_term_storage_fees += absAmount;
          rec.transaction_types.add('ServiceFee');
        } else if (feeType.includes('storagefee') || feeType.includes('monthlyinventory') || feeType.includes('storage')) {
          rec.storage_fees += absAmount;
          rec.transaction_types.add('ServiceFee');
        } else if (feeType.includes('removal') || feeType.includes('disposal')) {
          rec.removal_fees += absAmount;
          rec.transaction_types.add('ServiceFee');
        } else if (feeType.includes('subscription') || feeType.includes('advertising') || feeType.includes('sponsored')) {
          rec.ad_spend += absAmount;
          rec.transaction_types.add('ServiceFee');

          // ── Other ──
        } else {
          rec.other_fees += absAmount;
        }
        break;
      }

      // ═══════════════════════════════════════════════════════════════════
      // REFUND (RefundEvent) — Reverses original order
      // Contains: ItemChargeAdjustmentList, ItemFeeAdjustmentList,
      //           PromotionAdjustmentList
      // ═══════════════════════════════════════════════════════════════════
      case 'refund': {
        rec.transaction_types.add('Refund');
        rec.is_returned = true;
        rec.return_date = evt.posted_date;

        // Determine return type: RTO if not delivered, else Customer Return
        if (!rec.delivery_date) {
          rec.return_type = 'RTO';
        } else {
          rec.return_type = 'Customer Return';
        }

        // Classify refund components
        const desc = (evt.amount_description || '').toLowerCase();
        const classifyKey = desc || refId;

        if (classifyKey.includes('principal') || classifyKey.includes('itemprice') || classifyKey.includes('refundprincipal')) {
          rec.refund_amount += absAmount;
        } else if (classifyKey.includes('commission') || classifyKey.includes('referral') || classifyKey.includes('refundcommission')) {
          rec.refund_commission += absAmount;
        } else if (classifyKey.includes('processing') || classifyKey.includes('returnprocessing')) {
          rec.return_processing_fee += absAmount;
        } else if (classifyKey.includes('shipping') || classifyKey.includes('shippingcharge')) {
          rec.refund_shipping += absAmount;
        } else if (classifyKey.includes('tax') || classifyKey.includes('gst')) {
          rec.refund_tax += absAmount;
          // Returned tax reduces tax liability
          rec.gst -= absAmount;
        } else {
          // Default: treat as refund principal
          rec.refund_amount += absAmount;
        }
        break;
      }

      // ═══════════════════════════════════════════════════════════════════
      // ADJUSTMENT — Weight corrections, reimbursements
      // RetrochargeEvent-style
      // ═══════════════════════════════════════════════════════════════════
      case 'adjustment': {
        const txnType = (evt.transaction_type || '').toLowerCase();
        const adjFeeType = (evt.fee_type || '').toLowerCase();

        if (txnType.includes('chargeback')) {
          rec.transaction_types.add('Chargeback');
        } else if (txnType.includes('retrocharge')) {
          rec.transaction_types.add('Retrocharge');
        } else {
          rec.transaction_types.add('Adjustment');
        }

        // PostageRefund adjustments from RTO returns should be tracked
        if (adjFeeType.includes('postagerefund') || adjFeeType.includes('postage_refund')) {
          rec.transaction_types.add('Adjustment');
          // Positive = money returning (shipping refund for RTO)
          if (amount > 0) {
            rec.adjustment_fees -= absAmount;
          } else {
            rec.adjustment_fees += absAmount;
          }
        } else if (amount > 0) {
          rec.adjustment_fees -= absAmount; // Reduce deductions (reimbursement)
        } else {
          rec.adjustment_fees += absAmount; // Add deduction
        }
        break;
      }

      // ═══════════════════════════════════════════════════════════════════
      // REFUND_FEE — Fee adjustments on refunds (RefundCommission,
      //              FixedClosingFee reversal, etc.)
      // ═══════════════════════════════════════════════════════════════════
      case 'refund_fee': {
        rec.transaction_types.add('Refund');

        // RefundCommission is a NEGATIVE fee (Amazon charges for refund processing)
        // Fee reversals (e.g. FixedClosingFee) are POSITIVE (Amazon gives back the original fee)
        if (feeType.includes('commission') || feeType.includes('refundcommission')) {
          rec.refund_commission += absAmount;
        } else if (feeType.includes('fixedclosing') || feeType.includes('closingfee') || feeType.includes('variableclosing')) {
          // Closing fee reversal: positive = money back → reduces net fees
          if (amount > 0) {
            rec.closing_fee = Math.max(0, rec.closing_fee - absAmount);
          } else {
            rec.closing_fee += absAmount;
          }
        } else if (feeType.includes('fba') || feeType.includes('fulfilment')) {
          if (amount > 0) {
            rec.fba_fee = Math.max(0, rec.fba_fee - absAmount);
          } else {
            rec.fba_fee += absAmount;
          }
        } else if (feeType.includes('referral')) {
          if (amount > 0) {
            rec.referral_fee = Math.max(0, rec.referral_fee - absAmount);
          } else {
            rec.referral_fee += absAmount;
          }
        } else {
          // Generic refund fee
          if (amount > 0) {
            rec.other_fees = Math.max(0, rec.other_fees - absAmount);
          } else {
            rec.other_fees += absAmount;
          }
        }
        break;
      }

      // ═══════════════════════════════════════════════════════════════════
      // TAX_WITHHELD — TDS deducted at source by Amazon
      // ═══════════════════════════════════════════════════════════════════
      case 'tax_withheld': {
        if (feeType.includes('tds') || feeType.includes('itemtds') || feeType.includes('tax_deducted')) {
          rec.tds += absAmount;
        } else if (feeType.includes('tcs')) {
          rec.tcs += absAmount;
        } else {
          // Default to TDS
          rec.tds += absAmount;
        }
        break;
      }

      // ═══════════════════════════════════════════════════════════════════
      // PROMOTION — Coupons, Lightning Deals, promo adjustments
      // ═══════════════════════════════════════════════════════════════════
      case 'promotion': {
        rec.promotional_rebates += amount; // Already negative from Amazon
        break;
      }

      // ═══════════════════════════════════════════════════════════════════
      // AD_SPEND — From Advertising API / ad_metrics table
      // ═══════════════════════════════════════════════════════════════════
      case 'ad_spend': {
        rec.transaction_types.add('ServiceFee');
        rec.ad_spend += absAmount;
        break;
      }
    }
  }

  // ── Step 4: Compute final calculations ──
  const records: OrderRevenueRecord[] = [];

  for (const raw of ledger.values()) {
    // GST is stored as the positive amount collected from buyer (it's a deduction from seller net).
    // TCS and TDS are stored as absolute values (already deducted by Amazon).
    const gst = round2(Math.max(0, raw.gst));
    const tcs = round2(Math.abs(raw.tcs)); // Ensure positive (deducted from net)
    const tds = round2(Math.abs(raw.tds)); // Ensure positive (deducted from net)
    // totalTaxes for display = full tax picture (GST + TCS + TDS)
    const totalTaxes = round2(gst + tcs + tds);
    // Amazon only withholds TCS + TDS from the settlement; GST is passed through to the seller
    const withheldTaxes = round2(tcs + tds);

    const amazonFeesTotal = round2(
      raw.referral_fee + raw.closing_fee + raw.fba_fee +
      raw.easy_ship_fee + raw.weight_handling_fee + raw.technology_fee
    );

    const otherChargesTotal = round2(
      raw.shipping_chargeback + raw.adjustment_fees + raw.storage_fees +
      raw.removal_fees + raw.long_term_storage_fees + raw.other_fees
    );

    const grossRevenue = round2(
      raw.product_sales + raw.shipping_credits + raw.gift_wrap_credits
    );

    const totalFees = round2(amazonFeesTotal + otherChargesTotal);

    const totalRefundImpact = round2(
      raw.refund_amount + raw.refund_commission + raw.return_processing_fee + raw.refund_shipping
    );

    // Net Settlement = what Amazon transfers to the seller's bank account.
    // Formula (matching Amazon's Unified Transaction CSV):
    //   product_sales + promotions + GST (pass-through) - TCS - TDS - selling_fees - fba_fees - closing_fee - MFNPostage - refund_impact - ad_spend
    // GST is ADDED because Amazon collects it from the buyer and passes it to the seller
    // (seller remits to govt separately). TCS and TDS are actually withheld by Amazon.
    const netSettlement = round2(
      grossRevenue
      + raw.promotional_rebates  // Already negative
      + gst                      // GST is pass-through: seller receives it to pay govt
      - withheldTaxes            // TCS + TDS only — actually withheld by Amazon
      - amazonFeesTotal
      - otherChargesTotal
      - totalRefundImpact
      - raw.ad_spend
    );

    const record: OrderRevenueRecord = {
      order_id: raw.order_id,
      sku: raw.sku,
      asin: raw.asin,
      product_name: raw.product_name,
      category: raw.category,
      brand: raw.brand,
      quantity: raw.quantity,

      order_date: raw.order_date,
      shipment_date: raw.shipment_date,
      delivery_date: raw.delivery_date,
      posted_date: raw.posted_date,

      order_status: raw.order_status,
      fulfillment_channel: raw.fulfillment_channel,
      is_prime: raw.is_prime,

      product_sales: round2(raw.product_sales),
      shipping_credits: round2(raw.shipping_credits),
      gift_wrap_credits: round2(raw.gift_wrap_credits),
      promotional_rebates: round2(raw.promotional_rebates),

      taxes: { gst, tcs, tds, total: totalTaxes },
      amazon_fees: {
        referral_fee: round2(raw.referral_fee),
        closing_fee: round2(raw.closing_fee),
        fba_fee: round2(raw.fba_fee),
        easy_ship_fee: round2(raw.easy_ship_fee),
        weight_handling_fee: round2(raw.weight_handling_fee),
        technology_fee: round2(raw.technology_fee),
        total: amazonFeesTotal,
      },
      other_charges: {
        shipping_chargeback: round2(raw.shipping_chargeback),
        adjustment_fees: round2(raw.adjustment_fees),
        storage_fees: round2(raw.storage_fees),
        removal_fees: round2(raw.removal_fees),
        long_term_storage_fees: round2(raw.long_term_storage_fees),
        other_fees: round2(raw.other_fees),
        total: otherChargesTotal,
      },
      return_details: {
        is_returned: raw.is_returned,
        return_date: raw.return_date,
        return_type: raw.return_type,
        refund_amount: round2(raw.refund_amount),
        refund_commission: round2(raw.refund_commission),
        return_processing_fee: round2(raw.return_processing_fee),
        refund_shipping: round2(raw.refund_shipping),
        refund_tax: round2(raw.refund_tax),
        total_refund_impact: totalRefundImpact,
      },

      ad_spend: round2(raw.ad_spend),
      fee_details: raw.fee_details,
      transaction_types: [...raw.transaction_types] as TransactionType[],

      event_group_id: raw.event_group_id,
      settlement_id: raw.settlement_id,
      event_count: raw.event_count,

      // Financial lifecycle — populated from order metadata
      financial_status: (orderMap.get(raw.order_id)?.financial_status || 'OPEN') as OrderRevenueRecord['financial_status'],
      return_deadline: orderMap.get(raw.order_id)?.return_deadline || null,
      financial_closed_at: orderMap.get(raw.order_id)?.financial_closed_at || null,
      settlement_status: (orderMap.get(raw.order_id)?.settlement_status || 'Unsettled') as OrderRevenueRecord['settlement_status'],

      calculations: {
        gross_revenue: grossRevenue,
        total_fees: totalFees,
        total_taxes: totalTaxes,
        total_other_charges: otherChargesTotal,
        total_refund_impact: totalRefundImpact,
        total_ad_spend: round2(raw.ad_spend),
        net_settlement: netSettlement,
      },
    };

    records.push(record);
  }

  // Filter out NO_ORDER with zero values
  const filteredRecords = records.filter(r =>
    r.order_id !== 'NO_ORDER' ||
    r.calculations.gross_revenue !== 0 ||
    r.calculations.total_fees !== 0 ||
    r.return_details.refund_amount !== 0
  );

  // ── Step 5: Summary ──
  const summary = buildSummary(filteredRecords);

  // ── Step 6: SKU Summary ──
  const skuSummary = buildSKUSummary(filteredRecords);

  // ── Step 7: Waterfall ──
  const waterfall = buildWaterfall(summary);

  return {
    records: filteredRecords,
    summary,
    skuSummary,
    waterfall,
  };
}

// ── Summary Builder ──────────────────────────────────────────────────────────

function buildSummary(records: OrderRevenueRecord[]): RevenueSummary {
  const txnTypeCounts: Record<string, number> = {};

  for (const r of records) {
    for (const t of r.transaction_types) {
      txnTypeCounts[t] = (txnTypeCounts[t] || 0) + 1;
    }
  }

  const totalProductSales = round2(records.reduce((s, r) => s + r.product_sales, 0));
  const totalShippingCredits = round2(records.reduce((s, r) => s + r.shipping_credits, 0));
  const totalGiftWrap = round2(records.reduce((s, r) => s + r.gift_wrap_credits, 0));
  const grossRevenue = round2(records.reduce((s, r) => s + r.calculations.gross_revenue, 0));
  const totalPromotionalRebates = round2(records.reduce((s, r) => s + r.promotional_rebates, 0));

  const totalReferralFees = round2(records.reduce((s, r) => s + r.amazon_fees.referral_fee, 0));
  const totalClosingFees = round2(records.reduce((s, r) => s + r.amazon_fees.closing_fee, 0));
  const totalFbaFees = round2(records.reduce((s, r) => s + r.amazon_fees.fba_fee, 0));
  const totalEasyShipFees = round2(records.reduce((s, r) => s + r.amazon_fees.easy_ship_fee, 0));
  const totalWeightHandling = round2(records.reduce((s, r) => s + r.amazon_fees.weight_handling_fee, 0));
  const totalTechnologyFees = round2(records.reduce((s, r) => s + r.amazon_fees.technology_fee, 0));
  const totalAmazonFees = round2(records.reduce((s, r) => s + r.amazon_fees.total, 0));

  const totalShippingChargeback = round2(records.reduce((s, r) => s + r.other_charges.shipping_chargeback, 0));
  const totalStorageFees = round2(records.reduce((s, r) => s + r.other_charges.storage_fees, 0));
  const totalAdjustmentFees = round2(records.reduce((s, r) => s + r.other_charges.adjustment_fees, 0));
  const totalOtherFees = round2(records.reduce((s, r) => s + r.other_charges.other_fees, 0));
  const totalOtherCharges = round2(records.reduce((s, r) => s + r.other_charges.total, 0));

  const totalGst = round2(records.reduce((s, r) => s + r.taxes.gst, 0));
  const totalTcs = round2(records.reduce((s, r) => s + r.taxes.tcs, 0));
  const totalTds = round2(records.reduce((s, r) => s + r.taxes.tds, 0));
  const totalTaxes = round2(records.reduce((s, r) => s + r.taxes.total, 0));

  const totalRefundAmount = round2(records.reduce((s, r) => s + r.return_details.refund_amount, 0));
  const totalRefundCommission = round2(records.reduce((s, r) => s + r.return_details.refund_commission, 0));
  const totalReturnProcessing = round2(records.reduce((s, r) => s + r.return_details.return_processing_fee, 0));
  const totalRefundImpact = round2(records.reduce((s, r) => s + r.return_details.total_refund_impact, 0));

  const returnedOrders = records.filter(r => r.return_details.is_returned).length;
  const rtoOrders = records.filter(r => r.return_details.return_type === 'RTO').length;
  const customerReturns = records.filter(r => r.return_details.return_type === 'Customer Return').length;

  const totalAdSpend = round2(records.reduce((s, r) => s + r.ad_spend, 0));
  const netSettlement = round2(records.reduce((s, r) => s + r.calculations.net_settlement, 0));

  return {
    total_orders: new Set(records.map(r => r.order_id)).size,
    total_skus: new Set(records.map(r => r.sku)).size,
    total_units: records.reduce((s, r) => s + r.quantity, 0),

    total_product_sales: totalProductSales,
    total_shipping_credits: totalShippingCredits,
    total_gift_wrap: totalGiftWrap,
    gross_revenue: grossRevenue,
    total_promotional_rebates: totalPromotionalRebates,

    total_referral_fees: totalReferralFees,
    total_closing_fees: totalClosingFees,
    total_fba_fees: totalFbaFees,
    total_easy_ship_fees: totalEasyShipFees,
    total_weight_handling: totalWeightHandling,
    total_technology_fees: totalTechnologyFees,
    total_amazon_fees: totalAmazonFees,

    total_shipping_chargeback: totalShippingChargeback,
    total_storage_fees: totalStorageFees,
    total_adjustment_fees: totalAdjustmentFees,
    total_other_fees: totalOtherFees,
    total_other_charges: totalOtherCharges,

    total_gst: totalGst,
    total_tcs: totalTcs,
    total_tds: totalTds,
    total_taxes: totalTaxes,

    total_refund_amount: totalRefundAmount,
    total_refund_commission: totalRefundCommission,
    total_return_processing: totalReturnProcessing,
    total_refund_impact: totalRefundImpact,
    returned_orders: returnedOrders,
    rto_orders: rtoOrders,
    customer_returns: customerReturns,
    return_rate: records.length > 0 ? round2((returnedOrders / records.length) * 100) : 0,

    total_ad_spend: totalAdSpend,

    net_settlement: netSettlement,

    transaction_type_counts: txnTypeCounts as Record<TransactionType, number>,
  };
}

// ── SKU Summary Builder ──────────────────────────────────────────────────────

function buildSKUSummary(records: OrderRevenueRecord[]): SKURevenueSummary[] {
  const skuMap = new Map<string, SKURevenueSummary>();

  for (const r of records) {
    if (!skuMap.has(r.sku)) {
      skuMap.set(r.sku, {
        sku: r.sku,
        asin: r.asin,
        product_name: r.product_name,
        category: r.category,
        total_orders: 0,
        total_units: 0,
        product_sales: 0,
        shipping_credits: 0,
        gift_wrap_credits: 0,
        gross_revenue: 0,
        promotional_rebates: 0,
        referral_fee: 0,
        fba_fee: 0,
        closing_fee: 0,
        easy_ship_fee: 0,
        other_fees: 0,
        total_fees: 0,
        total_taxes: 0,
        refund_amount: 0,
        refund_count: 0,
        rto_count: 0,
        return_rate: 0,
        ad_spend: 0,
        net_settlement: 0,
        margin_percent: 0,
        avg_revenue_per_order: 0,
      });
    }

    const s = skuMap.get(r.sku)!;
    s.total_orders++;
    s.total_units += r.quantity;
    s.product_sales += r.product_sales;
    s.shipping_credits += r.shipping_credits;
    s.gift_wrap_credits += r.gift_wrap_credits;
    s.gross_revenue += r.calculations.gross_revenue;
    s.promotional_rebates += r.promotional_rebates;
    s.referral_fee += r.amazon_fees.referral_fee;
    s.fba_fee += r.amazon_fees.fba_fee;
    s.closing_fee += r.amazon_fees.closing_fee;
    s.easy_ship_fee += r.amazon_fees.easy_ship_fee;
    s.other_fees += r.other_charges.total;
    s.total_fees += r.calculations.total_fees;
    s.total_taxes += r.taxes.total;
    s.refund_amount += r.return_details.total_refund_impact;
    if (r.return_details.is_returned) s.refund_count++;
    if (r.return_details.return_type === 'RTO') s.rto_count++;
    s.ad_spend += r.ad_spend;
    s.net_settlement += r.calculations.net_settlement;
  }

  const result: SKURevenueSummary[] = [];
  for (const s of skuMap.values()) {
    s.product_sales = round2(s.product_sales);
    s.shipping_credits = round2(s.shipping_credits);
    s.gift_wrap_credits = round2(s.gift_wrap_credits);
    s.gross_revenue = round2(s.gross_revenue);
    s.promotional_rebates = round2(s.promotional_rebates);
    s.referral_fee = round2(s.referral_fee);
    s.fba_fee = round2(s.fba_fee);
    s.closing_fee = round2(s.closing_fee);
    s.easy_ship_fee = round2(s.easy_ship_fee);
    s.other_fees = round2(s.other_fees);
    s.total_fees = round2(s.total_fees);
    s.total_taxes = round2(s.total_taxes);
    s.refund_amount = round2(s.refund_amount);
    s.ad_spend = round2(s.ad_spend);
    s.net_settlement = round2(s.net_settlement);
    s.return_rate = s.total_orders > 0 ? round2((s.refund_count / s.total_orders) * 100) : 0;
    s.margin_percent = s.gross_revenue > 0 ? round2((s.net_settlement / s.gross_revenue) * 100) : 0;
    s.avg_revenue_per_order = s.total_orders > 0 ? round2(s.net_settlement / s.total_orders) : 0;
    result.push(s);
  }

  // Sort by net_settlement descending
  result.sort((a, b) => b.net_settlement - a.net_settlement);
  return result;
}

// ── Waterfall Builder ────────────────────────────────────────────────────────

function buildWaterfall(summary: RevenueSummary): WaterfallStep[] {
  const steps: WaterfallStep[] = [];
  let running = 0;

  // Revenue components
  const addStep = (name: string, value: number, type: WaterfallStep['type']) => {
    const start = running;
    running += value;
    steps.push({ name, value, type, start: round2(start), end: round2(running) });
  };

  addStep('Product Sales', summary.total_product_sales, 'revenue');
  if (summary.total_shipping_credits > 0) {
    addStep('Shipping Credits', summary.total_shipping_credits, 'revenue');
  }
  if (summary.total_gift_wrap > 0) {
    addStep('Gift Wrap', summary.total_gift_wrap, 'revenue');
  }
  if (summary.total_promotional_rebates !== 0) {
    addStep('Promotions', summary.total_promotional_rebates, 'deduction');
  }

  // Fees
  if (summary.total_referral_fees > 0) {
    addStep('Referral Fees', -summary.total_referral_fees, 'deduction');
  }
  if (summary.total_fba_fees > 0) {
    addStep('FBA Fees', -summary.total_fba_fees, 'deduction');
  }
  if (summary.total_closing_fees > 0) {
    addStep('Closing Fees', -summary.total_closing_fees, 'deduction');
  }
  if (summary.total_easy_ship_fees > 0) {
    addStep('Easy Ship', -summary.total_easy_ship_fees, 'deduction');
  }
  if (summary.total_weight_handling > 0) {
    addStep('Weight Handling', -summary.total_weight_handling, 'deduction');
  }
  if (summary.total_shipping_chargeback > 0) {
    addStep('Shipping Chargeback', -summary.total_shipping_chargeback, 'deduction');
  }
  if (summary.total_other_fees > 0) {
    addStep('Other Fees', -summary.total_other_fees, 'deduction');
  }

  // Taxes
  if (summary.total_taxes > 0) {
    addStep('Taxes (GST+TCS+TDS)', -summary.total_taxes, 'tax');
  }

  // Refunds
  if (summary.total_refund_impact > 0) {
    addStep('Refunds', -summary.total_refund_impact, 'refund');
  }

  // Ad spend
  if (summary.total_ad_spend > 0) {
    addStep('Ad Spend', -summary.total_ad_spend, 'deduction');
  }

  // Net
  steps.push({
    name: 'Net Settlement',
    value: round2(running),
    type: 'net',
    start: 0,
    end: round2(running),
  });

  return steps;
}
