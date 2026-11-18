/**
 * tests/qr.test.js
 * Automated regression test suite for Offline QR & NPCI Dynamic UPI Generation
 */

const { test } = require('node:test');
const assert = require('node:assert');
const {
  generateUPIPaymentString,
  createQrMatrix,
  createQrSvg
} = require('../src/core/qr.js');

test('generateUPIPaymentString formats valid NPCI UPI payment URI scheme', () => {
  const uri = generateUPIPaymentString({
    upiId: "retrocafe@oksbi",
    storeName: "The Retro Cafeteria",
    amount: 105.00,
    billNumber: "2026-27/000001"
  });

  assert.ok(uri.startsWith("upi://pay?"));
  assert.ok(uri.includes("pa=retrocafe%40oksbi"));
  assert.ok(uri.includes("pn=The%20Retro%20Cafeteria"));
  assert.ok(uri.includes("am=105.00"));
  assert.ok(uri.includes("cu=INR"));
  assert.ok(uri.includes("tn=Bill%202026-27%2F000001"));
});

test('generateUPIPaymentString returns empty string if upiId is missing', () => {
  assert.strictEqual(generateUPIPaymentString({ amount: 100 }), "");
  assert.strictEqual(generateUPIPaymentString(null), "");
});

test('createQrMatrix generates non-empty boolean 2D matrix', () => {
  const upiUri = generateUPIPaymentString({
    upiId: "retrocafe@oksbi",
    storeName: "The Retro Cafeteria",
    amount: 105.00
  });

  const matrix = createQrMatrix(upiUri);
  assert.ok(Array.isArray(matrix));
  assert.ok(matrix.length >= 21); // At least Version 1 size
  assert.strictEqual(matrix.length, matrix[0].length);

  // Top-left finder pattern test: (0,0) must be true (black), (0,7) separator false
  assert.strictEqual(matrix[0][0], true);
  assert.strictEqual(matrix[0][1], true);
  assert.strictEqual(matrix[1][1], false);
});

test('createQrSvg returns valid SVG markup string', () => {
  const svg = createQrSvg("upi://pay?pa=test@upi&am=50.00&cu=INR", { size: 180 });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes('width="180"'));
  assert.ok(svg.includes('height="180"'));
  assert.ok(svg.includes("<rect"));
  assert.ok(svg.endsWith("</svg>"));
});
