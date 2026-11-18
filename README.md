# OpenBill POS — The Retro Cafeteria (Version 3.0)

[![GitHub Repo](https://img.shields.io/badge/GitHub-openbill--pos-171717?style=flat&logo=github)](https://github.com/kirubakaran7399-sudo/openbill-pos)
[![Version](https://img.shields.io/badge/Version-3.0.0-C82026?style=flat)]()
[![Tests](https://img.shields.io/badge/Tests-39%20Passed-emerald?style=flat)]()
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat)]()
[![Architecture](https://img.shields.io/badge/Architecture-100%25%20Offline--First-orange?style=flat)]()
[![GST](https://img.shields.io/badge/GST-5%25%20Composite%20(SAC%209963)-purple?style=flat)]()

An ultra-responsive, zero-latency, 100% offline restaurant billing POS software built for **The Retro Cafeteria** (Kanchipuram, Tamil Nadu) conforming to Design Specification v3.0 and the OpenBill semantic thermal printing pipeline.

---

## 🎯 Architecture & System Design

```
┌────────────────────────────────────────────────────────────────────────┐
│               THE RETRO CAFETERIA — OPENBILL POS ENGINE                │
├──────────────────┬──────────────────┬─────────────────┬────────────────┤
│ Dynamic UPI QR   │ NC Order Alerts  │ Auditor Exports │ Critical Stock │
│ (Screen & Bill)  │ (WhatsApp Alert) │ (GSTR-1 & 3B)   │ (Single-PC)    │
│ ISO/IEC 18004    │ PIN Elevation    │ Table 7 B2CS    │ Auto Sold-Out  │
│ 100% Offline SVG │ ₹0.00 Subtotal   │ CA Register CSV │ 1-Click Refill │
├──────────────────┴──────────────────┴─────────────────┴────────────────┤
│                     GUEST DIRECTORY & CAFETERIA CRM                    │
│   Phone Auto-Lookup • VIP Badges • Repeat Order • 1-Click WhatsApp     │
├────────────────────────────────────────────────────────────────────────┤
│                     STATUTORY COMPLIANCE & PRINTING                    │
│ 5% Composite GST (SAC 9963) • Consecutive Numbers • Xprinter 80mm/58mm │
└────────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ Key Capabilities

### 1. Dynamic UPI QR Code (₹0 Machine Cost)
* **Zero Hardware Rental:** Eliminates monthly soundbox or swipe machine POS charges.
* **Instant Offline Generation:** Directly generates NPCI ISO/IEC 18004 compliant UPI QR codes with exact bill amounts pre-filled.
* **Scan to Pay:** Guests scan with Google Pay, PhonePe, Paytm, or BHIM. Amount and store name are pre-populated.
* **Thermal Bill Print:** Emits UPI VPA and payment notes directly on 80mm receipts.

### 2. Complimentary / Non-Chargeable (NC) Bills
* **Security Guard:** Strictly requires **Store Owner PIN (`1234`)** via elevation modal.
* **Mandatory Reasons:** Prompts for audit reasons (`VIP Guest`, `Food Quality Replacement`, `Staff Meal`, `Marketing Promo`, or custom reason).
* **Automated WhatsApp Alert:** Automatically notifies the owner on WhatsApp with the bill number, cashier name, and waived items list.

### 3. Auditor GST Filing Export (GSTR-1 & GSTR-3B B2CS)
* **Table 7 B2CS Portal CSV:** Ready for direct upload to `gst.gov.in` under SAC `9963` at 5% GST for Place of Supply `33-Tamil Nadu`.
* **CA Sales Register CSV:** Complete invoice-by-invoice audit ledger with timestamps, customer phone, GSTIN, taxable base, CGST, SGST, tender mode, and cancellation/NC audit reasons.

### 4. Single-PC Critical Stock Counter
* **Low Stock Warning:** POS cards pulse an amber warning when stock drops ($\le$ threshold, e.g. `⚠️ 3 left`).
* **Auto Sold-Out:** Auto-disables items when stock reaches 0 to prevent punching unavailable items.
* **Quick Refill Manager:** 1-click modal with `-1`, `+1`, `+5`, `+10`, or **Refill All (+25)**.

### 5. Guest Directory & Cafeteria CRM
* **Counter Auto-Lookup:** Entering a 10-digit mobile number recognizes returning customers, displays their visit stats, and provides a 1-click **Repeat Order** button.
* **1-Click WhatsApp Greetings:** Send personalized invitations tailored to their favorite dish.

---

## 🚀 Quick Launch

### Windows (1-Click)
Double-click `start.bat` or run:
```cmd
python server.py
```
The application opens automatically at `http://127.0.0.1:3000`.

### Running Automated Test Suite
```cmd
node --test tests/*.test.js
```
Runs all **39 automated unit and regression tests** covering financial calculations, cart immutability, role permissions, storage sequence, thermal formatting, and QR encoding in under 200ms.

---

## ⌨️ Keyboard Shortcuts Reference

| Shortcut | Action |
|---|---|
| `F1` | New Counter Walk-in Sale |
| `F2` | Dine-in Tables Floor Plan |
| `F3` | New Takeaway Parcel |
| `F4` | Open / Held Orders Drawer |
| `/` or `Ctrl+F` | Focus Dish Search Bar |
| `code + Enter` | Instant Short-Code Addition (e.g. `CB` + Enter) |
| `F6` | Print Kitchen Slip (KOT) |
| `F8` | Apply Discount |
| `F9` | Hold / Park Current Order |
| `F12` or `Ctrl+Enter` | Settle and Print Tax Invoice |
| `Esc` | Close Open Modals / Dialogs |
| `?` | Keyboard Shortcuts Cheat Sheet |

---

## 📂 Repository Structure

```text
openbill-pos/
├── index.html            # Single-page application UI with responsive panels & modals
├── app.js                # Core controller, event router, and state manager
├── style.css             # Brand styling and thermal print styles
├── server.py             # Local zero-dependency Python server with automated backup APIs
├── start.bat             # Windows 1-click launcher
├── package.json          # Project metadata & test scripts
├── .gitignore            # Git exclusion rules
├── .gitattributes       # Cross-platform line ending normalization
├── logo.png              # Retro Cafeteria brand asset
├── src/
│   ├── core/
│   │   ├── auth.js       # 4-digit PIN authentication & role elevation
│   │   ├── cart.js       # Cart state & kitchen round tracking
│   │   ├── escpos.js     # Semantic thermal receipt engine (80mm & 58mm)
│   │   ├── qr.js         # Pure offline QR generator & NPCI UPI URI builder
│   │   ├── storage.js    # Resilient sales ledger, GSTR-1 export, & CRM engine
│   │   └── tax.js        # Statutory 5% GST & NC bill calculation engine
│   └── data/
│       └── defaultCatalog.js # Preset categories, dishes, and store configuration
├── tests/
│   ├── auth.test.js      # PIN and permission tests
│   ├── cart.test.js      # Cart manipulation and KOT delta tests
│   ├── escpos.test.js    # Thermal monospace formatting tests
│   ├── qr.test.js        # Offline QR & UPI string tests
│   ├── storage.test.js   # Ledger, GSTR-1, and CRM aggregator tests
│   └── tax.test.js       # Statutory GST & NC financial tests
└── docs/
    └── USER_GUIDE.md     # Complete operational manual (Sections 1 to 13)
```

---

## 📜 License
Distributed under the MIT License. OpenBill / The Retro Cafeteria Team (2026).
