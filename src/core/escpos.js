/**
 * src/core/escpos.js
 * The Retro Cafeteria POS — Thermal Receipt & KOT Monospace Formatting Engine
 * Adapted from OpenBill Semantic Print Pipeline (Document & Layout Kernel)
 * Implements strict 80mm (48 col) and 58mm (32 col) layouts per Spec §8
 */

const DEFAULT_STORE_CONFIG = {
  name: "THE RETRO CAFETERIA",
  tagline: "CRAVE MORE. LIVE RETRO.",
  address1: "Gandhi Road, Near Varadaraja Perumal Temple",
  address2: "Kanchipuram, Tamil Nadu - 631501",
  phone: "+91 44 2722 3456",
  gstin: "33AABCR1234F1Z5",
  fssai: "11223344556677",
  footerMessage: "Thank you! Visit again.\nAuthorised signatory"
};

/**
 * Centers a string within a fixed column width.
 * @param {string} text 
 * @param {number} width 
 * @returns {string}
 */
function padCenter(text, width) {
  const str = String(text || "");
  if (str.length >= width) return str.slice(0, width);
  const left = Math.floor((width - str.length) / 2);
  const right = width - str.length - left;
  return " ".repeat(left) + str + " ".repeat(right);
}

/**
 * Creates a two-column row with left label and right value.
 * @param {string} left 
 * @param {string} right 
 * @param {number} width 
 * @returns {string}
 */
function makeRow(left, right, width) {
  const l = String(left || "");
  const r = String(right || "");
  const spaces = Math.max(1, width - l.length - r.length);
  return l + " ".repeat(spaces) + r;
}

/**
 * Wraps text into multiple lines of at most maxWidth characters.
 * @param {string} text 
 * @param {number} maxWidth 
 * @returns {string[]}
 */
function wrapText(text, maxWidth) {
  const str = String(text || "").trim();
  if (!str) return [];
  if (str.length <= maxWidth) return [str];

  const words = str.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current + " " + word).length <= maxWidth) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Formats standard 80mm ESC/POS customer tax invoice receipt (48 cols).
 * Spec §8.2
 * @param {object} bill 
 * @param {object} store 
 * @returns {string} Plain text receipt
 */
