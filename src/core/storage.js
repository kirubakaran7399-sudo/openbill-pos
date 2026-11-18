/**
 * src/core/storage.js
 * The Retro Cafeteria POS — Safe Offline Storage & Sales Ledger Engine
 * Resilient state management, consecutive financial-year bill numbering, daily tokens & backups
 */

const STORAGE_KEYS = {
  STATE: "retro_pos_state_v3",
  BACKUP_PREFIX: "retro_pos_backup_"
};

/**
 * Returns the current Indian Financial Year string (e.g. "2026-27").
 * April 1 to March 31.
 * @param {Date} date 
 * @returns {string} e.g. "2026-27"
 */
function getFinancialYear(date = new Date()) {
  const d = new Date(date);
  const month = d.getMonth(); // 0 = Jan, 3 = April
  const fullYear = d.getFullYear();
  if (month >= 3) { // April onwards
    const nextYearShort = String((fullYear + 1) % 100).padStart(2, "0");
    return `${fullYear}-${nextYearShort}`;
  } else { // Jan, Feb, March
    const currentYearShort = String(fullYear % 100).padStart(2, "0");
    return `${fullYear - 1}-${currentYearShort}`;
  }
}

/**
 * Returns formatted consecutive bill number: "2026-27/000001"
 * @param {number} seq 
 * @param {Date} date 
 * @returns {string}
 */
function formatBillNumber(seq, date = new Date()) {
  const fy = getFinancialYear(date);
  const padded = String(seq || 1).padStart(6, "0");
  return `${fy}/${padded}`;
}

/**
 * Returns today's ISO date string (YYYY-MM-DD) in local time.
 * @param {Date} date 
 * @returns {string}
 */
