/**
 * src/core/tax.js
 * The Retro Cafeteria POS — Statutory Indian GST & Financial Billing Engine
 * Version 3.0 Compliance: 5% Composite GST (2.5% CGST + 2.5% SGST), SAC 9963, Half-Up Rounding
 */

/**
 * Validates and sanitizes a monetary input.
 * @param {any} value 
 * @returns {number}
 */
function sanitizeMoney(value) {
  const num = parseFloat(value);
  if (isNaN(num) || !isFinite(num) || num < 0) return 0;
  return Math.round(num * 100) / 100;
}

/**
 * Calculates item subtotal, discounts, statutory GST, round-off and grand total.
 * Supports both Exclusive GST (tax added on top) and Inclusive GST (tax extracted from price),
 * as well as Composition Scheme (Bill of Supply).
 * 
 * @param {number} rawSubtotal Raw sum of line items
 * @param {object} discountConfig { type: "percent"|"flat", value: number, reason?: string }
 * @param {object} taxOptions { gstRate?: number, inclusive?: boolean, compositionScheme?: boolean, rounding?: "round"|"none" }
 * @returns {object} Calculated billing figures
 */
function calculateBillTotals(rawSubtotal, discountConfig = { type: "percent", value: 0 }, taxOptions = {}) {
  const subtotal = sanitizeMoney(rawSubtotal);
  const gstRate = (taxOptions.gstRate === undefined || isNaN(taxOptions.gstRate) || taxOptions.gstRate < 0) 
    ? 5.0 
    : parseFloat(taxOptions.gstRate);
  const isInclusive = Boolean(taxOptions.inclusive);
  const isComposition = Boolean(taxOptions.compositionScheme);
  const isNC = Boolean(taxOptions.isNC);
  const ncReason = taxOptions.ncReason || discountConfig?.reason || "Complimentary / NC";
  const rounding = taxOptions.rounding || "round";
  const halfRate = Math.round((gstRate / 2.0) * 100) / 100;

  // Handle Complimentary / Non-Chargeable (NC) Orders
  if (isNC) {
    return {
      subtotal,
      discountAmount: subtotal,
      discountType: "nc",
      discountValue: 100,
      discountReason: ncReason,
      isNC: true,
      ncReason,
      taxableAmount: 0,
      sacCode: "9963",
      gstRate,
      cgstRate: halfRate,
      sgstRate: halfRate,
      cgst: 0,
      sgst: 0,
      totalTax: 0,
      isInclusive,
      isComposition,
      rawTotal: 0,
      roundoff: 0,
      grandTotal: 0
    };
  }

  // Discount calculation
  let discountAmount = 0;
  const dVal = sanitizeMoney(discountConfig ? discountConfig.value : 0);
  const dType = discountConfig ? discountConfig.type : "percent";

  if (dType === "percent") {
    const safePercent = Math.min(100, Math.max(0, dVal));
    discountAmount = Math.round(((subtotal * safePercent) / 100) * 100) / 100;
  } else {
    // Flat discount cannot exceed subtotal
    discountAmount = Math.min(subtotal, dVal);
  }

  const discountedBase = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);

  let taxableAmount = 0;
  let cgst = 0;
  let sgst = 0;
  let totalTax = 0;

  if (isComposition) {
    // Composition Scheme: Bill of Supply, no tax added to customer
    taxableAmount = discountedBase;
    cgst = 0;
    sgst = 0;
    totalTax = 0;
  } else if (isInclusive) {
    // Inclusive GST: Extract taxable base from total: base = total / (1 + rate / 100)
    taxableAmount = Math.round((discountedBase / (1 + (gstRate / 100))) * 100) / 100;
    totalTax = Math.round((discountedBase - taxableAmount) * 100) / 100;
    cgst = Math.round((totalTax / 2.0) * 100) / 100;
    sgst = Math.round((totalTax - cgst) * 100) / 100;
  } else {
    // Exclusive GST (Default): Tax added on top of discounted taxable base
    taxableAmount = discountedBase;
    cgst = Math.round(((taxableAmount * halfRate) / 100) * 100) / 100;
    sgst = Math.round(((taxableAmount * halfRate) / 100) * 100) / 100;
    totalTax = Math.round((cgst + sgst) * 100) / 100;
  }

  const rawTotal = isInclusive 
    ? discountedBase 
    : Math.round((taxableAmount + totalTax) * 100) / 100;

  let grandTotal = rawTotal;
  let roundoff = 0;

  if (rounding === "round") {
    grandTotal = Math.round(rawTotal);
    roundoff = Math.round((grandTotal - rawTotal) * 100) / 100;
  }

  return {
    subtotal,
    discountAmount,
    discountType: dType,
    discountValue: dVal,
    discountReason: discountConfig?.reason || "",
    taxableAmount,
    sacCode: "9963",
    gstRate,
    cgstRate: halfRate,
    sgstRate: halfRate,
    cgst,
    sgst,
    totalTax,
    isInclusive,
    isComposition,
    rawTotal,
    roundoff,
    grandTotal: Math.max(0, grandTotal)
  };
}

// Module export for Node.js test runner and browser window
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    sanitizeMoney,
    calculateBillTotals
  };
}
if (typeof window !== "undefined") {
  window.PosTax = {
    sanitizeMoney,
    calculateBillTotals
  };
}
