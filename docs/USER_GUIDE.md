# The Retro Cafeteria: POS Billing Software — Operational User Guide

**Version:** 3.0  
**Outlet:** The Retro Cafeteria (Gandhi Road, Near Varadaraja Perumal Temple, Kanchipuram, Tamil Nadu - 631501)  
**GSTIN:** `33AABCR1234F1Z5` | **FSSAI Licence:** `11223344556677`

---

## 1. Quick Start

1. Double-click `start.bat` on the Windows desktop or run:
   ```cmd
   python server.py
   ```
2. The software will open automatically in your browser at `http://127.0.0.1:3000`.
3. The software runs **100% offline** without needing an internet connection.

---

## 2. Staff Roles & Default PINs

| Role | Default PIN | Permissions |
|---|---|---|
| **Store Owner** | `1234` | Full access: Menu editing, Price changes, Table management, Store settings, Z-Reports, Bill cancellation, Unlimited discounts. |
| **Cashier** | `0000` | Front-of-house: Order taking (Counter, Dine-in, Takeaway), Kitchen slip printing, Payment collection, Receipt printing, Reprint, Discounts up to 10%. |

*PINs and cashier discount limits can be changed in **Settings**.*

---

## 3. Order Workflows

### A. Counter Sale (`F1`)
*Instant walk-in sale. The fastest billing workflow (under 15 seconds).*
1. Press `F1` or click **Counter Sale** on Home.
2. Add dishes by clicking them, or type short-code in the search bar and press `Enter` (e.g. `CB` for Chicken Burger, `PF` for Peri Peri Fries).
3. Press `F12` or `Ctrl+Enter` to open the payment drawer.
4. Select payment mode (**Cash**, **UPI**, or **Card**).
   - In Cash mode, enter amount tendered or click preset buttons (e.g. `Exact`, `₹500`, `₹1000`). Change due is automatically computed.
5. Press `Enter` or click **Print Tax Invoice & Settle**.
6. Consecutive bill number (e.g. `2026-27/000001`) and daily token number are generated and printed.

### B. Dine-In Tables (`F2`)
1. Press `F2` or click **Dine-in Tables**.
2. Tap any free table (e.g. `Table 5` in Main Hall, or `AC 1` in AC Section).
3. Add initial dishes for Round 1.
4. Press `F6` to print the **Kitchen Slip (KOT)**. (The kitchen slip prints dish names, quantities, and instructions without prices).
5. When the guest orders additional rounds, click the table card again and add dishes. Subsequent presses of `F6` will print **only new items added since the previous round**.
6. When the guest asks for the bill, press `F12` to settle and print the final GST Tax Invoice.

### C. Takeaway Parcel (`F3`)
1. Press `F3` or click **Takeaway**.
2. Add items to the check.
3. If the guest wants to pay later upon pickup, press `F9` (**Hold Order**). The order is parked in the **Held Orders** list (`F4`).
4. To resume, press `F4`, locate the customer's order, and click **Resume**.

---

## 4. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `F1` | New Counter sale |
| `F2` | Dine-in tables floor plan |
| `F3` | New Takeaway parcel order |
| `F4` | View open / held orders |
| `/` or `Ctrl+F` | Jump focus to dish search bar |
| `code` + `Enter` | Add item by short-code (e.g. `CB` + Enter) |
| `+` / `-` | Increase / decrease quantity |
| `F6` | Print Kitchen Slip (KOT) |
| `F8` | Apply discount (percentage or flat) |
| `F9` | Hold / park current order |
| `F12` or `Ctrl+Enter` | Settle and print bill |
| `Esc` | Close modal / go back / clear dialogs |
| `?` | Show keyboard shortcuts reference sheet |

---

## 5. GST Invoicing & Compliance

- **GST Rate:** Standard 5% composite GST split equally into **2.5% CGST + 2.5% SGST** with SAC code `9963` (restaurant service).
- **Invoice Numbering:** Consecutive numbers formatted as `YYYY-YY/NNNNNN` (e.g. `2026-27/000001`) per Indian financial year (April 1 to March 31). Numbers never reset mid-year and are never deleted.
- **Bill Cancellation:** If a customer leaves or an error occurred on a printed bill, click **Cancel** in **Bill History**. Cancellation requires the **Owner PIN** and a mandatory reason for the audit log. The cancelled bill remains in the sequence but is excluded from net sales and tax liabilities.
- **Reprints:** Any bill printed after the first time automatically bears a prominent `*** DUPLICATE COPY ***` banner.
- **Composition Scheme:** If operating under the Composition Scheme, toggle **Bill of Supply** in Settings. Tax lines will not be shown to customers.