function getLocalDateString(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Safely parses JSON with fallback default value on corruption.
 * @param {string} rawString 
 * @param {any} defaultValue 
 * @returns {any}
 */
function safeJsonParse(rawString, defaultValue = null) {
  if (typeof rawString !== "string" || !rawString.trim()) {
    return defaultValue;
  }
  try {
    return JSON.parse(rawString);
  } catch (err) {
    return defaultValue;
  }
}

/**
 * Aggregates summary figures from the sales ledger.
 * Cancelled bills are EXCLUDED from gross, net and tax totals per Spec §7.9,
 * but counted separately for the cancellation audit trail.
 * 
 * @param {Array} salesLedger 
 * @param {object} filterOptions { startDate?: string, endDate?: string }
 * @returns {object} Aggregated report
 */
function aggregateSalesSummary(salesLedger, filterOptions = {}) {
  const sales = Array.isArray(salesLedger) ? salesLedger : [];
  const start = filterOptions.startDate;
  const end = filterOptions.endDate;

  let activeBills = [];
  let cancelledBills = [];

  sales.forEach(bill => {
    if (!bill) return;
    const bDate = bill.date || (bill.timestamp ? bill.timestamp.split(" ")[0] : "");
    if (start && bDate < start) return;
    if (end && bDate > end) return;

    if (bill.isCancelled) {
      cancelledBills.push(bill);
    } else {
      activeBills.push(bill);
    }
  });

  let grossTotal = 0;
  let subtotalSum = 0;
  let discountTotal = 0;
  let taxableTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let roundoffTotal = 0;

  let cashTotal = 0;
  let cashCount = 0;
  let upiTotal = 0;
  let upiCount = 0;
  let cardTotal = 0;
  let cardCount = 0;

  const itemSales = {};

  activeBills.forEach(bill => {
    const grand = parseFloat(bill.grandTotal || 0) || 0;
    grossTotal += grand;
    subtotalSum += parseFloat(bill.subtotal || 0) || 0;
    discountTotal += parseFloat(bill.discountAmount || bill.discount || 0) || 0;
    taxableTotal += parseFloat(bill.taxableAmount || 0) || 0;
    cgstTotal += parseFloat(bill.cgst || 0) || 0;
    sgstTotal += parseFloat(bill.sgst || 0) || 0;
    roundoffTotal += parseFloat(bill.roundoff || 0) || 0;

    // Payment modes (support split payments)
    if (Array.isArray(bill.payments) && bill.payments.length > 0) {
      bill.payments.forEach(p => {
        const mode = String(p.mode || "").toUpperCase();
        const amt = parseFloat(p.amount || 0) || 0;
        if (mode === "CASH") {
          cashTotal += amt;
          cashCount++;
        } else if (mode === "UPI") {
          upiTotal += amt;
          upiCount++;
        } else if (mode === "CARD") {
          cardTotal += amt;
          cardCount++;
        }
      });
    } else {
      const mode = String(bill.paymentMode || "CASH").toUpperCase();
      if (mode.includes("UPI")) {
        upiTotal += grand;
        upiCount++;
      } else if (mode.includes("CARD")) {
        cardTotal += grand;
        cardCount++;
      } else {
        cashTotal += grand;
        cashCount++;
      }
    }

    // Item-wise sales
    if (Array.isArray(bill.items)) {
      bill.items.forEach(it => {
        const id = it.dishId || it.name;
        const q = it.qty || 1;
        const rev = (it.unitPrice || it.basePrice || 0) * q;
        if (!itemSales[id]) {
          itemSales[id] = {
            id,
            name: it.name,
            category: it.category || "General",
            qty: 0,
            revenue: 0
          };
        }
        itemSales[id].qty += q;
        itemSales[id].revenue += rev;
      });
    }
  });

  const billCount = activeBills.length;
  const avgBill = billCount > 0 ? (grossTotal / billCount) : 0;

  return {
    billCount,
    cancelledCount: cancelledBills.length,
    grossSales: Math.round(grossTotal * 100) / 100,
    subtotal: Math.round(subtotalSum * 100) / 100,
    discounts: Math.round(discountTotal * 100) / 100,
    taxableValue: Math.round(taxableTotal * 100) / 100,
    cgst: Math.round(cgstTotal * 100) / 100,
    sgst: Math.round(sgstTotal * 100) / 100,
    totalTax: Math.round((cgstTotal + sgstTotal) * 100) / 100,
    roundoff: Math.round(roundoffTotal * 100) / 100,
    averageBill: Math.round(avgBill * 100) / 100,
    payments: {
      cash: { total: Math.round(cashTotal * 100) / 100, count: cashCount },
      upi: { total: Math.round(upiTotal * 100) / 100, count: upiCount },
      card: { total: Math.round(cardTotal * 100) / 100, count: cardCount }
    },
    itemSales: Object.values(itemSales).sort((a, b) => b.revenue - a.revenue),
    activeBills,
    cancelledBills
  };
}

/**
 * Formats a clean WhatsApp-friendly daily sales report string.
 * @param {object} summary 
 * @param {object} store 
 * @returns {string}
 */
function formatWhatsAppDailySummary(summary, store = {}) {
  const storeName = (store.name || "THE RETRO CAFETERIA").toUpperCase();
  const dateStr = summary.date || getLocalDateString();
  const totalBills = summary.billCount || 0;
  const grossSales = (summary.grossSales || 0).toFixed(2);
  const cash = (summary.payments?.cash?.total || 0).toFixed(2);
  const upi = (summary.payments?.upi?.total || 0).toFixed(2);
  const card = (summary.payments?.card?.total || 0).toFixed(2);
  const taxable = (summary.taxableValue || 0).toFixed(2);
  const totalTax = (summary.totalTax || 0).toFixed(2);
  const cancelled = summary.cancelledCount || 0;

  const lines = [
    `*${storeName} — DAILY SALES SUMMARY*`,
    `📅 Date: ${dateStr}`,
    `🧾 Bills Settled: ${totalBills}`,
    ...(cancelled > 0 ? [`❌ Cancelled Bills: ${cancelled}`] : []),
    ``,
    `*REVENUE & TENDERS:*`,
    `💰 Net Sales Revenue: Rs ${grossSales}`,
    `💵 Cash: Rs ${cash}`,
    `📱 UPI: Rs ${upi}`,
    `💳 Card: Rs ${card}`,
    ``,
    `*STATUTORY GST (5%):*`,
    `🏛️ Taxable Value: Rs ${taxable}`,
    `⚖️ Total GST: Rs ${totalTax}`,
    ``,
    `*EXPECTED CASH IN DRAWER: Rs ${cash}*`,
    `--------------------------------`,
    `_Generated by Retro Cafeteria POS_`
  ];

  return lines.join("\n");
}

/**
 * Formats a clean WhatsApp-friendly daily sales report string.
 * @param {object} summary 
 * @param {object} store 
 * @returns {string}
 */
function formatWhatsAppDailySummary(summary, store = {}) {
  const storeName = (store.name || "THE RETRO CAFETERIA").toUpperCase();
  const dateStr = summary.date || getLocalDateString();
  const totalBills = summary.billCount || 0;
  const grossSales = (summary.grossSales || 0).toFixed(2);
  const cash = (summary.payments?.cash?.total || 0).toFixed(2);
  const upi = (summary.payments?.upi?.total || 0).toFixed(2);
  const card = (summary.payments?.card?.total || 0).toFixed(2);
  const taxable = (summary.taxableValue || 0).toFixed(2);
  const totalTax = (summary.totalTax || 0).toFixed(2);
  const cancelled = summary.cancelledCount || 0;

  const lines = [
    `*${storeName} — DAILY SALES SUMMARY*`,
    `📅 Date: ${dateStr}`,
    `🧾 Bills Settled: ${totalBills}`,
    ...(cancelled > 0 ? [`❌ Cancelled Bills: ${cancelled}`] : []),
    ``,
    `*REVENUE & TENDERS:*`,
    `💰 Net Sales Revenue: Rs ${grossSales}`,
    `💵 Cash: Rs ${cash}`,
    `📱 UPI: Rs ${upi}`,
    `💳 Card: Rs ${card}`,
    ``,
    `*STATUTORY GST (5%):*`,
    `🏛️ Taxable Value: Rs ${taxable}`,
    `⚖️ Total GST: Rs ${totalTax}`,
    ``,
    `*EXPECTED CASH IN DRAWER: Rs ${cash}*`,
    `--------------------------------`,
    `_Generated by Retro Cafeteria POS_`
  ];

  return lines.join("\n");
}

/**
 * Formats a WhatsApp alert message when a Complimentary (NC) order is placed.
 * @param {object} bill 
 * @param {object} store 
 * @returns {string}
 */
function formatNCAlertMessage(bill, store = {}) {
  const storeName = (store.name || "THE RETRO CAFETERIA").toUpperCase();
  const billNo = bill.billNo || "PENDING";
  const date = bill.date || getLocalDateString();
  const time = bill.time || "";
  const cashier = bill.cashier || "Cashier";
  const reason = bill.ncReason || "Complimentary / VIP";
  const subtotal = (parseFloat(bill.subtotal) || 0).toFixed(2);

  const itemsList = Array.isArray(bill.items)
    ? bill.items.map(it => `• ${it.qty || 1}x ${it.name} (Rs ${((it.unitPrice || it.basePrice || 0) * (it.qty || 1)).toFixed(2)})`).join("\n")
    : "• No items";

  const lines = [
    `*🚨 ${storeName} — COMPLIMENTARY (NC) BILL ALERT*`,
    `🧾 Bill No: ${billNo}`,
    `📅 Date: ${date} ${time}`.trim(),
    `👤 Cashier: ${cashier}`,
    `🏷️ Reason: *${reason}*`,
    ``,
    `*ITEMS WAIVED:*`,
    itemsList,
    ``,
    `💰 *Total Value Waived: Rs ${subtotal}*`,
    `🔒 Authorized via Owner PIN elevation.`,
    `--------------------------------`,
    `_Retro Cafeteria POS Audit Guard_`
  ];

  return lines.join("\n");
}

/**
 * Generates GSTR-1 Table 7 (B2CS) Statutory Export for Auditor & GST Portal.
 * @param {Array} salesLedger 
 * @param {object} [filterOptions] { startDate?: string, endDate?: string }
 * @param {object} [store]
 * @returns {object} { summaryRow, csv }
 */
function generateGSTR1B2CSExport(salesLedger, filterOptions = {}, store = {}) {
  const summary = aggregateSalesSummary(salesLedger, filterOptions);
  const posCode = (store.gstin && store.gstin.length >= 2) ? store.gstin.slice(0, 2) : "33";
  const posState = `${posCode}-Tamil Nadu`;

  let b2csTaxable = 0;
  let b2csCgst = 0;
  let b2csSgst = 0;

  summary.activeBills.forEach(b => {
    // Exclude B2B registered invoices with buyer GSTIN
    if (b.customerGstin && b.customerGstin.trim().length === 15) return;
    b2csTaxable += parseFloat(b.taxableAmount || 0) || 0;
    b2csCgst += parseFloat(b.cgst || 0) || 0;
    b2csSgst += parseFloat(b.sgst || 0) || 0;
  });

  b2csTaxable = Math.round(b2csTaxable * 100) / 100;
  b2csCgst = Math.round(b2csCgst * 100) / 100;
  b2csSgst = Math.round(b2csSgst * 100) / 100;
  const totalInvValue = Math.round((b2csTaxable + b2csCgst + b2csSgst) * 100) / 100;

  // Indian GST Portal B2CS CSV Headers
  const csvHeaders = "Summary For,Type,Place Of Supply,Rate,Applicable % of Tax Rate,Taxable Value,Cess Amount,Central Tax,State/UT Tax,Total Invoice Value";
  const csvRow = `B2CS,OE,${posState},5.00,,${b2csTaxable.toFixed(2)},0.00,${b2csCgst.toFixed(2)},${b2csSgst.toFixed(2)},${totalInvValue.toFixed(2)}`;
  const csv = `${csvHeaders}\n${csvRow}\n`;

  return {
    summaryRow: {
      summaryFor: "B2CS",
      type: "OE",
      placeOfSupply: posState,
      rate: 5.0,
      taxableValue: b2csTaxable,
      cess: 0.0,
      centralTax: b2csCgst,
      stateTax: b2csSgst,
      totalInvoiceValue: totalInvValue
    },
    csv
  };
}

/**
 * Generates complete line-by-line Auditor Sales Register CSV for Chartered Accountant verification.
 * @param {Array} salesLedger 
 * @param {object} [filterOptions]
 * @returns {string} CSV text
 */
function generateAuditorSalesRegisterCSV(salesLedger, filterOptions = {}) {
  const sales = Array.isArray(salesLedger) ? salesLedger : [];
  const start = filterOptions.startDate;
  const end = filterOptions.endDate;

  const headers = [
    "Bill No",
    "Date",
    "Time",
    "Order Type",
    "Status",
    "Customer Name",
    "Customer Phone",
    "Customer GSTIN",
    "Subtotal",
    "Discount",
    "Taxable Value (SAC 9963)",
    "CGST (2.5%)",
    "SGST (2.5%)",
    "Round Off",
    "Grand Total",
    "Payment Mode",
    "NC Reason",
    "Cancel Reason",
    "Cashier"
  ];

  function escapeCsv(val) {
    const s = String(val === undefined || val === null ? "" : val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const rows = [headers.join(",")];

  sales.forEach(bill => {
    if (!bill) return;
    const bDate = bill.date || (bill.timestamp ? bill.timestamp.split(" ")[0] : "");
    if (start && bDate < start) return;
    if (end && bDate > end) return;

    const status = bill.isCancelled ? "CANCELLED" : (bill.isNC ? "COMPLIMENTARY_NC" : "ACTIVE");

    const row = [
      escapeCsv(bill.billNo),
      escapeCsv(bill.date),
      escapeCsv(bill.time),
      escapeCsv(bill.orderType),
      escapeCsv(status),
      escapeCsv(bill.customerName),
      escapeCsv(bill.customerPhone),
      escapeCsv(bill.customerGstin),
      (parseFloat(bill.subtotal) || 0).toFixed(2),
      (parseFloat(bill.discountAmount || bill.discount) || 0).toFixed(2),
      (parseFloat(bill.taxableAmount) || 0).toFixed(2),
      (parseFloat(bill.cgst) || 0).toFixed(2),
      (parseFloat(bill.sgst) || 0).toFixed(2),
      (parseFloat(bill.roundoff) || 0).toFixed(2),
      (parseFloat(bill.grandTotal) || 0).toFixed(2),
      escapeCsv(bill.paymentMode || "Cash"),
      escapeCsv(bill.ncReason),
      escapeCsv(bill.cancelReason),
      escapeCsv(bill.cashier)
    ];

    rows.push(row.join(","));
  });

  return rows.join("\n") + "\n";
}

/**
 * Normalizes Indian 10-digit mobile phone numbers.
 * @param {string} rawPhone 
 * @returns {string} 10-digit phone or empty string
 */
function normalizePhoneNumber(rawPhone) {
  if (!rawPhone) return "";
  const cleaned = String(rawPhone).replace(/\D/g, "");
  if (cleaned.length === 10) return cleaned;
  if (cleaned.length === 12 && cleaned.startsWith("91")) return cleaned.slice(2);
  if (cleaned.length === 11 && cleaned.startsWith("0")) return cleaned.slice(1);
  return cleaned.length >= 10 ? cleaned.slice(-10) : "";
}

/**
 * Aggregates lightweight CRM customer profiles from sales ledger history.
 * @param {Array} salesLedger 
 * @returns {Array<object>} Customer profiles sorted by lifetime spend
 */
function aggregateCustomerCRM(salesLedger) {
  const sales = Array.isArray(salesLedger) ? salesLedger : [];
  const map = new Map();

  sales.forEach(bill => {
    if (!bill || bill.isCancelled) return;
    const phone = normalizePhoneNumber(bill.customerPhone);
    if (!phone) return;

    if (!map.has(phone)) {
      map.set(phone, {
        phone,
        name: bill.customerName || "Customer",
        totalVisits: 0,
        lifetimeSpend: 0,
        firstVisit: bill.date || "",
        lastVisit: `${bill.date || ''} ${bill.time || ''}`.trim(),
        itemCounts: {},
        lastBill: {
          billNo: bill.billNo,
          date: bill.date,
          grandTotal: parseFloat(bill.grandTotal) || 0,
          items: Array.isArray(bill.items) ? bill.items : []
        }
      });
    }

    const record = map.get(phone);
    record.totalVisits += 1;
    record.lifetimeSpend += (parseFloat(bill.grandTotal) || 0);
    if (bill.customerName && bill.customerName.trim()) {
      record.name = bill.customerName.trim();
    }
    const dt = `${bill.date || ''} ${bill.time || ''}`.trim();
    if (dt && dt > record.lastVisit) {
      record.lastVisit = dt;
      record.lastBill = {
        billNo: bill.billNo,
        date: bill.date,
        grandTotal: parseFloat(bill.grandTotal) || 0,
        items: Array.isArray(bill.items) ? bill.items : []
      };
    }

    if (Array.isArray(bill.items)) {
      bill.items.forEach(it => {
        const dish = it.name || "Item";
        record.itemCounts[dish] = (record.itemCounts[dish] || 0) + (it.qty || 1);
      });
    }
  });

  const profiles = Array.from(map.values()).map(p => {
    const favoriteDishes = Object.entries(p.itemCounts)
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);

    return {
      phone: p.phone,
      name: p.name,
      totalVisits: p.totalVisits,
      lifetimeSpend: Math.round(p.lifetimeSpend * 100) / 100,
      averageOrder: p.totalVisits > 0 ? Math.round((p.lifetimeSpend / p.totalVisits) * 100) / 100 : 0,
      firstVisit: p.firstVisit,
      lastVisit: p.lastVisit,
      favoriteDish: favoriteDishes[0] || "Various",
      topFavorites: favoriteDishes.slice(0, 3),
      lastBill: p.lastBill
    };
  });

  // Sort descending by lifetime spend
  return profiles.sort((a, b) => b.lifetimeSpend - a.lifetimeSpend);
}

/**
 * Quick lookup helper for CRM customer by phone.
 * @param {Array} salesLedger 
 * @param {string} phone 
 * @returns {object|null}
 */
function getCustomerByPhone(salesLedger, phone) {
  const norm = normalizePhoneNumber(phone);
  if (!norm) return null;
  const profiles = aggregateCustomerCRM(salesLedger);
  return profiles.find(p => p.phone === norm) || null;
}

// Module export for Node.js test runner and browser window
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STORAGE_KEYS,
    getFinancialYear,
    formatBillNumber,
    getLocalDateString,
    safeJsonParse,
    aggregateSalesSummary,
    formatWhatsAppDailySummary,
    formatNCAlertMessage,
    generateGSTR1B2CSExport,
    generateAuditorSalesRegisterCSV,
    normalizePhoneNumber,
    aggregateCustomerCRM,
    getCustomerByPhone
  };
}
if (typeof window !== "undefined") {
  window.PosStorage = {
    STORAGE_KEYS,
    getFinancialYear,
    formatBillNumber,
    getLocalDateString,
    safeJsonParse,
    aggregateSalesSummary,
    formatWhatsAppDailySummary,
    formatNCAlertMessage,
    generateGSTR1B2CSExport,
    generateAuditorSalesRegisterCSV,
    normalizePhoneNumber,
    aggregateCustomerCRM,
    getCustomerByPhone
  };
}
