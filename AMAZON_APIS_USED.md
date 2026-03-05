# Amazon SP-APIs Used

**Base URL:** `https://sellingpartnerapi-eu.amazon.com`  
**Marketplace:** Amazon India (`A21TJRUUN4KGV`)  
**Auth:** LWA OAuth2 refresh-token grant → `https://api.amazon.com/auth/o2/token`

---

## 1. Orders API (`/orders/v0`)

| Operation | Endpoint |
|-----------|----------|
| **getOrders** | `GET /orders/v0/orders` |
| **getOrderItems** | `GET /orders/v0/orders/{orderId}/orderItems` |

**Data we get:**

- **Order-level:** `AmazonOrderId`, `PurchaseDate`, `OrderStatus`, `OrderTotal` (Amount + Currency), `FulfillmentChannel`, `LastUpdateDate`, `NumberOfItemsShipped`, `NumberOfItemsUnshipped`, `ShippingAddress` (City, State, PostalCode)
- **Item-level:** `SellerSKU`, `ASIN`, `Title`, `QuantityOrdered`, `QuantityShipped`, `ItemPrice`, `ShippingPrice`, `ItemTax`

**Used for:** Order counts, revenue calculation, units sold, state-wise distribution, recent orders list, order status tracking, tax per item, RTO detection (status = `Cancelled`).

---

## 2. Finances API (`/finances/v0`)

| Operation | Endpoint |
|-----------|----------|
| **listFinancialEvents** | `GET /finances/v0/financialEvents` |
| **listFinancialEventGroups** | `GET /finances/v0/financialEventGroups` |
| **listFinancialEventsByGroup** | `GET /finances/v0/financialEventGroups/{groupId}/financialEvents` |

**Data we get:**

- **Shipment Events:** `AmazonOrderId`, `SellerOrderId`, `PostedDate`, charges per item (Principal, Tax, ShippingTax, Commission, FBAFees), fee breakdowns (FeeType + FeeAmount)
- **Refund Events:** Same structure — used to detect returned orders
- **Service Fee Events:** `FeeDescription`, `FeeAmount`
- **Event Groups:** `FinancialEventGroupId`, `ProcessingStatus` (Open/Closed), `FundTransferDate`, `BeginningBalance`, `OriginalTotal`, `ConvertedTotal`

**What we cover from this API:**

| Feature | Source in Finances API | How we use it |
|---------|----------------------|---------------|
| **Settlements / Payouts** | `listFinancialEventGroups` → `ProcessingStatus` (Open/Closed), `FundTransferDate`, `BeginningBalance`, `OriginalTotal`, `ConvertedTotal` | Settlement period tracking, payout cycle dashboard, closed settlement detection |
| **Refunds / Returns** | `RefundEventList` inside `listFinancialEvents` → per-SKU refund amounts with `ChargeType`, `ChargeAmount` | Return detection (any order with a refund event = returned), return rate calculation, refund amount tracking |
| **RTO (Return to Origin)** | Orders API `OrderStatus = Cancelled` + Finances `RefundEventList` | Cancelled orders = RTO/customer-cancelled. Refund events confirm money was returned |
| **Taxes** | `ShipmentEventList` → `ItemChargeList` includes charges with ChargeType = `Tax`, `ShippingTax`. Also `ItemTax` from Orders API | Tax amounts per order item, included in settlement breakdowns |
| **Fees (Commission, Closing, Shipping)** | `ItemFeeList` per shipment item (FeeType = `Commission`, `FBAPerUnitFulfillmentFee`, `ShippingChargeback`, etc.) + `ServiceFeeEventList` | Amazon commission tracking, per-order fee breakdown, total fee deductions |
| **Payments / Disbursements** | `listFinancialEventGroups` → `FundTransferDate`, `ConvertedTotal` | When Amazon transferred money and how much per settlement cycle (~14 days) |
| **Adjustments / Reimbursements** | `AdjustmentEventList` → `AdjustmentType`, per-item `TotalAmount`, `Quantity` | Amazon corrections, reimbursements, manual adjustments |

**4 event types we parse from each financial events page:**

1. **`ShipmentEventList`** → Order charges (Principal amount, Tax, ShippingTax) + Fees (Commission, etc.)
2. **`RefundEventList`** → Refund/return amounts per SKU (negative amounts)
3. **`ServiceFeeEventList`** → Platform service fees (subscription, etc.)
4. **`AdjustmentEventList`** → Amazon adjustments, reimbursements, corrections

**Event types we currently skip** (rare / not relevant for FBM India):