function formatBill80mm(bill, store = {}) {
  const config = { ...DEFAULT_STORE_CONFIG, ...store };
  const W = 48;
  const divider = "-".repeat(W);
  const doubleDivider = "=".repeat(W);

  const lines = [];

  // Header
  lines.push(padCenter(config.name.toUpperCase(), W));
  if (config.tagline) lines.push(padCenter(config.tagline, W));
  if (config.address1) lines.push(padCenter(config.address1, W));
  if (config.address2) lines.push(padCenter(config.address2, W));
  if (config.phone) lines.push(padCenter(`Ph: ${config.phone}`, W));
  if (config.gstin) lines.push(padCenter(`GSTIN: ${config.gstin}`, W));
  if (config.fssai) lines.push(padCenter(`FSSAI Lic. No: ${config.fssai}`, W));
  lines.push(divider);

  // Title / Duplicate Watermark
  if (bill.isDuplicate) {
    lines.push(padCenter("*** DUPLICATE COPY ***", W));
  }
  if (bill.isNC) {
    lines.push(padCenter("*** COMPLIMENTARY (NC) ***", W));
  }
  const title = bill.isNC ? "COMPLIMENTARY INVOICE" : (bill.isComposition ? "BILL OF SUPPLY" : "TAX INVOICE");
  lines.push(padCenter(title, W));

  // Bill Metadata
  lines.push(makeRow(`Bill No: ${bill.billNo || 'PENDING'}`, `Date: ${bill.date || ''}`, W));
  const orderType = bill.orderType || 'Counter';
  const locStr = bill.tableName ? `${orderType} | ${bill.tableName}` : (bill.tokenNumber ? `${orderType} | Token #${bill.tokenNumber}` : orderType);
  lines.push(makeRow(locStr, `Time: ${bill.time || ''}`, W));
  lines.push(makeRow(`Cashier: ${bill.cashier || 'Cashier'}`, bill.customerName ? `Cust: ${bill.customerName}` : '', W));
  if (bill.customerGstin) {
    lines.push(`Customer GSTIN: ${bill.customerGstin}`);
  }
  lines.push(divider);

  // Table Header
  // Item (24) Qty (4) Rate (9) Amount (11) = 48
  lines.push("Item                        Qty     Rate      Amount");
  lines.push(divider);

  // Items
  const items = Array.isArray(bill.items) ? bill.items : [];
  items.forEach(it => {
    const q = it.qty || 1;
    const rate = (it.unitPrice || it.basePrice || 0).toFixed(2);
    const amount = ((it.unitPrice || it.basePrice || 0) * q).toFixed(2);
    const nameLines = wrapText(it.name, 24);

    const firstLineName = (nameLines[0] || "").padEnd(24);
    const qtyStr = String(q).padStart(4);
    const rateStr = String(rate).padStart(9);
    const amtStr = String(amount).padStart(11);

    lines.push(`${firstLineName} ${qtyStr} ${rateStr} ${amtStr}`);
    for (let i = 1; i < nameLines.length; i++) {
      lines.push(nameLines[i]);
    }
    if (it.note) {
      lines.push(`  * Note: ${it.note}`);
    }
  });

  lines.push(divider);

  // Totals Breakdown
  const subtotal = (parseFloat(bill.subtotal) || 0).toFixed(2);
  const discount = (parseFloat(bill.discountAmount || bill.discount) || 0).toFixed(2);
  const taxable = (parseFloat(bill.taxableAmount) || 0).toFixed(2);
  const cgst = (parseFloat(bill.cgst) || 0).toFixed(2);
  const sgst = (parseFloat(bill.sgst) || 0).toFixed(2);
  const roundoff = (parseFloat(bill.roundoff) || 0).toFixed(2);
  const total = (parseFloat(bill.grandTotal) || 0).toFixed(2);

  lines.push(makeRow("Subtotal", subtotal, W));
  if (bill.isNC) {
    lines.push(makeRow("Complimentary (100% NC)", `-${subtotal}`, W));
    if (bill.ncReason) {
      lines.push(padCenter(`Reason: ${bill.ncReason}`, W));
    }
  } else if (parseFloat(discount) > 0) {
    const dReason = bill.discountReason ? ` (${bill.discountReason})` : "";
    lines.push(makeRow(`Discount${dReason}`, `-${discount}`, W));
  }

  if (!bill.isComposition) {
    lines.push(makeRow("Taxable value (SAC 9963)", taxable, W));
    lines.push(makeRow(`CGST @ ${bill.cgstRate || 2.5}%`, cgst, W));
    lines.push(makeRow(`SGST @ ${bill.sgstRate || 2.5}%`, sgst, W));
  }
  if (parseFloat(roundoff) !== 0) {
    lines.push(makeRow("Round off", (parseFloat(roundoff) > 0 ? `+${roundoff}` : roundoff), W));
  }

  lines.push(doubleDivider);
  lines.push(makeRow("TOTAL", `Rs ${total}`, W));
  lines.push(doubleDivider);

  // Payments
  if (Array.isArray(bill.payments) && bill.payments.length > 0) {
    bill.payments.forEach(p => {
      lines.push(makeRow(`Paid: ${p.mode}`, (parseFloat(p.amount) || 0).toFixed(2), W));
    });
  } else {
    lines.push(makeRow(`Paid: ${bill.paymentMode || 'Cash'}`, total, W));
  }
  if (bill.changeDue !== undefined && parseFloat(bill.changeDue) > 0) {
    lines.push(makeRow("Change", (parseFloat(bill.changeDue) || 0).toFixed(2), W));
  }

  // Dynamic UPI Payment Details
  if (config.upiId && parseFloat(total) > 0 && (bill.paymentMode === 'UPI' || config.printUpiQrOnBill)) {
    lines.push(divider);
    lines.push(padCenter("SCAN TO PAY VIA ANY UPI APP", W));
    lines.push(padCenter(`UPI VPA: ${config.upiId}`, W));
    lines.push(padCenter(`Payable: Rs ${total}`, W));
    lines.push(padCenter("[ Dynamic UPI QR Code ]", W));
  }

  // Token number highlight for Counter / Takeaway
  if (bill.tokenNumber) {
    lines.push(divider);
    lines.push(padCenter(`TOKEN NUMBER: ${bill.tokenNumber}`, W));
  }

  lines.push(divider);
  // Footer
  const footerLines = (config.footerMessage || "").split("\n");
  footerLines.forEach(fl => lines.push(padCenter(fl, W)));

  return lines.join("\n") + "\n";
}

/**
 * Formats standard 58mm ESC/POS customer tax invoice receipt (32 cols).
 * Spec §8.3
 * @param {object} bill 
 * @param {object} store 
 * @returns {string} Plain text receipt
 */