---

## 6. Thermal Printer Setup (Xprinter XP-N160II / POS-80 & 80mm Standards)

- In **Settings > Receipt Printer & Hardware**:
  - **Printer Width:** Set to **80 mm Thermal (48 columns)**.
  - **Kitchen Slip (KOT) Auto-Print:** Toggle **ON** to automatically print a kitchen ticket with order type, table/token, and cooking notes.
  - **Cash Drawer Auto-Kick:** Toggle **ON** to pulse the RJ11 port on cash settlement.
- Click **Print Test Receipt** to verify paper alignment and font rendering.
- **Setting up the Xprinter XP-N160II / POS-80 on Windows:**
  1. Connect via USB cable and power on.
  2. Install the official Xprinter Windows driver (or generic Windows "POS-80" / "Generic / Text Only" driver).
  3. Set as default Windows printer.
  4. In Printer Properties > Device Settings, verify paper size is set to **80 x 297 mm** and Auto-Cut is enabled.
  5. When the print preview opens, select Margins: **None** (or launch Chrome with `--kiosk-printing` for zero-click instant printing).

---

## 7. Menu, Sizes & Add-ons Configuration

In **Menu** (`F5`), click **Add Product** or edit an existing dish:
- **Portion Sizes (Optional):** Enter comma-separated names and prices:  
  `Regular: 120, Large: 160`  
  *(Leave empty if the item has only one standard price).*
- **Add-ons (Optional):** Enter comma-separated add-on items with extra charges:  
  `Extra Cheese: 20, Mayo Dip: 15, Extra Patty: 40`
- **Short-Code:** Unique keyboard mnemonic (e.g. `CB` for Chicken Burger, `PF` for Peri Peri Fries).
- **Billing with Sizes & Add-ons:**
  - Clicking a dish with sizes or add-ons instantly presents an **Options Modal**.
  - Cashier selects the size, ticks add-ons, clicks cooking note chips, and presses **Enter** to add to the bill.
  - Dishes without sizes or add-ons add instantly in **1 click (<100ms)**.

---

## 8. Data Safety, Automated Backups & Cloud Sync

- **Automated Local & Cloud Backup:**
  - In **Settings > Automated Local & Cloud Backup**, enter your preferred destination folder:
    - Local folder: e.g. `D:\posdemo\openbill\backups`
    - Cloud Sync: e.g. `C:\Users\kirub\Google Drive\POS_Backups` or `C:\Users\kirub\OneDrive\POS_Backups`
    - USB Thumb Drive: e.g. `E:\Restaurant_Backups`
  - When **Automatic Background Backup** is ON, a timestamped snapshot (`Retro_POS_Backup_YYYY-MM-DD_HH-MM-SS.json`) is saved automatically on every bill settlement and day close.
  - The software automatically keeps the **last 30 rolling backups** to prevent disk bloat.
- **Manual Backup / Restore:** Click **Backup Now** on Home or export/import in Settings.
- **End-of-Day Z-Report:** At the end of the shift, go to **Reports** and click **Print Z-Report** to print an audit slip showing gross sales, cash in drawer, UPI, and GST totals.

---

## 9. Dynamic UPI QR Code (₹0 Machine Cost)

- **Hardware Cost:** **₹0** (No soundbox monthly rent, no swipe machine POS deposit, no gateway charges, 0% MDR on UPI in India).
- **How it Works:**
  1. Go to **Settings > Restaurant Identity** and enter your merchant UPI ID (e.g. `retrocafe@oksbi` or `yourname@upi`).
  2. When settling an order, select **UPI** in the payment drawer (`F12`).
  3. The software dynamically generates an **ISO/IEC 18004 compliant UPI QR Code** right on screen with the customer's exact payable amount (e.g. `₹105.00`) and consecutive bill number pre-filled.
  4. The guest scans the screen QR with **Google Pay, PhonePe, Paytm, BHIM, or any UPI app**. The amount is locked and pre-filled—the guest simply enters their UPI PIN to approve.
  5. If **Print UPI Details on Bill** is enabled in Settings, the printed thermal customer bill also prints the merchant UPI payment instruction and QR reference.

---

## 10. Complimentary / Non-Chargeable (NC) Bills

