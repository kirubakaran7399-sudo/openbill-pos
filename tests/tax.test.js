/**
 * tests/tax.test.js
 * Automated regression test suite for Tax & Financial Billing calculations
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { calculateBillTotals, sanitizeMoney } = require('../src/core/tax.js');

test('sanitizeMoney handles normal, negative, and invalid values', () => {
  assert.strictEqual(sanitizeMoney(100), 100);
  assert.strictEqual(sanitizeMoney(100.456), 100.46);
  assert.strictEqual(sanitizeMoney(-50), 0);
  assert.strictEqual(sanitizeMoney("invalid"), 0);
  assert.strictEqual(sanitizeMoney(null), 0);
});

test('calculateBillTotals: Standard 5% GST (Exclusive) on Rs 490 subtotal matches Spec §8.2', () => {
  // Raw subtotal = 490, Discount = 0, 5% GST (CGST 2.5% = 12.25, SGST 2.5% = 12.25)
  // Raw total = 490 + 24.50 = 514.50. Round off = +0.50 -> Grand Total = Rs 515
  const res = calculateBillTotals(490, { type: "percent", value: 0 }, { gstRate: 5.0, inclusive: false, rounding: "round" });

  assert.strictEqual(res.subtotal, 490);
  assert.strictEqual(res.discountAmount, 0);
  assert.strictEqual(res.taxableAmount, 490);
  assert.strictEqual(res.cgstRate, 2.5);
  assert.strictEqual(res.sgstRate, 2.5);
  assert.strictEqual(res.cgst, 12.25);
  assert.strictEqual(res.sgst, 12.25);
  assert.strictEqual(res.totalTax, 24.50);
  assert.strictEqual(res.rawTotal, 514.50);
  assert.strictEqual(res.roundoff, 0.50);
  assert.strictEqual(res.grandTotal, 515);
});

test('calculateBillTotals: Percentage discount reduces taxable base before GST', () => {
  // Subtotal = 1000, 10% discount = 100. Taxable = 900.
  // CGST 2.5% of 900 = 22.50, SGST 2.5% of 900 = 22.50.
  // Grand total = 900 + 45 = 945.
  const res = calculateBillTotals(1000, { type: "percent", value: 10 }, { gstRate: 5.0 });

  assert.strictEqual(res.discountAmount, 100);
  assert.strictEqual(res.taxableAmount, 900);
  assert.strictEqual(res.cgst, 22.50);
  assert.strictEqual(res.sgst, 22.50);
  assert.strictEqual(res.grandTotal, 945);
});

test('calculateBillTotals: Flat discount is bounded by subtotal', () => {
  // Subtotal = 150, Flat discount requested = 200 -> capped at 150. Taxable = 0.
  const res = calculateBillTotals(150, { type: "flat", value: 200 });

  assert.strictEqual(res.discountAmount, 150);
  assert.strictEqual(res.taxableAmount, 0);
  assert.strictEqual(res.grandTotal, 0);
});

test('calculateBillTotals: Inclusive GST mode extracts tax backward without increasing total', () => {
  // Price = 105 inclusive of 5% GST.
  // Taxable = 105 / 1.05 = 100. CGST = 2.50, SGST = 2.50. Grand Total = 105.
  const res = calculateBillTotals(105, { type: "percent", value: 0 }, { gstRate: 5.0, inclusive: true });

  assert.strictEqual(res.taxableAmount, 100);
  assert.strictEqual(res.totalTax, 5);
  assert.strictEqual(res.grandTotal, 105);
});

test('calculateBillTotals: Composition Scheme produces 0 tax (Bill of Supply)', () => {
  const res = calculateBillTotals(500, { type: "percent", value: 0 }, { compositionScheme: true });

  assert.strictEqual(res.isComposition, true);
  assert.strictEqual(res.cgst, 0);
  assert.strictEqual(res.sgst, 0);
  assert.strictEqual(res.totalTax, 0);
  assert.strictEqual(res.grandTotal, 500);
});

test('calculateBillTotals: Complimentary (NC) Bill waives 100% amount with 0 tax and records reason', () => {
  const res = calculateBillTotals(360, null, { isNC: true, ncReason: "VIP Owner Guest" });

  assert.strictEqual(res.isNC, true);
  assert.strictEqual(res.subtotal, 360);
  assert.strictEqual(res.discountAmount, 360);
  assert.strictEqual(res.ncReason, "VIP Owner Guest");
  assert.strictEqual(res.taxableAmount, 0);
  assert.strictEqual(res.cgst, 0);
  assert.strictEqual(res.sgst, 0);
  assert.strictEqual(res.grandTotal, 0);
});
