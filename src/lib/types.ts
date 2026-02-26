// ── Shared Types ──────────────────────────────────────

export interface KPIData {
    label: string;
    value: string;
    change: number;        // % change vs previous period
    trend: 'up' | 'down' | 'flat';
    icon: string;
    prefix?: string;
}

export interface RevenueDataPoint {
    date: string;
    amazon: number;
    shopify: number;
    walmart: number;
    total: number;
}

export interface PlatformSales {
    name: string;
    value: number;
    color: string;
}

export interface OrderStatusData {
    status: string;
    count: number;
    color: string;
}

export interface Order {
    id: string;
    date: string;
    platform: string;
    customer: string;
    items: number;
    total: number;
    currency: string;
    status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'returned' | 'cancelled';
}

export interface InventoryItem {
    sku: string;
    name: string;
    image: string;
    platform: string;
    unitsSold: number;
    revenue: number;
    stock: number;
    maxStock: number;
    status: 'in-stock' | 'low-stock' | 'out-of-stock';
}

export interface Alert {
    id: string;
    type: 'warning' | 'critical' | 'info';
    title: string;
    message: string;
    timestamp: string;
}

export type DateRange = 'today' | '7d' | '30d' | '90d' | '1y' | 'custom';
export type Platform = 'all' | 'amazon' | 'shopify' | 'walmart';

// ── Command Center Types ─────────────────────────────

export type RevenueState = 'live' | 'locked';

export interface DualStateMetric {
    live: number;
    locked: number;
}

export interface RevenueStateBreakdown {
    pending: number;
    at_risk: number;
    locked: number;
    refunded: number;
}

export interface CommandCenterKPI {
    label: string;
    live_value: number;
    locked_value: number;
    live_change: number;
    locked_change: number;
    prefix?: string;
    suffix?: string;
    format?: 'currency' | 'number' | 'percent';
}

export interface WaterfallItem {
    name: string;
    value: number;
    type: 'revenue' | 'deduction' | 'net';
}

export interface SKUMetric {
    sku: string;
    title: string;
    revenue_live: number;
    revenue_locked: number;
    units_sold_live: number;
    units_sold_locked: number;
    refund_amount: number;
    ad_spend: number;
    net_contribution: number;
    margin_percent: number;
    tacos: number;
    roas: number;
    return_rate: number;
    priority: 'scale' | 'volume_risk' | 'premium_niche' | 'kill';
    available_stock: number;
    days_inventory: number;
}

export interface InventoryRisk {
    sku: string;
    title: string;
    available_units: number;
    avg_daily_sales_7d: number;
    days_inventory: number;
    risk_status: 'red' | 'yellow' | 'green';
}

export interface CommandCenterAlert {
    id: string;
    sku: string | null;
    alert_type: string;
    alert_status: 'active' | 'acknowledged' | 'resolved';
    severity: 'info' | 'warning' | 'critical';
    title: string;
    message: string;
    trigger_value: number | null;
    threshold_value: number | null;
    created_at: string;
}

export interface DailyTrend {
    date: string;
    revenue_live: number;
    revenue_locked: number;
    units_live: number;
    units_locked: number;
}

export interface FinancialSummary {
    total_revenue_live: number;
    total_revenue_locked: number;
    total_fees: number;
    total_refund_amount: number;
    total_ad_spend: number;
    net_contribution_live: number;
    net_contribution_locked: number;
    total_profit: number;
}

export interface BreakdownItem {
    label: string;
    value: number;
    kind: 'positive' | 'negative' | 'total';
}

export interface CommandCenterData {
    kpis: CommandCenterKPI[];
    revenue_breakdown: RevenueStateBreakdown;
    waterfall: WaterfallItem[];
    financial_summary: FinancialSummary;
    net_contribution_breakdown: BreakdownItem[];
    total_profit_breakdown: BreakdownItem[];
    daily_trends: DailyTrend[];
    period: string;
}
