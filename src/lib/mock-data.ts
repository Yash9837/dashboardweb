import type {
    KPIData,
    RevenueDataPoint,
    PlatformSales,
    OrderStatusData,
    Order,
    InventoryItem,
    Alert,
} from './types';

// ── KPI Cards ─────────────────────────────────────────
export const kpiData: KPIData[] = [
    { label: 'Total Revenue', value: '₹4,82,350', change: 12.5, trend: 'up', icon: 'indian-rupee', prefix: '' },
    { label: 'Total Orders', value: '1,247', change: 8.2, trend: 'up', icon: 'shopping-cart' },
    { label: 'Avg. Order Value', value: '₹386.80', change: 3.1, trend: 'up', icon: 'trending-up' },
    { label: 'Returns / Refunds', value: '43', change: -2.4, trend: 'down', icon: 'package-x' },
    { label: 'Inventory Value', value: '₹12,45,000', change: 0.8, trend: 'flat', icon: 'warehouse' },
    { label: 'Active Listings', value: '328', change: 5.6, trend: 'up', icon: 'list-checks' },
];

// ── Revenue Trend ─────────────────────────────────────
export const revenueData: RevenueDataPoint[] = [
    { date: 'Jan 01', amazon: 32000, shopify: 12000, walmart: 0, total: 44000 },
    { date: 'Jan 08', amazon: 38000, shopify: 14000, walmart: 0, total: 52000 },
    { date: 'Jan 15', amazon: 35000, shopify: 16000, walmart: 0, total: 51000 },
    { date: 'Jan 22', amazon: 42000, shopify: 13000, walmart: 0, total: 55000 },
    { date: 'Jan 29', amazon: 48000, shopify: 18000, walmart: 0, total: 66000 },
    { date: 'Feb 05', amazon: 41000, shopify: 15000, walmart: 0, total: 56000 },
    { date: 'Feb 12', amazon: 52000, shopify: 21000, walmart: 0, total: 73000 },
    { date: 'Feb 19', amazon: 46000, shopify: 19500, walmart: 0, total: 65500 },
    { date: 'Feb 26', amazon: 55000, shopify: 22000, walmart: 0, total: 77000 },
    { date: 'Mar 05', amazon: 49000, shopify: 20500, walmart: 0, total: 69500 },
    { date: 'Mar 12', amazon: 58000, shopify: 24000, walmart: 0, total: 82000 },
    { date: 'Mar 19', amazon: 53000, shopify: 22500, walmart: 0, total: 75500 },
];

// ── Platform Distribution ─────────────────────────────
export const platformSales: PlatformSales[] = [
    { name: 'Amazon', value: 549000, color: '#6366f1' },
    { name: 'Shopify', value: 217500, color: '#06b6d4' },
    { name: 'Walmart', value: 0, color: '#8b5cf6' },
    { name: 'Direct', value: 15850, color: '#f59e0b' },
];

// ── Order Status ──────────────────────────────────────
export const orderStatusData: OrderStatusData[] = [
    { status: 'Delivered', count: 876, color: '#22c55e' },
    { status: 'Shipped', count: 187, color: '#6366f1' },
    { status: 'Processing', count: 98, color: '#f59e0b' },
    { status: 'Pending', count: 43, color: '#94a3b8' },
    { status: 'Returned', count: 31, color: '#ef4444' },
    { status: 'Cancelled', count: 12, color: '#64748b' },
];

