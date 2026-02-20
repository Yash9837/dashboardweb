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
