// ============================================================================
// Revenue Calculator — Types & Interfaces
// Complete Per-Order/SKU Revenue Calculation System
// ============================================================================

// ── Transaction Types ────────────────────────────────────────────────────────

export type TransactionType =
  | 'Order'
  | 'Refund'
  | 'ShippingServices'
  | 'ServiceFee'
  | 'Adjustment'
  | 'Chargeback'
  | 'Retrocharge';

// ── Per-Order/SKU Revenue Record ─────────────────────────────────────────────

export interface OrderRevenueRecord {
  // ── Identifiers ──
  order_id: string;
  sku: string;
  asin: string;
  product_name: string;
  category: string;
  brand: string;
  quantity: number;

  // ── Dates ──
  order_date: string | null;
  shipment_date: string | null;
  delivery_date: string | null;
  posted_date: string | null;

  // ── Status ──
  order_status: string;
  fulfillment_channel: string;
  is_prime: boolean;

  // ── Product Sales (Gross Revenue Components) ──
  product_sales: number;       // Principal
  shipping_credits: number;    // ShippingCharge / ShippingCredit
  gift_wrap_credits: number;   // GiftWrap

  // ── Promotional Rebates ──
  promotional_rebates: number; // Already negative from Amazon

  // ── Taxes ──
  taxes: TaxBreakdown;

  // ── Amazon Fees ──
  amazon_fees: AmazonFeeBreakdown;

  // ── Other Charges ──
  other_charges: OtherChargesBreakdown;

  // ── Return Details ──
  return_details: ReturnDetails;

  // ── Advertising Cost ──
  ad_spend: number;

  // ── Fee Detail Map (raw audit trail) ──
  fee_details: Record<string, number>;

  // ── Transaction Types Seen ──
  transaction_types: TransactionType[];

  // ── Settlement Link ──
  event_group_id: string | null;
  settlement_id: string | null;
  event_count: number;

  // ── Financial Lifecycle (Closed Order Detection) ──
  financial_status: 'OPEN' | 'DELIVERED_PENDING_SETTLEMENT' | 'FINANCIALLY_CLOSED';
  return_deadline: string | null;
  financial_closed_at: string | null;
  settlement_status: 'Unsettled' | 'Open' | 'Closed';

  // ── Final Calculations ──
  calculations: RevenueCalculations;
}

export interface TaxBreakdown {
  gst: number;
  tcs: number;
  tds: number;
  total: number;
}

export interface AmazonFeeBreakdown {
  referral_fee: number;
  closing_fee: number;
  fba_fee: number;
  easy_ship_fee: number;
  weight_handling_fee: number;
  technology_fee: number;
  total: number;
}

export interface OtherChargesBreakdown {
  shipping_chargeback: number;
  adjustment_fees: number;
  storage_fees: number;
  removal_fees: number;
  long_term_storage_fees: number;
  other_fees: number;
  total: number;
}

export interface ReturnDetails {
  is_returned: boolean;
  return_date: string | null;
  return_type: 'Customer Return' | 'RTO' | null;
  refund_amount: number;
  refund_commission: number;
  return_processing_fee: number;
  refund_shipping: number;
  refund_tax: number;
  total_refund_impact: number;
}

export interface RevenueCalculations {
  gross_revenue: number;
  total_fees: number;
  total_taxes: number;
  total_other_charges: number;
  total_refund_impact: number;
  total_ad_spend: number;
  net_settlement: number;
}

// ── Summary Aggregations ─────────────────────────────────────────────────────

export interface RevenueSummary {
  // Counts
  total_orders: number;
  total_skus: number;
  total_units: number;

  // Revenue
  total_product_sales: number;
  total_shipping_credits: number;
  total_gift_wrap: number;
  gross_revenue: number;
  total_promotional_rebates: number;

  // Amazon Fees
  total_referral_fees: number;
  total_closing_fees: number;
  total_fba_fees: number;
  total_easy_ship_fees: number;
  total_weight_handling: number;
  total_technology_fees: number;
  total_amazon_fees: number;

  // Other Charges
  total_shipping_chargeback: number;
  total_storage_fees: number;
  total_adjustment_fees: number;
  total_other_fees: number;
  total_other_charges: number;

  // Taxes
  total_gst: number;
  total_tcs: number;
  total_tds: number;
  total_taxes: number;

  // Returns
  total_refund_amount: number;
  total_refund_commission: number;
  total_return_processing: number;
  total_refund_impact: number;
  returned_orders: number;
  rto_orders: number;
  customer_returns: number;
  return_rate: number;

  // Advertising
  total_ad_spend: number;

  // Net
  net_settlement: number;

  // Transaction type counts
  transaction_type_counts: Record<TransactionType, number>;
}

// ── SKU Performance Summary ──────────────────────────────────────────────────

export interface SKURevenueSummary {
  sku: string;
  asin: string;
  product_name: string;
  category: string;

  total_orders: number;
  total_units: number;

  product_sales: number;
  shipping_credits: number;
  gift_wrap_credits: number;
  gross_revenue: number;

  promotional_rebates: number;

  referral_fee: number;
  fba_fee: number;
  closing_fee: number;
  easy_ship_fee: number;
  other_fees: number;
  total_fees: number;

  total_taxes: number;

  refund_amount: number;
  refund_count: number;
  rto_count: number;
  return_rate: number;

  ad_spend: number;

  net_settlement: number;
  margin_percent: number;
  avg_revenue_per_order: number;
}

// ── Settlement Reconciliation ────────────────────────────────────────────────

export interface SettlementPeriod {
  settlement_id: string;
  period_start: string;
  period_end: string;
  fund_transfer_date: string | null;
  total_amount: number;
  processing_status: 'Open' | 'Closed';
  order_count: number;
  refund_count: number;
  fee_total: number;
  net_payout: number;
}

export interface SettlementDetail {
  settlement_id: string;
  amazon_order_id: string;
  sku: string;
  transaction_type: TransactionType;
  amount_description: string;
  amount: number;
  posted_date: string;
}

// ── Waterfall Chart Data ─────────────────────────────────────────────────────

export interface WaterfallStep {
  name: string;
  value: number;
  type: 'revenue' | 'deduction' | 'net' | 'tax' | 'refund';
  start?: number;
  end?: number;
}

// ── API Response ─────────────────────────────────────────────────────────────

export interface RevenueCalculatorResponse {
  records: OrderRevenueRecord[];
  summary: RevenueSummary;
  sku_summary: SKURevenueSummary[];
  waterfall: WaterfallStep[];
  settlements: SettlementPeriod[];
  lifecycle_stats?: {
    total_orders: number;
    open: number;
    delivered_pending_settlement: number;
    financially_closed: number;
    closure_rate: number;
  };
  pagination: {
    page: number;
    pageSize: number;
    totalRecords: number;
    totalPages: number;
  };
  period: {
    start: string;
    end: string;
  };
}

// ── Tab types for UI ─────────────────────────────────────────────────────────

export type RevenueTab = 'orders' | 'sku-summary' | 'settlements' | 'waterfall';