function formatBill58mm(bill, store = {}) {
  const config = { ...DEFAULT_STORE_CONFIG, ...store };
  const W = 32;
  const divider = "-".repeat(W);
  const doubleDivider = "=".repeat(W);

  const lines = [];

  // Header
  lines.push(padCenter(config.name.toUpperCase(), W));
  if (config.address1) lines.push(padCenter(config.address1, W));
  if (config.phone) lines.push(padCenter(`Ph: ${config.phone}`, W));
  if (config.gstin) lines.push(padCenter(`GSTIN: ${config.gstin}`, W));
  if (config.fssai) lines.push(padCenter(`FSSAI: ${config.fssai}`, W));
  lines.push(divider);

  if (bill.isDuplicate) {
    lines.push(padCenter("** DUPLICATE **", W));
  }
  if (bill.isNC) {
    lines.push(padCenter("** COMPLIMENTARY (NC) **", W));
  }
  const title = bill.isNC ? "COMPLIMENTARY BILL" : (bill.isComposition ? "BILL OF SUPPLY" : "TAX INVOICE");
  lines.push(padCenter(title, W));
  lines.push(`Bill No: ${bill.billNo || 'PENDING'}`);
  lines.push(makeRow(`Date: ${bill.date || ''}`, bill.time || '', W));
  const orderType = bill.orderType || 'Counter';
  const locStr = bill.tableName ? `${orderType} | ${bill.tableName}` : (bill.tokenNumber ? `${orderType} | Token #${bill.tokenNumber}` : orderType);
  lines.push(locStr);
  lines.push(divider);

  // Table Header
  lines.push(makeRow("Item", "Amount", W));
  lines.push(divider);

  const items = Array.isArray(bill.items) ? bill.items : [];
  items.forEach(it => {
    const q = it.qty || 1;
    const rate = (it.unitPrice || it.basePrice || 0).toFixed(2);
    const amount = ((it.unitPrice || it.basePrice || 0) * q).toFixed(2);

    lines.push(it.name);
    lines.push(makeRow(`  ${q} x ${rate}`, amount, W));
    if (it.note) {
      lines.push(`  * Note: ${it.note}`);
    }
  });

  lines.push(divider);

  const subtotal = (parseFloat(bill.subtotal) || 0).toFixed(2);
  const discount = (parseFloat(bill.discountAmount || bill.discount) || 0).toFixed(2);
  const taxable = (parseFloat(bill.taxableAmount) || 0).toFixed(2);
  const cgst = (parseFloat(bill.cgst) || 0).toFixed(2);
  const sgst = (parseFloat(bill.sgst) || 0).toFixed(2);
  const roundoff = (parseFloat(bill.roundoff) || 0).toFixed(2);
  const total = (parseFloat(bill.grandTotal) || 0).toFixed(2);

  lines.push(makeRow("Subtotal", subtotal, W));
  if (bill.isNC) {
    lines.push(makeRow("Complimentary", `-${subtotal}`, W));
  } else if (parseFloat(discount) > 0) {
    lines.push(makeRow("Discount", `-${discount}`, W));
  }

  if (!bill.isComposition) {
    lines.push(makeRow("Taxable (SAC 9963)", taxable, W));
    lines.push(makeRow(`CGST @ ${bill.cgstRate || 2.5}%`, cgst, W));
    lines.push(makeRow(`SGST @ ${bill.sgstRate || 2.5}%`, sgst, W));
  }
  if (parseFloat(roundoff) !== 0) {
    lines.push(makeRow("Round off", (parseFloat(roundoff) > 0 ? `+${roundoff}` : roundoff), W));
  }

  lines.push(doubleDivider);
  lines.push(makeRow("TOTAL", `Rs ${total}`, W));
  lines.push(doubleDivider);

  lines.push(makeRow(`Paid: ${bill.paymentMode || 'Cash'}`, total, W));
  if (bill.changeDue !== undefined && parseFloat(bill.changeDue) > 0) {
    lines.push(makeRow("Change", (parseFloat(bill.changeDue) || 0).toFixed(2), W));
  }

  // Dynamic UPI Payment Details
  if (config.upiId && parseFloat(total) > 0 && (bill.paymentMode === 'UPI' || config.printUpiQrOnBill)) {
    lines.push(divider);
    lines.push(padCenter("SCAN TO PAY VIA ANY UPI APP", W));
    lines.push(padCenter(`UPI VPA: ${config.upiId}`, W));
    lines.push(padCenter(`Payable: Rs ${total}`, W));
    lines.push(padCenter("[ Dynamic UPI QR Code ]", W));
  }

  if (bill.tokenNumber) {
    lines.push(divider);
    lines.push(padCenter(`TOKEN: ${bill.tokenNumber}`, W));
  }

  lines.push(divider);
  lines.push(padCenter("Thank you! Visit again.", W));

  return lines.join("\n") + "\n";
}

/**
 * Formats a Kitchen Order Ticket (KOT).
 * Spec §8.4 (Double-height quantities and dish names, notes indented, NO prices).
 * @param {object} kot 
 * @param {number} width 48 or 32
 * @returns {string} Plain text KOT
 */
