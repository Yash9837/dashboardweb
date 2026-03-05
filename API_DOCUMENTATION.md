# SmartDashboard External API Documentation

**Base URL:** `https://dashboardweb-gold.vercel.app`  
**Version:** 1.0  
**Data Source:** Amazon SP-API → Supabase (synced via `amazon-full-sync.mjs`)  
**Business Model:** FBM (Fulfilled by Merchant) — Amazon India  
**Currency:** INR (₹)

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Common Parameters & Filters](#2-common-parameters--filters)
3. [How Data is Calculated](#3-how-data-is-calculated)
4. [API Endpoints](#4-api-endpoints)
   - [4.1 Overview (All Data)](#41-overview--all-data-in-one-call)
   - [4.2 Business Dashboard](#42-business-dashboard)
   - [4.3 Traffic & Conversion](#43-traffic--conversion)
   - [4.4 Advertising Metrics](#44-advertising-metrics)
   - [4.5 Sales & Revenue](#45-sales--revenue)
   - [4.6 Inventory Metrics](#46-inventory-metrics)
   - [4.7 SKU Performance](#47-sku-performance)
5. [Error Handling](#5-error-handling)
6. [Rate Limits & Caching](#6-rate-limits--caching)
7. [Code Examples](#7-code-examples)

---

## 1. Authentication

Authentication is **optional by default**. If the `EXTERNAL_API_KEY` environment variable is set on Vercel, then every request must include a valid API key.

### Three ways to pass the API key:

| Method | Example |
|--------|---------|
| **Header (recommended)** | `X-API-Key: sk_live_your_key_here` |
| **Bearer Token** | `Authorization: Bearer sk_live_your_key_here` |
| **Query Parameter** | `?api_key=sk_live_your_key_here` |

### Unauthorized Response (401):
```json
{
  "success": false,
  "error": "Invalid or missing API key. Pass via X-API-Key header or api_key query param.",
  "timestamp": "2026-03-03T10:00:00.000Z"
}
```

### CORS
All endpoints return `Access-Control-Allow-Origin: *` — they can be called from any domain (browser, mobile app, server, Postman, etc.).

---

## 2. Common Parameters & Filters

### Period Filter (applies to ALL endpoints)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | string | `30d` | Time window for data |

**Accepted values:**

| Value | Window | Comparison Period | Chart Granularity |
|-------|--------|-------------------|-------------------|
| `1d` | Today (since midnight IST) | Yesterday | Daily |
| `7d` | Last 7 days | Previous 7 days | Daily |
| `30d` | Last 30 days | Previous 30 days | Daily |
| `90d` | Last 90 days | Previous 90 days | Weekly |
| `1y` | Last 365 days | Previous 365 days | Monthly |

**How period works:**
- `currentStart` = Now minus `N` days
- `currentEnd` = Now
- `prevStart` = Now minus `2×N` days  
- `prevEnd` = Now minus `N` days
- For `1d`: current = today (IST midnight to now), previous = yesterday full day

### Change & Trend Fields

Most metric objects include:

| Field | Type | Description |
|-------|------|-------------|
| `value` | number | The metric value |
| `currency` | string | `"INR"` (only on monetary fields) |
| `unit` | string | `"%"` or `"days"` (only on percentage/duration fields) |
| `change` | number | Percentage change vs previous period (e.g., `12` = +12%) |
| `trend` | string | `"up"`, `"down"`, or `"flat"` |
| `note` | string | Explanation when data is unavailable |

**Change calculation:**
```
change = ((current - previous) / previous) × 100, rounded to integer
If previous = 0 and current > 0 → change = 100
If previous = 0 and current = 0 → change = 0
```

---

## 3. How Data is Calculated

### Data Pipeline

```
Amazon SP-API → amazon-full-sync.mjs → Supabase Tables → Dashboard Engine → API Response
```

### Database Tables Used

| Table | Purpose |
|-------|---------|
| `orders` | All Amazon orders with status, dates, shipping address |
| `order_items` | Line items per order (SKU, price, quantity) |
| `financial_events` | Shipment charges, fees, refunds from Finances API |
| `skus` | Master SKU catalog (name, ASIN, status) |
| `inventory_snapshots` | Latest inventory stock levels |

### Revenue Calculation

```
Revenue = orders.order_total (customer-facing selling price from Amazon OrderTotal.Amount)

Fallback: If order_total is missing →
  Revenue = SUM(order_items.item_price + order_items.shipping_price)
```

- **Revenue** = Gross selling price (what the customer pays). NOT net settlement.
- **Gross Profit** = Revenue × 30% (hardcoded PROFIT_MARGIN = 0.30)
- **Average Order Value** = Revenue ÷ Total Orders

### Units Sold

```
Units Sold = SUM(order_items.quantity_ordered) per order
Fallback: If no order_items → assumes 1 unit per order
```

### Returns Detection

```
An order is counted as "returned" if it has ANY row in financial_events
where event_type = 'refund' or 'Refund'
```

- **Return Rate** = (Returned Orders ÷ Total Orders) × 100
- **Cancel Rate** = (Cancelled Orders ÷ Total Orders) × 100

### Order Status Mapping

| Amazon Status | Mapped Status |
|---------------|---------------|
| `Canceled` / `Cancelled` | `cancelled` |
| `Delivered` or has `delivery_date` | `delivered` |
| `Shipped` | `shipped` |
| `Unshipped` | `processing` |
| Everything else | `pending` |

### Inventory Days Left

```
avgDailySales = unitsSold ÷ days (in selected period)
inventoryDaysLeft = totalUnits ÷ avgDailySales

If avgDailySales = 0 and stock > 0 → returns null (infinite days)
If avgDailySales = 0 and stock = 0 → returns 0
```

### Slow Movers

SKUs that have inventory stock > 0 but sold 0 units in the selected period.

### Aged Inventory

Count of slow mover SKUs (stock sitting unsold).

### Inventory Status

| Stock Level | Status |
|-------------|--------|
| 0 units | `out-of-stock` |
| 1–9 units | `low-stock` |
| 10+ units | `in-stock` |

### Revenue Trend (Chart Data)

Orders are grouped by date using the period's granularity:

| Period | Grouping | Date Format |
|--------|----------|-------------|
| `1d`, `7d`, `30d` | Daily | `YYYY-MM-DD` |
| `90d` | Weekly (Sunday start) | `YYYY-MM-DD` (week start date) |
| `1y` | Monthly | `YYYY-MM` |

Each data point: `{ date, revenue, orders, profit }`

### State-Wise Orders

Counted from `orders.ship_state` — how many orders shipped to each Indian state in the selected period. Sorted by count descending.

---

## 4. API Endpoints

---

### 4.1 Overview — All Data in One Call

**Best for:** External apps that need a complete dashboard snapshot.

```
GET /api/external/overview?period=30d
```

**Response Structure:**

```json
{
  "success": true,
  "period": "30d",
  "days": 30,
  "granularity": "daily",

  "businessDashboard": {
    "totalRevenue":   { "value": 42365, "currency": "INR", "change": 12, "trend": "up" },
    "grossProfit":    { "value": 12710, "currency": "INR" },
    "totalOrders":    { "value": 185, "change": 8, "trend": "up" },
    "unitsSold":      { "value": 220, "change": 15, "trend": "up" },
    "avgOrderValue":  { "value": 229, "currency": "INR" },
    "returns":        { "value": 3 },
    "cancellations":  { "value": 5 },
    "returnRate":     { "value": 1.6, "unit": "%" },
    "cancelRate":     { "value": 2.7, "unit": "%" },
    "adsSpend":       { "value": 0, "currency": "INR", "note": "Advertising API not connected" },
    "topProducts": [
      { "sku": "ABC-123", "name": "Product Name", "asin": "B0XXXXX", "revenue": 5000, "unitsSold": 25, "returns": 0 }
    ]
  },

  "trafficConversion": {
    "sessions":         { "value": 0, "note": "Requires Brand Analytics" },
    "pageViews":        { "value": 0, "note": "Requires Brand Analytics" },
    "conversionRate":   { "value": 0, "unit": "%", "note": "Requires Brand Analytics" },
    "detailPageViews":  { "value": 0, "note": "Requires Brand Analytics" },
    "stateWiseOrders": [
      { "state": "MAHARASHTRA", "count": 45 },
      { "state": "KARNATAKA", "count": 30 }
    ]
  },

  "advertising": {
    "impressions":  { "value": 0, "note": "Advertising API not connected" },
    "clicks":       { "value": 0 },
    "spend":        { "value": 0, "currency": "INR" },
    "salesFromAds": { "value": 0, "currency": "INR" },
    "acos":         { "value": 0, "unit": "%" },
    "roas":         { "value": 0 },
    "ctr":          { "value": 0, "unit": "%" },
    "cpc":          { "value": 0, "currency": "INR" }
  },

  "salesRevenue": {
    "revenueTrend": [
      { "date": "2026-02-01", "revenue": 1500, "orders": 7, "profit": 450 },
      { "date": "2026-02-02", "revenue": 2100, "orders": 9, "profit": 630 }
    ],
    "orderStatusDistribution": [
      { "status": "delivered", "count": 150 },
      { "status": "shipped", "count": 20 },
      { "status": "pending", "count": 10 },
      { "status": "cancelled", "count": 5 }
    ],
    "slowMovers": [
      { "sku": "SLOW-001", "name": "Slow Product", "stock": 15 }
    ],
    "inventoryDaysLeft": 45
  },

  "inventory": {
    "availableInventory": 1250,
    "inventoryDaysLeft": 45,
    "sellingType": { "fba": 0, "fbm": 1250 },
    "agedInventory": 3,
    "returnCount": 3,
    "totalSkus": 74,
    "outOfStock": 5,
    "lowStock": 8,
    "items": [
      { "sku": "ABC-123", "name": "Product Name", "stock": 50, "fulfillableQty": 50, "inboundQty": 0, "reservedQty": 0, "status": "in-stock" }
    ]
  },

  "skuPerformance": {
    "totalSkus": 74,
    "items": [
      { "sku": "ABC-123", "name": "Product Name", "asin": "B0XXXXX", "revenue": 5000, "unitsSold": 25, "returns": 0, "conversionRate": 0, "reviews": 0, "rating": 0, "bsr": 0 }
    ],
    "note": "Showing top 50 of 74. Use /api/external/sku-performance for paginated access."
  },

  "recentOrders": [
    { "orderId": "402-1234567-8901234", "date": "2026-03-02T14:30:00Z", "platform": "Amazon", "location": "Mumbai, MAHARASHTRA", "city": "Mumbai", "state": "MAHARASHTRA", "total": 599, "currency": "INR", "status": "delivered", "items": 2 }
  ],

  "timestamp": "2026-03-03T10:00:00.000Z"
}
```

---

### 4.2 Business Dashboard

**Best for:** KPI cards, headline metrics, top products widget.

```
GET /api/external/business-dashboard?period=30d
```

| Filter | Values | Default |
|--------|--------|---------|
| `period` | `1d`, `7d`, `30d`, `90d`, `1y` | `30d` |

**Response fields:**

| Metric | Calculation | Unit |
|--------|-------------|------|
| `totalRevenue` | Sum of `order_total` for all orders in period | INR |
| `grossProfit` | `totalRevenue × 0.30` (30% margin) | INR |
| `totalOrders` | Count of orders in period | count |
| `unitsSold` | Sum of `quantity_ordered` from order_items | count |
| `avgOrderValue` | `totalRevenue ÷ totalOrders` | INR |
| `returns` | Orders with refund events in `financial_events` | count |
| `cancellations` | Orders with status `Canceled`/`Cancelled` | count |
| `returnRate` | `(returns ÷ totalOrders) × 100` | % |
| `cancelRate` | `(cancellations ÷ totalOrders) × 100` | % |
| `adsSpend` | Always 0 (Advertising API not connected) | INR |

**`topProducts`** — Top 10 SKUs by revenue in the period:
```json
[{ "sku": "...", "name": "...", "asin": "...", "revenue": 5000, "unitsSold": 25, "returns": 0 }]
```

All metrics include `change` (% vs previous period) and `trend` (`up`/`down`/`flat`).

---

### 4.3 Traffic & Conversion

**Best for:** Geographic distribution of orders.

```
GET /api/external/traffic-conversion?period=30d
```

| Filter | Values | Default |
|--------|--------|---------|
| `period` | `1d`, `7d`, `30d`, `90d`, `1y` | `30d` |

**Response fields:**

| Metric | Status | Note |
|--------|--------|------|
| `sessions` | `0` | Requires Amazon Brand Analytics API (not connected) |
| `pageViews` | `0` | Requires Amazon Brand Analytics API |
| `conversionRate` | `0` | Unit Session Percentage — requires Brand Analytics |
| `detailPageViews` | `0` | Requires Amazon Brand Analytics API |

**`stateWiseOrders`** — Real data from shipping addresses:
```json
[
  { "state": "MAHARASHTRA", "count": 45 },
  { "state": "KARNATAKA", "count": 30 },
  { "state": "DELHI", "count": 22 }
]
```

**How state-wise is calculated:** Groups all orders in the period by `orders.ship_state`, counts per state, sorts by count descending.

`totalStates` — Number of unique states with orders.

---

### 4.4 Advertising Metrics

**Best for:** Placeholder until Amazon Advertising API is connected.

```
GET /api/external/advertising?period=30d
```

| Filter | Values | Default |
|--------|--------|---------|
| `period` | `1d`, `7d`, `30d`, `90d`, `1y` | `30d` |

**All metrics return 0** with descriptions:

| Metric | Description |
|--------|-------------|
| `impressions` | Total ad impressions |
| `clicks` | Total ad clicks |
| `spend` | Total advertising spend (INR) |
| `salesFromAds` | Revenue attributed to ads (INR) |
| `acos` | Advertising Cost of Sales = (spend ÷ salesFromAds) × 100 |
| `roas` | Return on Ad Spend = salesFromAds ÷ spend |
| `ctr` | Click-Through Rate = (clicks ÷ impressions) × 100 |
| `cpc` | Cost per Click = spend ÷ clicks |

> These will show real data once Amazon Advertising API is integrated.

---

### 4.5 Sales & Revenue

**Best for:** Revenue charts, order status pie chart, slow movers, top products.

```
GET /api/external/sales-revenue?period=30d
```

| Filter | Values | Default |
|--------|--------|---------|
| `period` | `1d`, `7d`, `30d`, `90d`, `1y` | `30d` |

**Response fields:**

| Field | Description |
|-------|-------------|
| `metrics.revenue` | Total revenue with change/trend vs previous period |
| `metrics.orders` | Total order count with change/trend |
| `metrics.sessions` | 0 (needs Brand Analytics) |
| `metrics.conversionRate` | 0 (needs Brand Analytics) |
| `metrics.inventoryDaysLeft` | Days of stock remaining at current sales rate. `null` if no sales. |
| `topProducts` | Top 10 SKUs by revenue: `[{ sku, name, asin, revenue, unitsSold }]` |
| `slowMovers` | SKUs with stock but 0 sales: `[{ sku, name, stock }]` |
| `revenueTrend` | Chart data points: `[{ date, revenue, orders, profit }]` |
| `orderStatusDistribution` | Pie chart data: `[{ status, count }]` |

**`revenueTrend` granularity:**
- `1d`–`30d` → daily points (`YYYY-MM-DD`)
- `90d` → weekly points (week start date)
- `1y` → monthly points (`YYYY-MM`)

**`orderStatusDistribution` statuses:**
`delivered`, `shipped`, `pending`, `returned`, `cancelled` (only non-zero included)

---

### 4.6 Inventory Metrics

**Best for:** Stock management, out-of-stock alerts, FBM inventory overview.

```
GET /api/external/inventory?period=30d
```

| Filter | Values | Default |
|--------|--------|---------|
| `period` | `1d`, `7d`, `30d`, `90d`, `1y` | `30d` |

**Response → `summary`:**

| Field | Description | Calculation |
|-------|-------------|-------------|
| `availableInventory` | Total units across all SKUs | Sum of latest `inventory_snapshots.available_quantity` |
| `inventoryDaysLeft` | Days of stock left | `totalUnits ÷ (unitsSold ÷ days)`. `null` if no sales velocity. |
| `sellingType.fba` | FBA units | Always `0` (business is 100% FBM) |
| `sellingType.fbm` | FBM units | Same as `availableInventory` |
| `agedInventory` | SKUs with stock but no sales | Count of slow movers |
| `returnCount` | Refunded orders in period | From `financial_events` refund detection |
| `totalSkus` | Total tracked SKUs | Count of SKUs in `inventory_snapshots` |
| `outOfStock` | SKUs with 0 stock | `available_quantity = 0` |
| `lowStock` | SKUs with 1–9 stock | `available_quantity < 10 AND > 0` |

**Response → `items`** (per-SKU inventory):

```json
[{
  "sku": "ABC-123",
  "name": "Product Name",
  "stock": 50,
  "fulfillableQty": 50,
  "inboundQty": 0,
  "reservedQty": 0,
  "status": "in-stock"
}]
```

| Status | Rule |
|--------|------|
| `in-stock` | stock ≥ 10 |
| `low-stock` | stock 1–9 |
| `out-of-stock` | stock = 0 |

---

### 4.7 SKU Performance

**Best for:** Product-level analytics table with sorting & pagination.

```
GET /api/external/sku-performance?period=30d&page=1&limit=50&sort=revenue&order=desc
```

**Filters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | string | `30d` | Time window |
| `page` | integer | `1` | Page number (1-indexed) |
| `limit` | integer | `50` | Items per page (min: 1, max: 200) |
| `sort` | string | `revenue` | Sort field: `revenue`, `unitsSold`, `returns`, `sku`, `name` |
| `order` | string | `desc` | Sort direction: `asc` or `desc` |

**Response:**

```json
{
  "success": true,
  "period": "30d",
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 74,
    "totalPages": 2,
    "hasNext": true,
    "hasPrev": false
  },
  "sort": { "field": "revenue", "order": "desc" },
  "items": [
    {
      "sku": "ABC-123",
      "name": "Product Name",
      "asin": "B0XXXXXXX",
      "revenue": 15000,
      "unitsSold": 75,
      "returns": 2,
      "conversionRate": 0,
      "reviews": 0,
      "rating": 0,
      "bsr": 0
    }
  ],
  "timestamp": "2026-03-03T10:00:00.000Z"
}
```

**Per-SKU fields:**

| Field | Calculation | Note |
|-------|-------------|------|
| `revenue` | Sum of `item_price + shipping_price` from `order_items` for that SKU in period | Rounded to integer |
| `unitsSold` | Sum of `quantity_ordered` from `order_items` for that SKU | Count |
| `returns` | Count of order_items linked to orders with refund events | Count |
| `conversionRate` | `0` | Requires Brand Analytics |
| `reviews` | `0` | Requires Product Advertising API |
| `rating` | `0` | Requires Product Advertising API |
| `bsr` | `0` | Requires Product Advertising API |

**Note:** All SKUs from the `skus` master table are included (even those with 0 sales), sorted by revenue by default.

**Pagination example — get page 2:**
```
GET /api/external/sku-performance?period=30d&page=2&limit=50&sort=revenue&order=desc
```

---

### 4.8 FBM Catalog — Inventory & SKU Details

**Best for:** Complete SKU catalog with FBM inventory levels, costs, and health metrics.

```
GET /api/external/fbm-catalog?page=1&limit=50&sort=stock&order=desc&status=all
```

**Filters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number (1-indexed) |
| `limit` | integer | `50` | Items per page (min: 1, max: 200) |
| `sort` | string | `stock` | Sort field: `sku`, `name`, `stock`, `daysInventory` |
| `order` | string | `desc` | Sort direction: `asc` or `desc` |
| `status` | string | `all` | Filter: `all`, `in-stock`, `low-stock`, `out-of-stock` |

**Response → `summary`:**

| Field | Description |
|-------|-------------|
| `totalSkus` | Total SKUs in catalog |
| `totalUnits` | Sum of all available stock |
| `inStock` | SKUs with stock ≥ 10 |
| `lowStock` | SKUs with stock 1–9 |
| `outOfStock` | SKUs with stock = 0 |
| `fulfillmentType` | Always `"FBM"` |

**Response → `items`** (per-SKU):

```json
[{
  "sku": "ABC-123",
  "asin": "B0XXXXXXX",
  "name": "Product Name",
  "category": "Electronics",
  "brand": "BrandName",
  "stock": 50,
  "inboundQty": 0,
  "reservedQty": 0,
  "status": "in-stock",
  "fulfillment": "FBM",
  "costs": {
    "costPerUnit": 150,
    "packagingCost": 10,
    "shippingCostInternal": 25,
    "totalCostPerUnit": 185
  },
  "health": {
    "avgDailySales7d": 2.5,
    "daysInventory": 20,
    "riskStatus": "green"
  }
}]
```

**Per-SKU fields:**

| Field | Source | Note |
|-------|--------|------|
| `category`, `brand` | `skus` table | May be empty if not set |
| `costs.costPerUnit` | `skus.cost_per_unit` | Product cost |
| `costs.packagingCost` | `skus.packaging_cost` | Packaging cost |
| `costs.shippingCostInternal` | `skus.shipping_cost_internal` | Internal shipping cost |
| `costs.totalCostPerUnit` | Sum of above 3 costs | Total landed cost |
| `health.avgDailySales7d` | `inventory_health` table | 7-day average daily sales |
| `health.daysInventory` | `inventory_health` table | Days of stock remaining |
| `health.riskStatus` | `inventory_health` table | `"red"`, `"yellow"`, or `"green"` |

**Pagination** — same format as SKU Performance endpoint.

---

## 5. Error Handling

### Success Response

```json
{
  "success": true,
  "period": "30d",
  "days": 30,
  ...data...,
  "timestamp": "2026-03-03T10:00:00.000Z"
}
```

### Error Response

```json
{
  "success": false,
  "error": "Error message describing what went wrong",
  "timestamp": "2026-03-03T10:00:00.000Z"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `401` | Invalid or missing API key |
| `500` | Server error (database timeout, Supabase issue, etc.) |

---

## 6. Rate Limits & Caching

### Caching
- All endpoints cache responses **server-side** for ~5 minutes (dashboard TTL).
- First call after cache expires will be slower (queries Supabase).
- Subsequent calls within the TTL return instantly from cache.
- Each `period` value has its own cache key (e.g., `ext_business_30d`, `ext_business_7d`).

### Rate Limits
- **Vercel Hobby Plan:** 10-second function timeout.
- **No explicit rate limiting** on the API itself — but Vercel has serverless invocation limits.
- Recommended: Cache responses on your end for at least 5 minutes.

### Performance Tips
- Use `/api/external/overview` if you need all 6 sections — it's **one call** instead of six.
- Use `/api/external/sku-performance` with pagination for large SKU catalogs.
- Avoid calling all 7 endpoints in parallel — use Overview instead.

---

## 7. Code Examples

### JavaScript / Node.js

```javascript
const API_BASE = 'https://dashboardweb-gold.vercel.app/api/external';
const API_KEY = 'your_api_key_here'; // omit if no key is set

// Get complete dashboard
async function getDashboard(period = '30d') {
  const res = await fetch(`${API_BASE}/overview?period=${period}`, {
    headers: { 'X-API-Key': API_KEY }
  });
  const data = await res.json();
  
  if (!data.success) throw new Error(data.error);
  
  console.log('Revenue:', data.businessDashboard.totalRevenue.value);
  console.log('Orders:', data.businessDashboard.totalOrders.value);
  console.log('Top State:', data.trafficConversion.stateWiseOrders[0]?.state);
  console.log('Inventory:', data.inventory.availableInventory, 'units');
  
  return data;
}

// Get paginated SKU data
async function getAllSkus(period = '30d') {
  let page = 1;
  let allItems = [];
  
  while (true) {
    const res = await fetch(
      `${API_BASE}/sku-performance?period=${period}&page=${page}&limit=100&sort=revenue&order=desc`,
      { headers: { 'X-API-Key': API_KEY } }
    );
    const data = await res.json();
    allItems.push(...data.items);
    
    if (!data.pagination.hasNext) break;
    page++;
  }
  
  console.log(`Loaded ${allItems.length} SKUs`);
  return allItems;
}
```

### Python

```python
import requests

API_BASE = "https://dashboardweb-gold.vercel.app/api/external"
API_KEY = "your_api_key_here"

headers = {"X-API-Key": API_KEY}

# Get business metrics
resp = requests.get(f"{API_BASE}/business-dashboard", params={"period": "30d"}, headers=headers)
data = resp.json()

print(f"Revenue: ₹{data['metrics']['totalRevenue']['value']}")
print(f"Orders: {data['metrics']['totalOrders']['value']}")
print(f"Trend: {data['metrics']['totalRevenue']['trend']}")  # "up" / "down" / "flat"

# Get inventory
resp = requests.get(f"{API_BASE}/inventory", params={"period": "30d"}, headers=headers)
inv = resp.json()

print(f"Total Stock: {inv['summary']['availableInventory']} units")
print(f"Out of Stock SKUs: {inv['summary']['outOfStock']}")
for item in inv['items']:
    if item['status'] == 'low-stock':
        print(f"  ⚠ {item['name']}: {item['stock']} left")
```

### cURL

```bash
# Business Dashboard
curl -H "X-API-Key: your_key" \
  "https://dashboardweb-gold.vercel.app/api/external/business-dashboard?period=30d"

# SKU Performance — page 2, sorted by units sold
curl -H "X-API-Key: your_key" \
  "https://dashboardweb-gold.vercel.app/api/external/sku-performance?period=7d&page=2&limit=25&sort=unitsSold&order=desc"

# Full overview for last 90 days
curl -H "X-API-Key: your_key" \
  "https://dashboardweb-gold.vercel.app/api/external/overview?period=90d"

# Without API key (if EXTERNAL_API_KEY not set)
curl "https://dashboardweb-gold.vercel.app/api/external/overview?period=30d"
```

### React / Frontend

```jsx
import { useEffect, useState } from 'react';

function Dashboard() {
  const [data, setData] = useState(null);
  
  useEffect(() => {
    fetch('https://dashboardweb-gold.vercel.app/api/external/overview?period=30d', {
      headers: { 'X-API-Key': 'your_key' }
    })
      .then(r => r.json())
      .then(setData);
  }, []);
  
  if (!data) return <p>Loading...</p>;
  
  return (
    <div>
      <h2>Revenue: ₹{data.businessDashboard.totalRevenue.value.toLocaleString()}</h2>
      <p>Orders: {data.businessDashboard.totalOrders.value}</p>
      <p>Inventory: {data.inventory.availableInventory} units</p>
      
      <h3>Revenue Trend</h3>
      {data.salesRevenue.revenueTrend.map(p => (
        <div key={p.date}>{p.date}: ₹{p.revenue} ({p.orders} orders)</div>
      ))}
    </div>
  );
}
```

---

## Quick Reference Table

| Endpoint | URL | Filters | Best For |
|----------|-----|---------|----------|
| **Overview** | `/api/external/overview` | `period` | Get everything in one call |
| **Business** | `/api/external/business-dashboard` | `period` | KPI cards, top products |
| **Traffic** | `/api/external/traffic-conversion` | `period` | State-wise orders map |
| **Advertising** | `/api/external/advertising` | `period` | Ad metrics (zeros for now) |
| **Sales** | `/api/external/sales-revenue` | `period` | Revenue chart, slow movers |
| **Inventory** | `/api/external/inventory` | `period` | Stock levels, out-of-stock alerts |
| **SKU** | `/api/external/sku-performance` | `period`, `page`, `limit`, `sort`, `order` | Product table with pagination |
| **FBM Catalog** | `/api/external/fbm-catalog` | `page`, `limit`, `sort`, `order`, `status` | SKU details, costs, inventory health |

---

*Last updated: March 5, 2026*
