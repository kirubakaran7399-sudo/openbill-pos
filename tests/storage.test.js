/**
 * tests/storage.test.js
 * Automated regression test suite for Safe Storage, Consecutive Bill Sequence & Aggregation
 */

const { test } = require('node:test');
const assert = require('node:assert');
const {
  getFinancialYear,
  formatBillNumber,
  safeJsonParse,
  aggregateSalesSummary,
  formatWhatsAppDailySummary,
  formatNCAlertMessage,
  generateGSTR1B2CSExport,
  generateAuditorSalesRegisterCSV,
  normalizePhoneNumber,
  aggregateCustomerCRM,
  getCustomerByPhone
} = require('../src/core/storage.js');

test('getFinancialYear generates Indian financial year accurately (April to March)', () => {
  assert.strictEqual(getFinancialYear(new Date("2026-04-01")), "2026-27");
  assert.strictEqual(getFinancialYear(new Date("2026-11-18")), "2026-27");
  assert.strictEqual(getFinancialYear(new Date("2027-03-31")), "2026-27");
  assert.strictEqual(getFinancialYear(new Date("2027-04-01")), "2027-28");
});

test('formatBillNumber returns zero-padded consecutive bill string', () => {
  const d = new Date("2026-11-18");
  assert.strictEqual(formatBillNumber(1, d), "2026-27/000001");
  assert.strictEqual(formatBillNumber(123, d), "2026-27/000123");
  assert.strictEqual(formatBillNumber(99999, d), "2026-27/099999");
});

test('safeJsonParse falls back gracefully on corrupted inputs', () => {
  assert.deepStrictEqual(safeJsonParse('{"ok":true}', {}), { ok: true });
  assert.deepStrictEqual(safeJsonParse('{invalid_json', { fallback: 1 }), { fallback: 1 });
  assert.deepStrictEqual(safeJsonParse(null, null), null);
});

test('aggregateSalesSummary aggregates revenue and EXCLUDES cancelled bills', () => {
  const ledger = [
    {
      billNo: "2026-27/000001",
      date: "2026-11-18",
      subtotal: 490,
      taxableAmount: 490,
      cgst: 12.25,
      sgst: 12.25,
      grandTotal: 514,
      paymentMode: "CASH",
      items: [{ name: "Chicken Burger", qty: 2, unitPrice: 120 }, { name: "Peri Fries", qty: 1, unitPrice: 90 }, { name: "Mint Mojito", qty: 2, unitPrice: 80 }]
    },
    {
      billNo: "2026-27/000002",
      date: "2026-11-18",
      subtotal: 200,
      taxableAmount: 200,
      cgst: 5,
      sgst: 5,
      grandTotal: 210,
      paymentMode: "UPI",
      items: [{ name: "Shawarma", qty: 2, unitPrice: 100 }]
    },
    {
      billNo: "2026-27/000003",
      date: "2026-11-18",
      subtotal: 100,
      taxableAmount: 100,
      cgst: 2.5,
      sgst: 2.5,
      grandTotal: 105,
      isCancelled: true,
      cancelReason: "Customer left without paying",
      cancelledBy: "Store Owner",
      paymentMode: "CASH",
      items: [{ name: "Chicken Burger", qty: 1, unitPrice: 100 }]
    }
  ];

  const report = aggregateSalesSummary(ledger);

  // Active bills: 2; Cancelled bills: 1
  assert.strictEqual(report.billCount, 2);
  assert.strictEqual(report.cancelledCount, 1);

  // Total gross = 514 + 210 = 724 (Cancelled 105 is excluded)
  assert.strictEqual(report.grossSales, 724);
  assert.strictEqual(report.subtotal, 690);
  assert.strictEqual(report.cgst, 17.25);
  assert.strictEqual(report.sgst, 17.25);
  assert.strictEqual(report.totalTax, 34.50);

  // Payment breakdown
  assert.strictEqual(report.payments.cash.total, 514);
  assert.strictEqual(report.payments.upi.total, 210);

  // Item sales includes only active bills
  const cb = report.itemSales.find(it => it.name === "Chicken Burger");
  assert.ok(cb);
  assert.strictEqual(cb.qty, 2); // Cancelled bill's 1 burger is not counted
});

test('formatWhatsAppDailySummary generates formatted message with key metrics', () => {
  const summary = {
    date: "2026-11-18",
    billCount: 15,
    grossSales: 6500,
    taxableValue: 6190.48,
    totalTax: 309.52,
    cancelledCount: 1,
    payments: {
      cash: { total: 3000 },
      upi: { total: 3500 },
      card: { total: 0 }
    }
  };

  const text = formatWhatsAppDailySummary(summary, { name: "The Retro Cafeteria" });
  assert.ok(text.includes("THE RETRO CAFETERIA — DAILY SALES SUMMARY"));
  assert.ok(text.includes("Date: 2026-11-18"));
  assert.ok(text.includes("Bills Settled: 15"));
  assert.ok(text.includes("Cancelled Bills: 1"));
  assert.ok(text.includes("Net Sales Revenue: Rs 6500.00"));
  assert.ok(text.includes("Cash: Rs 3000.00"));
  assert.ok(text.includes("UPI: Rs 3500.00"));
});

