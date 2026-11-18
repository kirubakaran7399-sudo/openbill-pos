/**
 * src/core/auth.js
 * The Retro Cafeteria POS — RoleGuard Authentication & Authorization Engine
 * Strict 4-digit PIN validation and hierarchical access controls per Spec §3
 */

const ROLE_HIERARCHY = {
  "owner": 5,
  "manager": 4,
  "cashier": 3
};

const DEFAULT_STAFF = [
  { id: "usr_owner", name: "Store Owner", role: "owner", pin: "1234", title: "Owner / Manager" },
  { id: "usr_cashier", name: "Main Cashier", role: "cashier", pin: "0000", title: "Counter Cashier" }
];

/**
 * Validates whether an entered PIN format is acceptable (exactly 4 numeric digits).
 * @param {string|number} pin 
 * @returns {boolean}
 */
function isValidPinFormat(pin) {
  if (pin === null || pin === undefined) return false;
  const str = String(pin).trim();
  return /^\d{4}$/.test(str);
}

/**
 * Authenticates staff member by 4-digit PIN against staff roster.
 * @param {string|number} pin 
 * @param {Array} staffList 
 * @returns {object|null} Matched staff member or null
 */
function authenticateStaff(pin, staffList = DEFAULT_STAFF) {
  if (!isValidPinFormat(pin)) return null;
  const strPin = String(pin).trim();
  const roster = Array.isArray(staffList) && staffList.length > 0 ? staffList : DEFAULT_STAFF;
  const matched = roster.find(s => s && String(s.pin) === strPin);
  return matched || null;
}

/**
 * Verifies if active user role meets or exceeds required operational permission.
 * @param {string} userRole 
 * @param {string} requiredRole 
 * @returns {boolean}
 */
function checkRolePermission(userRole, requiredRole) {
  const normalizedUser = String(userRole || "").toLowerCase();
  const normalizedReq = String(requiredRole || "").toLowerCase();

  const userLevel = ROLE_HIERARCHY[normalizedUser] || 0;
  const reqLevel = ROLE_HIERARCHY[normalizedReq] || 0;

  return userLevel >= reqLevel;
}

/**
 * Checks if a requested discount percentage is permitted for the cashier role without owner elevation.
 * @param {number} discountPercent 
 * @param {string} userRole 
 * @param {number} maxCashierLimit Default 10%
 * @returns {boolean} true if allowed directly, false if owner PIN required
 */
function isDiscountAllowed(discountPercent, userRole, maxCashierLimit = 10) {
  if (checkRolePermission(userRole, "owner")) return true;
  const pct = parseFloat(discountPercent) || 0;
  return pct <= maxCashierLimit;
}

/**
 * Validates owner elevation PIN for restricted operations (cancel bill, excess discount, settings edit).
 * @param {string|number} pin 
 * @param {Array} staffList 
 * @returns {boolean}
 */
function verifyOwnerPin(pin, staffList = DEFAULT_STAFF) {
  const staff = authenticateStaff(pin, staffList);
  return Boolean(staff && checkRolePermission(staff.role, "owner"));
}

// Module export for Node.js test runner and browser window
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ROLE_HIERARCHY,
    DEFAULT_STAFF,
    isValidPinFormat,
    authenticateStaff,
    checkRolePermission,
    isDiscountAllowed,
    verifyOwnerPin
  };
}
if (typeof window !== "undefined") {
  window.PosAuth = {
    ROLE_HIERARCHY,
    DEFAULT_STAFF,
    isValidPinFormat,
    authenticateStaff,
    checkRolePermission,
    isDiscountAllowed,
    verifyOwnerPin
  };
}