// ── Recent Orders ─────────────────────────────────────
export const recentOrders: Order[] = [
    { id: '171-1697240-3913908', date: '2026-02-18T13:33:00Z', platform: 'Amazon', customer: 'A. Pradesh Customer', items: 1, total: 299.00, currency: 'INR', status: 'delivered' },
    { id: '402-9167818-7877135', date: '2026-02-18T03:30:00Z', platform: 'Amazon', customer: 'Maharashtra Customer', items: 2, total: 523.00, currency: 'INR', status: 'delivered' },
    { id: '408-5496125-1947545', date: '2026-02-17T03:46:00Z', platform: 'Amazon', customer: 'UP Customer', items: 1, total: 280.00, currency: 'INR', status: 'shipped' },
    { id: 'SH-10042', date: '2026-02-17T09:15:00Z', platform: 'Shopify', customer: 'Delhi Customer', items: 3, total: 1250.00, currency: 'INR', status: 'processing' },
    { id: '171-6309591-6251535', date: '2026-02-16T06:33:00Z', platform: 'Amazon', customer: 'Haryana Customer', items: 1, total: 299.00, currency: 'INR', status: 'delivered' },
    { id: 'SH-10041', date: '2026-02-16T14:20:00Z', platform: 'Shopify', customer: 'Karnataka Customer', items: 2, total: 890.00, currency: 'INR', status: 'shipped' },
    { id: '408-7383876-6197919', date: '2026-02-15T12:43:00Z', platform: 'Amazon', customer: 'Kerala Customer', items: 1, total: 192.60, currency: 'INR', status: 'returned' },
    { id: '402-5254805-0011532', date: '2026-02-15T16:22:00Z', platform: 'Amazon', customer: 'Karnataka Customer', items: 1, total: 248.00, currency: 'INR', status: 'delivered' },
    { id: 'SH-10040', date: '2026-02-14T08:10:00Z', platform: 'Shopify', customer: 'Tamil Nadu Customer', items: 1, total: 450.00, currency: 'INR', status: 'delivered' },
    { id: '408-7223860-6401149', date: '2026-02-14T00:04:00Z', platform: 'Amazon', customer: 'Tamil Nadu Customer', items: 2, total: 299.00, currency: 'INR', status: 'delivered' },
];

// ── Inventory Items ───────────────────────────────────
export const inventoryItems: InventoryItem[] = [
    { sku: 'EARR-272', name: 'Elegant Black Gold Leaf Earrings', image: '', platform: 'Amazon', unitsSold: 142, revenue: 41158, stock: 23, maxStock: 100, status: 'low-stock' },
    { sku: 'EARR-444', name: 'Pearl Hoop Earrings Gold Tone', image: '', platform: 'Amazon', unitsSold: 98, revenue: 23618, stock: 65, maxStock: 100, status: 'in-stock' },
    { sku: 'EARR-591', name: 'Gold Plated Beads Hoop Earrings', image: '', platform: 'Amazon', unitsSold: 87, revenue: 22533, stock: 8, maxStock: 100, status: 'low-stock' },
    { sku: 'BG-MATH', name: 'Brain Gain Math Games & Toys', image: '', platform: 'Amazon', unitsSold: 54, revenue: 16146, stock: 0, maxStock: 50, status: 'out-of-stock' },
    { sku: 'BG-FIX', name: 'Brain Gain Fix The Pattern Games', image: '', platform: 'Amazon', unitsSold: 43, revenue: 11137, stock: 0, maxStock: 50, status: 'out-of-stock' },
    { sku: 'SH-NKL-001', name: 'Layered Chain Necklace Set', image: '', platform: 'Shopify', unitsSold: 76, revenue: 34200, stock: 42, maxStock: 80, status: 'in-stock' },
    { sku: 'SH-BRC-002', name: 'Crystal Bracelet Stack', image: '', platform: 'Shopify', unitsSold: 62, revenue: 21700, stock: 15, maxStock: 60, status: 'low-stock' },
    { sku: 'SH-RNG-003', name: 'Vintage Gold Ring Collection', image: '', platform: 'Shopify', unitsSold: 38, revenue: 17100, stock: 55, maxStock: 70, status: 'in-stock' },
];

// ── Alerts ─────────────────────────────────────────────
export const alerts: Alert[] = [
    { id: '1', type: 'critical', title: 'Out of Stock', message: 'Brain Gain Math Games (BG-MATH) has 0 units remaining', timestamp: '2 hours ago' },
    { id: '2', type: 'critical', title: 'Out of Stock', message: 'Brain Gain Fix Pattern Games (BG-FIX) has 0 units remaining', timestamp: '2 hours ago' },
    { id: '3', type: 'warning', title: 'Low Stock Alert', message: 'Gold Plated Beads Hoop Earrings — only 8 units left', timestamp: '5 hours ago' },
    { id: '4', type: 'warning', title: 'Return Spike', message: 'Return rate increased 15% this week vs last week', timestamp: '1 day ago' },
    { id: '5', type: 'info', title: 'New Platform', message: 'Shopify integration is active and syncing data', timestamp: '3 days ago' },
];

// ── Performance Metrics ───────────────────────────────
export const platformPerformance = [
    { platform: 'Amazon', orders: 1089, revenue: 549000, returns: 38, fulfillmentRate: 96.2, avgDelivery: '2.4 days' },
    { platform: 'Shopify', orders: 158, revenue: 217500, returns: 5, fulfillmentRate: 98.7, avgDelivery: '3.1 days' },
];
