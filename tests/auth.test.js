/**
 * tests/auth.test.js
 * Automated regression test suite for Authentication, PIN verification & Role-Based Access Controls
 */

const { test } = require('node:test');
const assert = require('node:assert');
const {
  isValidPinFormat,
  authenticateStaff,
  checkRolePermission,
  isDiscountAllowed,
  verifyOwnerPin,
  DEFAULT_STAFF
} = require('../src/core/auth.js');

test('isValidPinFormat validates exactly 4 numeric digits', () => {
  assert.strictEqual(isValidPinFormat("1234"), true);
  assert.strictEqual(isValidPinFormat("0000"), true);
  assert.strictEqual(isValidPinFormat(1234), true);
  assert.strictEqual(isValidPinFormat("123"), false);
  assert.strictEqual(isValidPinFormat("12345"), false);
  assert.strictEqual(isValidPinFormat("abcd"), false);
  assert.strictEqual(isValidPinFormat(""), false);
  assert.strictEqual(isValidPinFormat(null), false);
});

test('authenticateStaff authenticates owner and cashier PINs correctly', () => {
  const owner = authenticateStaff("1234", DEFAULT_STAFF);
  assert.ok(owner);
  assert.strictEqual(owner.role, "owner");

  const cashier = authenticateStaff("0000", DEFAULT_STAFF);
  assert.ok(cashier);
  assert.strictEqual(cashier.role, "cashier");

  const invalid = authenticateStaff("9999", DEFAULT_STAFF);
  assert.strictEqual(invalid, null);
});

test('checkRolePermission evaluates hierarchy properly', () => {
  assert.strictEqual(checkRolePermission("owner", "cashier"), true);
  assert.strictEqual(checkRolePermission("owner", "owner"), true);
  assert.strictEqual(checkRolePermission("cashier", "cashier"), true);
  assert.strictEqual(checkRolePermission("cashier", "owner"), false);
});

test('isDiscountAllowed enforces cashier limits and owner elevation', () => {
  // Cashier has default limit of 10%
  assert.strictEqual(isDiscountAllowed(5, "cashier", 10), true);
  assert.strictEqual(isDiscountAllowed(10, "cashier", 10), true);
  assert.strictEqual(isDiscountAllowed(15, "cashier", 10), false); // Requires owner PIN

  // Owner can grant any discount
  assert.strictEqual(isDiscountAllowed(25, "owner", 10), true);
  assert.strictEqual(isDiscountAllowed(50, "owner", 10), true);
});

test('verifyOwnerPin validates owner PIN', () => {
  assert.strictEqual(verifyOwnerPin("1234", DEFAULT_STAFF), true);
  assert.strictEqual(verifyOwnerPin("0000", DEFAULT_STAFF), false); // Cashier pin is not owner
  assert.strictEqual(verifyOwnerPin("9999", DEFAULT_STAFF), false);
});