- **Purpose:** Used for VIP guests, food quality replacement, staff meals, or promotional food tasting where ₹0 is collected from the customer, but line items must still be accounted for inventory control.
- **Security Guard:** Requires **Store Owner PIN (`1234`)** to prevent unauthorized free meals by cashiers.
- **Workflow:**
  1. Add dishes to the check as normal.
  2. In the payment drawer (`F12`), click **Complimentary / NC Bill**.
  3. Enter the 4-digit **Owner PIN** to authorize.
  4. Select a mandatory audit reason:
     - `VIP Guest / Owner Friend`
     - `Food Quality Issue / Food Replaced`
     - `Staff / Crew Meal`
     - `Influencer / Marketing Promotion`
     - `Other` (with custom explanation)
  5. Click **Confirm & Settle ₹0 Bill**.
  6. The system settles the bill with ₹0.00 grand total, updates the sales ledger with `isNC: true`, decrements the kitchen stock count, and prints a receipt bearing a prominent `*** COMPLIMENTARY (NC) ***` banner.
  7. **Instant WhatsApp Alert to Owner:** The system automatically opens a WhatsApp notification to the store owner's mobile number containing the bill number, cashier name, reason, and an itemized list of waived dishes.

---

## 11. Auditor GST Filing Export (GSTR-1 & GSTR-3B B2CS)

- **Purpose:** 1-click tax filing files ready for Chartered Accountants (CA) and the Indian GST Portal (`gst.gov.in`).
- **In Reports (`view-reports`):**
  - **GSTR-1 B2CS (Auditor Export):** Downloads `GSTR1_Table7_B2CS_YYYY-MM-DD.csv` formatted according to government portal specifications for Table 7 (B2C Small Supplies) under SAC `9963` at 5% GST (Place of Supply `33-Tamil Nadu`, Type `OE`, Taxable Value, CGST `2.5%`, SGST `2.5%`, Total Value).
  - **CA Sales Register:** Downloads `Auditor_Sales_Register_YYYY-MM-DD.csv` containing a comprehensive invoice-by-invoice audit ledger with invoice numbers, timestamps, customer details, taxable values, tax breakdowns, payment modes, and reasons for any cancelled or NC bills.

---

## 12. Lightweight Critical Stock Counter (Single-PC Optimized)

- **Design Philosophy:** Tailored for single-laptop offline cafeteria operations without bulky multi-warehouse ERP complexity.
- **Configuration:**
  - In **Menu**, edit any dish and tick **Track Critical Stock Counter**.
  - Enter the **Current Stock** (e.g. `25` burger patties) and **Low Alert At** threshold (e.g. `5`).
- **Automated Behavior:**
  - Every time an order is settled (Cash, UPI, Card, or NC), the stock counter automatically decrements by the quantity ordered.
  - When stock reaches 0, the software automatically marks the product as **SOLD OUT** (`isAvailable: false`) and disables the POS card to prevent cashiers from taking orders the kitchen cannot fulfill.
  - When stock is low ($\le$ threshold), the POS card pulses an amber warning: `⚠️ 3 left`.
- **Quick Stock Counter Manager:**
  - Click **Stock** in the top navigation bar at any time to open the quick stock manager.
  - View real-time counters for all tracked dishes, tap `+1`, `+5`, `+10`, or click **Refill All (+25)** in 1 second.

---

## 13. Guest Directory & CRM

- **Counter Auto-Recognition:**
  - When taking an order or in the payment drawer (`F12`), enter the customer's 10-digit mobile number.
  - If the customer has ordered before, their name auto-fills instantly, and an amber VIP badge appears:  
    `⭐ Karthik: 5 Visits • ₹1,240 spent • Likes: Chicken Burger`
  - Cashier can click **Repeat Order** to populate their exact previous items in one click.
- **Dedicated CRM View (`CRM / Guests`):**
  - Summary KPI cards: Total Registered Guests, Repeat Customer Rate %, Total Guest Revenue, and Average Spend per Guest.
  - Filters: **All Guests**, **Regulars (2+ Visits)**, or **VIPs (₹1000+ Lifetime Spend)**.
  - **1-Click WhatsApp Promo:** Click the WhatsApp button beside any customer to open a pre-filled, personalized invitation inviting them back for their favorite dish.
  - **Export Guests CSV:** 1-click export of customer contacts and purchase histories for external SMS/WhatsApp marketing campaigns.
