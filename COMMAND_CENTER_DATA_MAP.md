# Command Center — Complete Data Map

> How every metric is calculated, stored, and displayed.
> Last updated: 2026-02-26

---

## Data Pipeline Overview

```
Amazon SP-API ──► Sync Pipeline (POST /api/command-center/sync)
                      │
                      ├─ Step 1: syncSkus()            → `skus` table
                      ├─ Step 2: syncOrders()           → `orders` table
                      ├─ Step 3: syncFinancialEvents()  → `financial_events` table ★ SOURCE OF TRUTH
                      ├─ Step 4: syncInventory()        → `inventory_snapshots` table
                      ├─ Step 5: computeAggregations()  → `sku_daily_metrics` + `account_daily_metrics`
                      └─ Step 6: computeInventoryHealth()→ `inventory_health` + `alerts`

UI reads from:
  GET /api/command-center/metrics          → KPIs, waterfall, trends
  GET /api/command-center/sku-performance  → SKU table
  GET /api/command-center/alerts           → Alerts panel
```

**Trigger:** Manual only — user clicks "Sync Amazon" button. No automated cron job.

---

## Section 1: KPI Cards (8 cards)

### 1. Total Revenue

| Layer | Detail |
|---|---|
| **What it shows** | Gross revenue from all shipped orders in the selected period |
| **Calculation** | Sum of all `financial_events` where `event_type = 'shipment'` |
| **DB** | Aggregated into `account_daily_metrics.total_revenue_live` by `computeAggregations()` |
| **API** | `GET /api/command-center/metrics` → sums `total_revenue_live` across period days |
| **Trend** | `((current - previous) / previous) × 100` — compared to same-length previous period |
| **Live vs Locked** | **Live** = all shipments. **Locked** = only shipments delivered > 15 days ago AND not refunded |
| **⚠️ Issues** | None — this is accurate from Amazon Finances API |

### 2. Net Contribution

| Layer | Detail |
|---|---|
| **What it shows** | Profit after all deductions |
| **Calculation** | `Revenue − Amazon Fees − COGS − Shipping & Logistics − Ad Spend − Refunds` |
| **DB** | `account_daily_metrics.net_contribution_live` — pre-computed in `computeAggregations()` |
| **API** | `GET /api/command-center/metrics` → sums `net_contribution_live` |
| **⚠️ Issues** | Depends on COGS accuracy. Currently COGS = 0 (user must enter manually) |

### 3. Contribution %

| Layer | Detail |
|---|---|
| **What it shows** | Net Contribution as a percentage of Revenue |
| **Calculation** | `(Net Contribution / Total Revenue) × 100` |
| **DB** | NOT stored — computed live in the metrics API |
| **API** | Computed in `GET /api/command-center/metrics` |
| **Trend** | Absolute difference in percentage points (pp), not relative % change |
| **⚠️ Issues** | Same COGS dependency as Net Contribution |

### 4. Total Ad Spend

| Layer | Detail |
|---|---|
| **What it shows** | Total advertising spend across all campaigns |
| **Calculation** | Sum of `financial_events` where `event_type = 'ad_spend'` |
| **DB** | `account_daily_metrics.total_ad_spend` |
| **🔴 ISSUE** | **Always ₹0** — Amazon Advertising API is NOT integrated. The Finances API does not include ad spend. Requires separate Amazon Advertising API credentials. |

### 5. Blended TACOS

| Layer | Detail |
|---|---|
| **What it shows** | Total Advertising Cost of Sales |
| **Calculation** | `(Total Ad Spend / Total Revenue) × 100` |
| **DB** | NOT stored — computed live in metrics API |
| **Trend** | Absolute difference in percentage points (pp) |
| **🔴 ISSUE** | **Always 0%** — because Ad Spend is always ₹0 (no Ads API) |

### 6. Units Sold

| Layer | Detail |
|---|---|
| **What it shows** | Total units shipped in the period |
| **Calculation** | Sum of `quantity` from `financial_events` where `event_type = 'shipment'` |
| **DB** | `account_daily_metrics.total_units_live` |
| **API** | Summed in `GET /api/command-center/metrics` |
| **⚠️ Issues** | None — accurate from Finances API |

### 7. Inventory Value