function formatKitchenKOT(kot, width = 48) {
  const W = width;
  const divider = "-".repeat(W);
  const doubleDivider = "=".repeat(W);

  const lines = [];
  lines.push(padCenter("KITCHEN SLIP", W));
  const orderType = (kot.orderType || 'Dine-in').toUpperCase();
  const loc = kot.tableName ? `${orderType} | ${kot.tableName}` : (kot.tokenNumber ? `${orderType} | Token #${kot.tokenNumber}` : orderType);
  lines.push(makeRow(loc, kot.time || new Date().toLocaleTimeString("en-IN"), W));
  lines.push(divider);

  const items = Array.isArray(kot.items) ? kot.items : [];
  items.forEach(it => {
    const q = it.qty || 1;
    lines.push(`${String(q).padStart(2)} x  ${it.name}`);
    if (it.note) {
      lines.push(`       * ${it.note}`);
    }
  });

  lines.push(divider);
  return lines.join("\n") + "\n";
}

/**
 * Formats an End-of-Day Z-Report / Daily sales summary slip.
 * @param {object} summary 
 * @param {object} store 
 * @param {number} width 
 * @returns {string}
 */
function formatZReportSlip(summary, store = {}, width = 48) {
  const config = { ...DEFAULT_STORE_CONFIG, ...store };
  const W = width;
  const divider = "-".repeat(W);
  const doubleDivider = "=".repeat(W);

  const lines = [];
  lines.push(padCenter("DAILY SALES Z-REPORT", W));
  lines.push(padCenter(config.name.toUpperCase(), W));
  lines.push(padCenter(`Date: ${summary.date || new Date().toLocaleDateString("en-IN")}`, W));
  lines.push(divider);

  lines.push(makeRow("Total Bills Settled", String(summary.billCount || 0), W));
  lines.push(makeRow("Cancelled Bills", String(summary.cancelledCount || 0), W));
  lines.push(divider);

  lines.push(makeRow("Subtotal", (summary.subtotal || 0).toFixed(2), W));
  lines.push(makeRow("Discounts Given", `-${(summary.discounts || 0).toFixed(2)}`, W));
  lines.push(makeRow("Taxable Sales (SAC 9963)", (summary.taxableValue || 0).toFixed(2), W));
  lines.push(makeRow("CGST Collected (2.5%)", (summary.cgst || 0).toFixed(2), W));
  lines.push(makeRow("SGST Collected (2.5%)", (summary.sgst || 0).toFixed(2), W));
  lines.push(makeRow("Total GST Tax", (summary.totalTax || 0).toFixed(2), W));
  lines.push(makeRow("Round-off Adjustments", (summary.roundoff || 0).toFixed(2), W));
  lines.push(doubleDivider);
  lines.push(makeRow("NET SALES REVENUE", `Rs ${(summary.grossSales || 0).toFixed(2)}`, W));
  lines.push(doubleDivider);

  lines.push("PAYMENT METHOD BREAKDOWN:");
  const payments = summary.payments || {};
  lines.push(makeRow(`  CASH (${payments.cash?.count || 0})`, `Rs ${(payments.cash?.total || 0).toFixed(2)}`, W));
  lines.push(makeRow(`  UPI  (${payments.upi?.count || 0})`, `Rs ${(payments.upi?.total || 0).toFixed(2)}`, W));
  lines.push(makeRow(`  CARD (${payments.card?.count || 0})`, `Rs ${(payments.card?.total || 0).toFixed(2)}`, W));
  lines.push(divider);

  lines.push(makeRow("EXPECTED CASH IN DRAWER", `Rs ${(payments.cash?.total || 0).toFixed(2)}`, W));
  lines.push(divider);
  lines.push(padCenter("END OF DAY RECONCILIATION COMPLETE", W));

  return lines.join("\n") + "\n";
}

const ESC_DRAWER_KICK = "\x1b\x70\x00\x19\xfa"; // Standard ESC/POS drawer kick pulse command

// Module export for Node.js test runner and browser window
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_STORE_CONFIG,
    ESC_DRAWER_KICK,
    padCenter,
    makeRow,
    wrapText,
    formatBill80mm,
    formatBill58mm,
    formatKitchenKOT,
    formatZReportSlip
  };
}
if (typeof window !== "undefined") {
  window.PosEscpos = {
    DEFAULT_STORE_CONFIG,
    ESC_DRAWER_KICK,
    padCenter,
    makeRow,
    wrapText,
    formatBill80mm,
    formatBill58mm,
    formatKitchenKOT,
    formatZReportSlip
  };
}