| Event List | What it covers | Why skipped |
|------------|---------------|-------------|
| `GuaranteeClaimEventList` | A-to-Z guarantee claims | Rare for most sellers |
| `ChargebackEventList` | Payment chargebacks | Very rare |
| `RetrochargeEventList` | Retroactive tax charges | Rare |
| `RemovalShipmentEventList` | FBA removal orders | N/A for FBM |
| `RentalTransactionEventList` | Textbook rentals | N/A |
| `DebtRecoveryEventList` | Amazon debt recovery | Rare |
| `TaxWithholdingEventList` | TDS / tax withholding by Amazon | Could be added for India TDS tracking |

---

## 3. Catalog Items API (`/catalog/2022-04-01`)

| Operation | Endpoint |
|-----------|----------|
| **getCatalogItem** | `GET /catalog/2022-04-01/items/{asin}` |

**Data we get:**

- `title` — Product name
- `brand` — Brand name
- `images` — Product image URLs

**Used for:** Enriching orders and inventory with product names/images. Responses are cached for 7 days.

---

## 4. FBA Inventory API (`/fba/inventory/v1`)

| Operation | Endpoint |
|-----------|----------|
| **getInventorySummaries** | `GET /fba/inventory/v1/summaries` |

**Data we get:**

- `sellerSku`, `asin`, `productName`, `condition`
- `totalQuantity`, `fulfillableQuantity`, `inboundWorkingQuantity`, `inboundShippedQuantity`, `inboundReceivingQuantity`, `reservedQuantity`
- `lastUpdatedTime`

**Used for:** FBA stock levels only — `fulfillable`, `inbound`, `reserved`, `unfulfillable` quantities. This API **only returns data for FBA SKUs**. Since we are 100% FBM, this typically returns an empty list.

> ⚠️ **This API does NOT provide FBM stock.** FBM inventory comes from the Reports API (see below).

---

## 5. Reports API (`/reports/2021-06-30`)

| Operation | Endpoint |
|-----------|----------|
| **createReport** | `POST /reports/2021-06-30/reports` |
| **getReport** | `GET /reports/2021-06-30/reports/{reportId}` |
| **getReportDocument** | `GET /reports/2021-06-30/documents/{documentId}` |

**Report type:** `GET_MERCHANT_LISTINGS_ALL_DATA` (TSV file)

**Data we get:**

- `seller-sku`, `asin1`, `item-name`, `item-description`
- `listing-id`, `product-id-type`, `brand`, `price`
- `quantity`, `fulfillment-channel`, `status`, `product-type`

**Used for:**
1. **Master SKU catalog** — populates the `skus` table with all active/inactive listings. Source of truth for which products exist.
2. **FBM inventory stock** — the `quantity` column is the "Quantity Available" set in Seller Central. This is the **only source of FBM stock counts**.

---

## How FBM Inventory Works

Since we are **100% FBM (Fulfilled by Merchant)**, inventory works differently from FBA:

| What | Source | API |
|------|--------|-----|
| **FBM stock count** | `quantity` field in Merchant Listings report | Reports API |
| **Product name, ASIN, price** | `item-name`, `asin1`, `price` from same report | Reports API |
| **Product images & brand** | Catalog Items API enrichment | Catalog API |
| **FBA fields (fulfillable, inbound, reserved)** | Always **0** for FBM | N/A |

**Stock status rules:**
- `quantity = 0` → **out-of-stock**
- `quantity 1–9` → **low-stock**
- `quantity ≥ 10` → **in-stock**

The FBA Inventory API is still called when `fulfillment=all` or `fulfillment=fba` as a fallback, but returns no data for FBM sellers.

---

## APIs NOT Yet Connected

| API | What it would provide | Current status |
|-----|----------------------|----------------|
| **Amazon Advertising API** | Impressions, clicks, ad spend, ACOS, ROAS | Returns zeros |
| **Brand Analytics** | Sessions, page views, conversion rate | Returns zeros |

---

## Data Flow

```
Amazon SP-API  →  amazon-full-sync.mjs  →  Supabase Tables  →  Dashboard APIs
     ↓                                           ↓
  Live calls                              orders, order_items,
  (Orders, Catalog,                       financial_events,
   Inventory pages)                       inventory_snapshots,
                                          skus
```

**Sync script** (`amazon-full-sync.mjs`) pulls historical data from all 5 APIs and stores it in Supabase. The dashboard and external APIs then read from Supabase — they don't call Amazon directly.

**Live API calls** are only made from the Orders, Inventory, and Performance pages for real-time data.