| Layer | Detail |
|---|---|
| **What it shows** | Estimated value of available stock |
| **Calculation** | `Sum(available_units × unit_value)` per SKU |
| **Unit value** | Uses `cost_per_unit` if set (currently 0), otherwise falls back to **avg selling price** (`revenue / units_sold`) |
| **DB** | Reads `inventory_health.available_units` + `skus.cost_per_unit` + `sku_daily_metrics` |
| **API** | Computed live in `GET /api/command-center/metrics` |
| **🟡 FBM ISSUE** | FBM stock is **estimated** (daily sales × 30 days). Not real data — Amazon doesn't track FBM inventory. |

### 8. Active SKUs

| Layer | Detail |
|---|---|
| **What it shows** | Count of SKUs with available stock > 0 |
| **Calculation** | Count of rows in `inventory_health` where `available_units > 0` |
| **DB** | `inventory_health` table |
| **Trend** | Shows count of "at-risk" SKUs (days_inventory < 7) instead of % change |
| **🟡 FBM ISSUE** | For FBM, any SKU with sales in last 30 days is treated as "active" with estimated stock. |

---

## Section 2: Profit Waterfall Chart

Each bar shows a deduction from Gross Revenue to arrive at Net Contribution:

| Bar | Calculation | DB Source | ⚠️ Status |
|---|---|---|---|
| **Gross Revenue** | Sum of shipment events | `account_daily_metrics.total_revenue_live` | ✅ Accurate |
| **Marketplace Fees** | Sum of fee events (negative) | `account_daily_metrics.total_fees` | ✅ Accurate — real Amazon fees |
| **COGS** | `units_sold × cost_per_unit` per SKU | `sku_daily_metrics` × `skus.cost_per_unit` | 🟡 Currently ₹0 — user must enter COGS |
| **Shipping & Logistics** | `units × (shipping_cost + packaging_cost)` per SKU | `skus.shipping_cost_internal` + `skus.packaging_cost` | 🟡 Currently ₹0 — columns never populated |
| **Returns Cost** | `refund_units × cost_per_unit` per SKU | `sku_daily_metrics.refund_units` × `skus.cost_per_unit` | 🟡 Currently ₹0 — depends on COGS |
| **Ad Spend** | Sum of ad_spend events | `account_daily_metrics.total_ad_spend` | 🔴 Always ₹0 — no Ads API |
| **Net Contribution** | Revenue − all deductions | Computed | Depends on above |

---

## Section 3: SKU Performance Table

Each column and how it's computed in `GET /api/command-center/sku-performance`:

| Column | Formula | DB Source | Status |
|---|---|---|---|
| **SKU** | SKU identifier | `sku_daily_metrics.sku` | ✅ |
| **Title** | Product name | `skus.title` (from Listings API) | ✅ |
| **Revenue** | Sum of shipment amounts for this SKU | `sku_daily_metrics.revenue_live` | ✅ Accurate |
| **Sold** | Sum of shipped quantity | `sku_daily_metrics.units_sold_live` | ✅ Accurate |
| **Margin** | `(net_contribution / revenue) × 100` | Computed from `sku_daily_metrics` | 🟡 Inflated — COGS is 0 |
| **TACOS** | `(ad_spend / revenue) × 100` | `sku_daily_metrics.ad_spend` | 🔴 Always 0% — no Ads API |
| **ROAS** | `revenue / ad_spend` | Computed | 🔴 Always 0 — no Ads API |
| **Return %** | `(refund_units / units_sold) × 100` | `sku_daily_metrics.refund_units / units_sold_live` | ✅ Accurate (unit-based) |
| **In Inventory** | Available units | `inventory_health.available_units` | 🟡 FBM: estimated from sales velocity |
| **Days Inv** | `available_units / avg_daily_sales_7d` | `inventory_health.days_inventory` | 🟡 FBM: estimated |
| **Priority** | Velocity × Margin matrix | Computed in API | 🟡 Margin inflated without COGS |

### Priority Matrix

```
                        Margin ≥ 20%         Margin < 20%
Units Sold ≥ 50    →   SCALE ✅              VOLUME RISK ⚠️
Units Sold ≤ 10    →   PREMIUM NICHE 💎      KILL ❌
```

---

## Section 4: Financial Breakdown Panel