test('formatNCAlertMessage formats actionable alert with bill and item details', () => {
  const bill = {
    billNo: "2026-27/000042",
    date: "2026-11-18",
    time: "14:15",
    cashier: "Pooja",
    ncReason: "VIP Owner Guest",
    subtotal: 330,
    items: [
      { name: "Chicken Burger", qty: 2, unitPrice: 120 },
      { name: "Peri Peri Fries (L)", qty: 1, unitPrice: 90 }
    ]
  };

  const alert = formatNCAlertMessage(bill, { name: "The Retro Cafeteria" });
  assert.ok(alert.includes("COMPLIMENTARY (NC) BILL ALERT"));
  assert.ok(alert.includes("2026-27/000042"));
  assert.ok(alert.includes("VIP Owner Guest"));
  assert.ok(alert.includes("2x Chicken Burger"));
  assert.ok(alert.includes("Total Value Waived: Rs 330.00"));
});

test('generateGSTR1B2CSExport formats Table 7 B2CS row and portal-ready CSV', () => {
  const ledger = [
    {
      billNo: "2026-27/000001",
      taxableAmount: 1000,
      cgst: 25,
      sgst: 25,
      grandTotal: 1050
    },
    {
      billNo: "2026-27/000002",
      taxableAmount: 2000,
      cgst: 50,
      sgst: 50,
      grandTotal: 2100
    },
    {
      billNo: "2026-27/000003",
      taxableAmount: 500,
      cgst: 12.5,
      sgst: 12.5,
      grandTotal: 525,
      isCancelled: true
    }
  ];

  const exportData = generateGSTR1B2CSExport(ledger, {}, { gstin: "33AABCR1234F1Z5" });
  assert.strictEqual(exportData.summaryRow.placeOfSupply, "33-Tamil Nadu");
  assert.strictEqual(exportData.summaryRow.rate, 5.0);
  assert.strictEqual(exportData.summaryRow.taxableValue, 3000);
  assert.strictEqual(exportData.summaryRow.centralTax, 75);
  assert.strictEqual(exportData.summaryRow.stateTax, 75);
  assert.strictEqual(exportData.summaryRow.totalInvoiceValue, 3150);

  assert.ok(exportData.csv.includes("B2CS,OE,33-Tamil Nadu,5.00,,3000.00,0.00,75.00,75.00,3150.00"));
});

test('generateAuditorSalesRegisterCSV outputs line items and handles quotes', () => {
  const ledger = [
    {
      billNo: "2026-27/000001",
      date: "2026-11-18",
      customerName: "Ramesh, Babu",
      customerPhone: "9876543210",
      subtotal: 100,
      taxableAmount: 100,
      cgst: 2.5,
      sgst: 2.5,
      grandTotal: 105,
      paymentMode: "Cash"
    }
  ];

  const csv = generateAuditorSalesRegisterCSV(ledger);
  assert.ok(csv.includes("Bill No,Date,Time"));
  assert.ok(csv.includes('"Ramesh, Babu"'));
  assert.ok(csv.includes("9876543210"));
  assert.ok(csv.includes("105.00"));
});

test('normalizePhoneNumber cleans 10, 11 and 12 digit inputs', () => {
  assert.strictEqual(normalizePhoneNumber("9876543210"), "9876543210");
  assert.strictEqual(normalizePhoneNumber("+91 98765 43210"), "9876543210");
  assert.strictEqual(normalizePhoneNumber("09876543210"), "9876543210");
  assert.strictEqual(normalizePhoneNumber("123"), "");
});

test('aggregateCustomerCRM computes lifetime spend, favorites and repeat order reference', () => {
  const ledger = [
    {
      billNo: "2026-27/000001",
      date: "2026-11-10",
      customerName: "Karthik",
      customerPhone: "9876543210",
      grandTotal: 300,
      items: [{ name: "Chicken Burger", qty: 2 }]
    },
    {
      billNo: "2026-27/000002",
      date: "2026-11-18",
      customerName: "Karthik R",
      customerPhone: "9876543210",
      grandTotal: 250,
      items: [{ name: "Chicken Burger", qty: 1 }, { name: "Peri Peri Fries (L)", qty: 1 }]
    },
    {
      billNo: "2026-27/000003",
      date: "2026-11-18",
      customerName: "Sneha",
      customerPhone: "9123456789",
      grandTotal: 120,
      items: [{ name: "Mint Mojito", qty: 1 }]
    }
  ];

  const crm = aggregateCustomerCRM(ledger);
  assert.strictEqual(crm.length, 2);

  const karthik = crm[0];
  assert.strictEqual(karthik.phone, "9876543210");
  assert.strictEqual(karthik.totalVisits, 2);
  assert.strictEqual(karthik.lifetimeSpend, 550);
  assert.strictEqual(karthik.favoriteDish, "Chicken Burger");
  assert.ok(karthik.lastBill);
  assert.strictEqual(karthik.lastBill.billNo, "2026-27/000002");

  const lookup = getCustomerByPhone(ledger, "+91 98765 43210");
  assert.ok(lookup);
  assert.strictEqual(lookup.name, "Karthik R");
});
