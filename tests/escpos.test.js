/**
 * tests/escpos.test.js
 * Automated regression test suite for Thermal Monospace formatting (80mm & 58mm)
 */

const { test } = require('node:test');
const assert = require('node:assert');
const {
  formatBill80mm,
  formatBill58mm,
  formatKitchenKOT,
  formatZReportSlip,
  ESC_DRAWER_KICK
} = require('../src/core/escpos.js');

const sampleBill = {
  billNo: "2026-27/000123",
  date: "18-11-2026",
  time: "13:42",
  orderType: "Dine-in",
  tableName: "Table 5",
  cashier: "Pooja",
  items: [
    { name: "Chicken Burger", qty: 2, unitPrice: 120 },
    { name: "Peri Peri Fries (L)", qty: 1, unitPrice: 90 },
    { name: "Mint Mojito", qty: 2, unitPrice: 80 }
  ],
  subtotal: 490,
  taxableAmount: 490,
  cgst: 12.25,
  sgst: 12.25,
  roundoff: -0.50,
  grandTotal: 514,
  paymentMode: "Cash",
  changeDue: 86
};

test('formatBill80mm generates correct header, items, tax lines and total', () => {
  const text = formatBill80mm(sampleBill);

  assert.ok(text.includes("THE RETRO CAFETERIA"));
  assert.ok(text.includes("TAX INVOICE"));
  assert.ok(text.includes("Bill No: 2026-27/000123"));
  assert.ok(text.includes("Dine-in | Table 5"));
  assert.ok(text.includes("Chicken Burger"));
  assert.ok(text.includes("Taxable value (SAC 9963)"));
  assert.ok(text.includes("CGST @ 2.5%"));
  assert.ok(text.includes("SGST @ 2.5%"));
  assert.ok(text.includes("Rs 514.00"));
});

test('formatBill80mm includes DUPLICATE banner on reprint', () => {
  const duplicateBill = { ...sampleBill, isDuplicate: true };
  const text = formatBill80mm(duplicateBill);

  assert.ok(text.includes("*** DUPLICATE COPY ***"));
});

test('formatBill58mm generates compact 32-column layout', () => {
  const text = formatBill58mm(sampleBill);

  assert.ok(text.includes("THE RETRO CAFETERIA"));
  assert.ok(text.includes("Bill No: 2026-27/000123"));
  assert.ok(text.includes("TOTAL"));
  assert.ok(text.includes("Rs 514.00"));
});

test('formatKitchenKOT outputs dish names, quantities and notes without prices', () => {
  const kot = {
    orderType: "Dine-in",
    tableName: "Table 5",
    time: "13:42",
    items: [
      { name: "Chicken Burger", qty: 2, note: "No onion" },
      { name: "Peri Peri Fries (L)", qty: 1 }
    ]
  };

  const text = formatKitchenKOT(kot);

  assert.ok(text.includes("KITCHEN SLIP"));
  assert.ok(text.includes("2 x  Chicken Burger"));
  assert.ok(text.includes("* No onion"));
  assert.ok(!text.includes("Rs"));
  assert.ok(!text.includes("₹"));
});

test('formatZReportSlip outputs complete daily reconciliation summary', () => {
  const summary = {
    date: "18-11-2026",
    billCount: 45,
    cancelledCount: 1,
    subtotal: 18500,
    discounts: 500,
    taxableValue: 18000,
    cgst: 450,
    sgst: 450,
    totalTax: 900,
    roundoff: 0,
    grossSales: 18900,
    payments: {
      cash: { count: 20, total: 8000 },
      upi: { count: 22, total: 9500 },
      card: { count: 3, total: 1400 }
    }
  };

  const text = formatZReportSlip(summary);

  assert.ok(text.includes("DAILY SALES Z-REPORT"));
  assert.ok(text.includes("Total Bills Settled"));
  assert.ok(text.includes("NET SALES REVENUE"));
  assert.ok(text.includes("Rs 18900.00"));
  assert.ok(text.includes("EXPECTED CASH IN DRAWER"));
});

test('ESC_DRAWER_KICK contains standard ESC/POS pulse sequence', () => {
  assert.strictEqual(ESC_DRAWER_KICK, "\x1b\x70\x00\x19\xfa");
});

test('formatBill80mm outputs COMPLIMENTARY banner and reason for NC bills', () => {
  const ncBill = {
    ...sampleBill,
    isNC: true,
    ncReason: "Food Quality Replacement",
    grandTotal: 0,
    discountAmount: 490
  };

  const text = formatBill80mm(ncBill);
  assert.ok(text.includes("*** COMPLIMENTARY (NC) ***"));
  assert.ok(text.includes("COMPLIMENTARY INVOICE"));
  assert.ok(text.includes("Complimentary (100% NC)"));
  assert.ok(text.includes("Reason: Food Quality Replacement"));
  assert.ok(text.includes("Rs 0.00"));
});

test('formatBill80mm renders UPI payment details when payment mode is UPI', () => {
  const upiBill = {
    ...sampleBill,
    paymentMode: "UPI"
  };

  const text = formatBill80mm(upiBill, { upiId: "retrocafe@oksbi" });
  assert.ok(text.includes("SCAN TO PAY VIA ANY UPI APP"));
  assert.ok(text.includes("UPI VPA: retrocafe@oksbi"));
  assert.ok(text.includes("Payable: Rs 514.00"));
});
