import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
    return clsx(inputs);
}

export function formatCurrency(value: number, currency = 'INR'): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

export function formatNumber(value: number): string {
    return new Intl.NumberFormat('en-IN').format(value);
}

export function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

export function formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function getStatusColor(status: string): string {
    const colors: Record<string, string> = {
        delivered: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
        shipped: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20',
        processing: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
        pending: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
        returned: 'bg-red-500/15 text-red-400 border-red-500/20',
        cancelled: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
        'in-stock': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
        'low-stock': 'bg-amber-500/15 text-amber-400 border-amber-500/20',
        'out-of-stock': 'bg-red-500/15 text-red-400 border-red-500/20',
    };
    return colors[status] || 'bg-slate-500/15 text-slate-400';
}

/**
 * Map Amazon SP-API order status to a display-friendly string.
 * Accepts either a status string or an order object with OrderStatus/EasyShipShipmentStatus.
 */
export function mapOrderStatus(input: string | { OrderStatus?: string; EasyShipShipmentStatus?: string }): string {
    if (typeof input === 'string') {
        const map: Record<string, string> = {
            Shipped: 'delivered',
            Unshipped: 'processing',
            Pending: 'pending',
            Canceled: 'cancelled',
            Cancelled: 'cancelled',
            PartiallyShipped: 'shipped',
            InvoiceUnconfirmed: 'processing',
            Unfulfillable: 'cancelled',
        };
        return map[input] || 'pending';
    }

    // Order object mode — check EasyShipShipmentStatus first for more detail
    const order = input;
    if (order.OrderStatus === 'Canceled') return 'cancelled';
    if (order.EasyShipShipmentStatus === 'Delivered') return 'delivered';
    if (order.EasyShipShipmentStatus === 'ReturningToSeller' || order.EasyShipShipmentStatus === 'ReturnedToSeller') return 'returned';
    if (order.OrderStatus === 'Shipped') return 'shipped';
    if (order.OrderStatus === 'Unshipped') return 'processing';
    return 'pending';
}

/**
 * Format a number as INR currency string.
 */
export function formatINR(amount: number | string): string {
    const parsed = typeof amount === 'string' ? parseFloat(amount.replace(/[^0-9.-]/g, '')) : amount;
    const n = Number.isFinite(parsed) ? parsed : 0;
    return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
