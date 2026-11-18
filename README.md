# The Retro Cafeteria: POS Billing Software

**Version:** 3.0 (Offline-First Single Outlet Edition)  
**Location:** Gandhi Road, Near Varadaraja Perumal Temple, Kanchipuram, Tamil Nadu - 631501  
**Statutory GSTIN:** `33AABCR1234F1Z5` | **FSSAI Licence:** `11223344556677`

---

## Overview

A high-speed, zero-lag, offline-first restaurant billing POS software built specifically for **The Retro Cafeteria** based on **Design Specification Version 3.0** and incorporating core architectural components from **OpenBill** (semantic thermal receipt generation, 80mm & 58mm ESC/POS layout, business date reconciliation, and keyboard-first billing).

---

## Key Features

1. **High-Speed Billing & Order Types:**
   - **Counter Sale (`F1`):** Instant walk-in billing. Daily token numbers starting from #1. Print tax invoices in 3 steps under 15 seconds.
   - **Dine-in Tables (`F2`):** Floor layout across Main Hall and AC Section. Multi-round ordering. Table move & merge support.
   - **Takeaway Parcel (`F3`):** Customer name, phone, token number, and hold-order option (`F9`).
   - **Held Orders (`F4`):** 1-click order parking and resumption.

2. **Statutory Indian GST Compliance (Tamil Nadu Edition):**
   - 5% Composite GST split equally into **2.5% CGST + 2.5% SGST** with **SAC Code 9963** (Restaurant Service).
   - Consecutive bill numbering per Indian financial year: `YYYY-YY/NNNNNN` (e.g. `2026-27/000001`), April 1 to March 31. Numbers never repeat, never reset mid-year, and are never deleted.
   - **Bill Cancellation Audit:** Requires Owner PIN and mandatory text reason. Cancelled bills are preserved in the series, marked `CANCELLED`, and excluded from sales & tax totals.
   - **Reprints:** Any reprinted bill automatically bears a prominent `*** DUPLICATE COPY ***` banner.
   - Support for both standard **Tax Invoice** and Composition Scheme **Bill of Supply**.

3. **Thermal Receipt Printing Engine (Adapted from OpenBill):**
   - Monospace ESC/POS layout engine supporting both **80 mm (48 columns)** and **58 mm (32 columns)** receipt paper rolls.
   - **Kitchen Order Tickets (KOT):** Prints on the same receipt printer (`F6`). Only prints new items added since the previous round. Double-height text, dish names, quantities, and instructions without prices.
   - In-app **Thermal Receipt Preview** and standard Windows thermal printing (`@media print` formatted for zero margins).
   - Test print utility in Settings.

4. **Security & Role-Based Access Control (4-Digit PIN):**
   - **Owner (PIN: `1234`):** Full administrative rights (menu editing, pricing, settings, full reports, cancelling bills, unlimited discounts).
   - **Cashier (PIN: `0000`):** Order taking, printing bills, reprinting, discounts up to owner-set limit (default 10%).
   - Auto-lock after 5 minutes of idle time.

5. **Menu & Product Management:**
   - Add, edit, duplicate, and delete products.
   - Quick short-codes (e.g. `CB` for Chicken Burger, `PF` for Peri Peri Fries) for keyboard-only item addition (`short-code + Enter`).
   - One-click "Sold Out" toggle.
   - Bulk price adjustments (+% or +₹) with live preview.
   - Pre-loaded with official Retro Cafeteria sample items (1-click loadable anytime).

6. **Daily Financial Reports & Z-Report:**
   - Gross revenue, taxable value, CGST, SGST, roundoff, and net revenue.
   - Payment tender breakdown: Cash, UPI, and Card.
   - Expected cash in drawer counter.
   - Item-wise sales breakdown with revenue ranking.
   - Statutory GST Summary ready for tax filing.
   - 1-click **Print Daily Z-Report** slip and **Export to CSV**.

7. **100% Offline & Zero Lag:**
   - Operates completely offline without requiring internet.
   - Persistent LocalStorage database with automatic corruption recovery.
   - 1-click **Export Backup (JSON)** and **Restore Backup**.

---

## Getting Started

### 1-Click Launch (Windows)
Double-click `start.bat` in this folder, or execute:
```cmd
python server.py
```
The software starts instantly on `http://127.0.0.1:3000` and automatically opens in your default browser.

### Running Automated Test Suite
```cmd
npm test
```
*or*
```cmd
node --test tests/*.test.js
```
Runs the 25 automated regression tests for financial calculations, cart immutability, role permissions, storage sequence, and thermal formatting in ~200ms.

---

## Keyboard Shortcuts Quick Reference

- `F1`: New Counter Sale
- `F2`: Dine-in Tables
- `F3`: New Takeaway
- `F4`: Open / Held Orders
- `/` or `Ctrl+F`: Focus Dish Search
- `code + Enter`: Add Item by Short-Code
- `F6`: Print Kitchen Slip (KOT)
- `F8`: Apply Discount
- `F9`: Hold Order
- `F12` or `Ctrl+Enter`: Pay & Print Bill
- `Esc`: Close Modal / Lock
- `?`: Shortcuts Cheat Sheet