| Item | Calculation | Status |
|---|---|---|
| **Total Fees** | Sum of `total_fees` from `account_daily_metrics` | ✅ Real Amazon fees |
| **Gross Revenue** | Sum of `total_revenue_live` | ✅ |
| **Amazon Fees** | = Total Fees (negative) | ✅ |
| **COGS** | `units × cost_per_unit` per SKU | 🟡 ₹0 — no COGS entered |
| **Shipping & Logistics** | `units × (shipping + packaging)` per SKU | 🟡 ₹0 — not populated |
| **Returns Cost** | `refund_units × cost_per_unit` | 🟡 ₹0 — depends on COGS |
| **Refunds** | Sum of `total_refund_amount` | ✅ Real refund data |
| **Ad Spend** | Sum of `total_ad_spend` | 🔴 ₹0 — no Ads API |
| **Net Contribution** | Revenue − all costs | Depends on above |
| **Total Profit** | = Net Contribution (currently identical) | Depends on above |

---

## Section 5: Revenue State Breakdown

Shows how revenue is classified by delivery status:

| State | Logic | Source |
|---|---|---|
| **Pending** | Shipment events with no `delivery_date` | `financial_events` |
| **At-Risk** | Delivered within last 15 days (return window open) | `financial_events.delivery_date` |
| **Locked** | Delivered > 15 days ago (return window closed) | `financial_events.delivery_date` |
| **Refunded** | Refund events | `financial_events.event_type = 'refund'` |

**🔴 FBM ISSUE:** `delivery_date` is only populated for EasyShip orders (`EasyShipShipmentStatus === 'Delivered'`). For FBM/FBA orders without this status, `delivery_date` is NULL → revenue stays in **Pending** forever and never moves to At-Risk or Locked.

---

## Section 6: Inventory Risk Panel

| Metric | Calculation | Source |
|---|---|---|
| **Available Units** | FBA: from Amazon Inventory API. FBM: estimated (sales × 30 days) | `inventory_health.available_units` |
| **Avg Daily Sales** | `units_sold_live` in last 7 days ÷ 7 | `sku_daily_metrics` |
| **Days of Inventory** | `available_units / avg_daily_sales_7d` | `inventory_health.days_inventory` |
| **Risk Status** | Red: ≤ 7 days · Yellow: 8–20 days · Green: > 20 days | `inventory_health.risk_status` |

---

## Section 7: Alerts

Generated during sync in `computeInventoryHealth()`:

| Alert Type | Trigger | Threshold |
|---|---|---|
| **Low Stock** | `days_inventory ≤ 4` | 4 days |
| **High Return Rate** | `return_rate > 10%` | 10% |
| **High TACOS** | `tacos > 30%` | 30% |
| **Low Margin** | `margin < 5%` AND revenue > 0 | 5% |
| **Out of Stock** | `available_units = 0` AND had recent sales | 0 units |
| **Dead Inventory** | `available_units > 0` AND zero sales in 30 days | 0 sales |
| **Overstock** | `days_inventory > 180` | 180 days |

**Not implemented** (require additional data):
- Sales Velocity Drop (needs historical velocity comparison)
- Declining Conversion (needs Amazon Brand Analytics API for traffic data)

---

## Summary of Data Gaps

### 🔴 Missing: Amazon Advertising API

| What's Affected | Current Value | Fix Required |
|---|---|---|
| Total Ad Spend | Always ₹0 | Integrate Amazon Advertising API |
| Blended TACOS | Always 0% | Same |
| ROAS per SKU | Always 0 | Same |
| TACOS per SKU | Always 0% | Same |
| High TACOS alerts | Never trigger | Same |

### 🟡 Missing: FBM Inventory Tracking

| What's Affected | Current Behavior | Fix Options |
|---|---|---|
| In Inventory (Stock) | Estimated: `daily_sales × 30` | User enters real stock levels or CSV import |
| Days of Inventory | Estimated from above | Same |
| Inventory Value | Uses avg selling price × estimated stock | Same |
| Active SKUs count | Any SKU with sales = "active" | Same |
| Out of Stock alerts | Based on estimated data | Same |

### 🟡 Missing: User-Entered COGS

| What's Affected | Current Value | Fix Required |
|---|---|---|
| COGS in waterfall | ₹0 | User enters `cost_per_unit` per SKU |
| Shipping & Logistics | ₹0 | User enters `shipping_cost_internal` + `packaging_cost` |
| Returns Cost | ₹0 | Depends on COGS |
| Net Contribution | Overstated (missing cost deductions) | Depends on COGS |
| Margin per SKU | Overstated | Same |
| Priority matrix | Affected by inflated margins | Same |

### 🟡 Missing: Delivery Date for FBA/FBM

| What's Affected | Current Behavior | Fix Required |
|---|---|---|
| Revenue States (Pending/At-Risk/Locked) | FBM/FBA orders stuck in "Pending" forever | Estimate delivery from `shipment_date + transit days` or use order tracking API |
