/**
 * src/core/qr.js
 * The Retro Cafeteria POS — Pure Offline QR Code & Dynamic UPI Payment Engine
 * Generates ISO/IEC 18004 compliant QR Code SVGs and standard NPCI UPI payment strings
 * Zero external network calls, zero npm dependencies, 100% offline-first
 */

/**
 * Generates a standard NPCI UPI Payment URI Scheme string.
 * @param {object} params
 * @param {string} params.upiId Merchant UPI VPA (e.g. 'retrocafe@oksbi')
 * @param {string} params.storeName Business / Payee display name
 * @param {number} params.amount Exact payable amount (e.g. 105.00)
 * @param {string} [params.billNumber] Consecutive bill number for transaction note
 * @returns {string} Standard UPI URI string
 */
function generateUPIPaymentString(params = {}) {
  const p = params || {};
  const vpa = String(p.upiId || "").trim();
  if (!vpa) return "";
  const name = String(p.storeName || "RETRO CAFETERIA").trim();
  const amt = (parseFloat(p.amount) || 0).toFixed(2);
  const note = p.billNumber ? `Bill ${p.billNumber}` : "POS Bill";

  // Standard NPCI URI: upi://pay?pa=...&pn=...&am=...&cu=INR&tn=...
  const query = [
    `pa=${encodeURIComponent(vpa)}`,
    `pn=${encodeURIComponent(name)}`,
    `am=${encodeURIComponent(amt)}`,
    `cu=INR`,
    `tn=${encodeURIComponent(note)}`
  ].join("&");

  return `upi://pay?${query}`;
}

// Minimalist, robust ISO/IEC 18004 QR Code Matrix Generator
// Implements QR Model 2 with Byte mode encoding and Reed-Solomon Error Correction

const QR_MODES = { BYTE: 4 };
const QR_EC_LEVELS = { L: 1, M: 0, Q: 3, H: 2 };

// Galois Field GF(256) Math
const GF256_EXP = new Uint8Array(512);
const GF256_LOG = new Uint8Array(256);
(function initGF256() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    GF256_EXP[i] = val;
    GF256_LOG[val] = i;
    val = (val << 1) ^ (val & 128 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) {
    GF256_EXP[i] = GF256_EXP[i - 255];
  }
})();

function gfMultiply(x, y) {
  if (x === 0 || y === 0) return 0;
  return GF256_EXP[GF256_LOG[x] + GF256_LOG[y]];
}

function rsComputePoly(ecCount) {
  let poly = [1];
  for (let i = 0; i < ecCount; i++) {
    const factor = [1, GF256_EXP[i]];
    const newPoly = new Array(poly.length + factor.length - 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      for (let k = 0; k < factor.length; k++) {
        newPoly[j + k] ^= gfMultiply(poly[j], factor[k]);
      }
    }
    poly = newPoly;
  }
  return poly;
}

function rsEncode(dataBytes, ecCount) {
  const genPoly = rsComputePoly(ecCount);
  const msg = new Array(dataBytes.length + ecCount).fill(0);
  for (let i = 0; i < dataBytes.length; i++) msg[i] = dataBytes[i];

  for (let i = 0; i < dataBytes.length; i++) {
    const lead = msg[i];
    if (lead !== 0) {
      for (let j = 0; j < genPoly.length; j++) {
        msg[i + j] ^= gfMultiply(genPoly[j], lead);
      }
    }
  }
  return msg.slice(dataBytes.length);
}

// QR Version capacities for Byte Mode & EC Level 'M' (Standard)
const QR_VERSION_SPECS_M = [
  null,
  { version: 1, totalCodewords: 26, ecCodewords: 10, dataCodewords: 16, size: 21 },
  { version: 2, totalCodewords: 44, ecCodewords: 16, dataCodewords: 28, size: 25 },
  { version: 3, totalCodewords: 70, ecCodewords: 26, dataCodewords: 44, size: 29 },
  { version: 4, totalCodewords: 100, ecCodewords: 36, dataCodewords: 64, size: 33 },
  { version: 5, totalCodewords: 134, ecCodewords: 48, dataCodewords: 86, size: 37 },
  { version: 6, totalCodewords: 172, ecCodewords: 64, dataCodewords: 108, size: 41 },
  { version: 7, totalCodewords: 196, ecCodewords: 72, dataCodewords: 124, size: 45 }
];

/**
 * Determines appropriate QR version for byte mode data with EC Level M.
 * @param {number} byteLength 
 * @returns {object} Spec
 */
function pickQrVersion(byteLength) {
  for (let v = 1; v < QR_VERSION_SPECS_M.length; v++) {
    const spec = QR_VERSION_SPECS_M[v];
    // Byte mode overhead: 4-bit mode indicator + 8-bit char count indicator = 12 bits -> ~2 bytes overhead
    if (byteLength + 2 <= spec.dataCodewords) {
      return spec;
    }
  }
  return QR_VERSION_SPECS_M[7]; // Fallback to version 7
}

/**
 * Generates bitstream buffer for byte mode data.
 */
function createDataBits(dataStr, maxDataBytes) {
  const utf8Bytes = [];
  for (let i = 0; i < dataStr.length; i++) {
    const code = dataStr.charCodeAt(i);
    if (code < 128) {
      utf8Bytes.push(code);
    } else if (code < 2048) {
      utf8Bytes.push(192 | (code >> 6), 128 | (code & 63));
    } else {
      utf8Bytes.push(224 | (code >> 12), 128 | ((code >> 6) & 63), 128 | (code & 63));
    }
  }

  const bits = [];
  function pushBits(val, len) {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  }

  // 1. Mode indicator: 0100 for Byte Mode
  pushBits(0b0100, 4);
  // 2. Character count indicator: 8 bits for versions 1-9
  pushBits(utf8Bytes.length, 8);
  // 3. Data bytes
  for (let b of utf8Bytes) {
    pushBits(b, 8);
  }
  // 4. Terminator (up to 4 zeroes)
  const maxBits = maxDataBytes * 8;
  const termBits = Math.min(4, maxBits - bits.length);
  pushBits(0, termBits);
  // 5. Pad to multiple of 8
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }
  // 6. Pad bytes 0xEC, 0x11
  const padBytes = [0xEC, 0x11];
  let padIdx = 0;
  while (bits.length < maxBits) {
    pushBits(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  // Convert bits to byte array
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i + j];
    }
    bytes.push(b);
  }
  return bytes;
}

/**
 * Creates 2D QR Code Boolean Matrix (true = black, false = white).
 * @param {string} text 
 * @returns {Array<Array<boolean>>}
 */
function createQrMatrix(text) {
  const safeText = String(text || "");
  const spec = pickQrVersion(safeText.length);
  const dataBytes = createDataBits(safeText, spec.dataCodewords);
  const ecBytes = rsEncode(dataBytes, spec.ecCodewords);
  const allCodewords = dataBytes.concat(ecBytes);

  const N = spec.size;
  const matrix = Array.from({ length: N }, () => new Array(N).fill(null));

  // Helper to put finder pattern at (r, c)
  function placeFinder(r, c) {
    for (let i = -1; i <= 7; i++) {
      for (let j = -1; j <= 7; j++) {
        const row = r + i;
        const col = c + j;
        if (row >= 0 && row < N && col >= 0 && col < N) {
          if (
            (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
            (j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
            (i >= 2 && i <= 4 && j >= 2 && j <= 4)
          ) {
            matrix[row][col] = true;
          } else {
            matrix[row][col] = false;
          }
        }
      }
    }
  }

  // 1. Finder patterns at Top-Left, Top-Right, Bottom-Left
  placeFinder(0, 0);
  placeFinder(0, N - 7);
  placeFinder(N - 7, 0);

  // 2. Alignment patterns (for Version >= 2)
  if (spec.version >= 2) {
    const alignCoords = [
      [],
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38]
    ][spec.version];

    if (alignCoords) {
      for (let r of alignCoords) {
        for (let c of alignCoords) {
          // Skip if overlapping finder patterns
          if ((r <= 8 && c <= 8) || (r <= 8 && c >= N - 8) || (r >= N - 8 && c <= 8)) continue;
          for (let i = -2; i <= 2; i++) {
            for (let j = -2; j <= 2; j++) {
              matrix[r + i][c + j] = (Math.max(Math.abs(i), Math.abs(j)) !== 1);
            }
          }
        }
      }
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < N - 8; i++) {
    if (matrix[6][i] === null) matrix[6][i] = (i % 2 === 0);
    if (matrix[i][6] === null) matrix[i][6] = (i % 2 === 0);
  }

  // 4. Dark module
  matrix[4 * spec.version + 9][8] = true;

  // 5. Reserve format information areas
  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === null) matrix[8][i] = false;
    if (matrix[i][8] === null) matrix[i][8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (matrix[8][N - 1 - i] === null) matrix[8][N - 1 - i] = false;
    if (matrix[N - 1 - i][8] === null) matrix[N - 1 - i][8] = false;
  }

  // 6. Data Placement (Zigzag scanning)
  const allBits = [];
  for (let b of allCodewords) {
    for (let i = 7; i >= 0; i--) {
      allBits.push((b >> i) & 1);
    }
  }

  let bitIdx = 0;
  let upward = true;
  for (let right = N - 1; right > 0; right -= 2) {
    if (right === 6) right--; // skip timing col
    const rows = upward
      ? Array.from({ length: N }, (_, i) => N - 1 - i)
      : Array.from({ length: N }, (_, i) => i);

    for (let r of rows) {
      for (let c of [right, right - 1]) {
        if (matrix[r][c] === null) {
          const bitVal = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
          // Apply standard Mask 0: (row + col) % 2 === 0
          const maskInvert = ((r + c) % 2 === 0);
          matrix[r][c] = (bitVal === 1) ? !maskInvert : maskInvert;
        }
      }
    }
    upward = !upward;
  }

  // 7. Write Format Info (EC M = 00, Mask 0 = 000 -> 00000 with BCH 101010000010010 XOR 101010000010010)
  // Format bits for EC M (00) & Mask 0 (000) = 101010000010010
  const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
  // Top-left
  matrix[8][0] = Boolean(formatBits[0]);
  matrix[8][1] = Boolean(formatBits[1]);
  matrix[8][2] = Boolean(formatBits[2]);
  matrix[8][3] = Boolean(formatBits[3]);
  matrix[8][4] = Boolean(formatBits[4]);
  matrix[8][5] = Boolean(formatBits[5]);
  matrix[8][7] = Boolean(formatBits[6]);
  matrix[8][8] = Boolean(formatBits[7]);
  matrix[7][8] = Boolean(formatBits[8]);
  matrix[5][8] = Boolean(formatBits[9]);
  matrix[4][8] = Boolean(formatBits[10]);
  matrix[3][8] = Boolean(formatBits[11]);
  matrix[2][8] = Boolean(formatBits[12]);
  matrix[1][8] = Boolean(formatBits[13]);
  matrix[0][8] = Boolean(formatBits[14]);

  // Top-right and Bottom-left format bits
  for (let i = 0; i < 7; i++) {
    matrix[N - 1 - i][8] = Boolean(formatBits[i]);
  }
  for (let i = 7; i < 15; i++) {
    matrix[8][N - 15 + i] = Boolean(formatBits[i]);
  }

  // Convert any remaining nulls to false
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (matrix[r][c] === null) matrix[r][c] = false;
    }
  }

  return matrix;
}

/**
 * Generates an SVG string representation of a QR Code.
 * @param {string} text Data to encode
 * @param {object} [options]
 * @param {number} [options.size=200] Display width/height in px
 * @param {number} [options.margin=2] Quiet zone modules
 * @param {string} [options.color='#171717'] Foreground color
 * @param {string} [options.bgColor='#ffffff'] Background color
 * @returns {string} XML SVG string
 */
function createQrSvg(text, options = {}) {
  const matrix = createQrMatrix(text);
  const N = matrix.length;
  const margin = options.margin !== undefined ? options.margin : 2;
  const totalModules = N + margin * 2;
  const size = options.size || 200;
  const color = options.color || "#171717";
  const bgColor = options.bgColor || "#ffffff";

  let rects = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (matrix[r][c]) {
        rects.push(`<rect x="${c + margin}" y="${r + margin}" width="1" height="1" fill="${color}"/>`);
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalModules} ${totalModules}" width="${size}" height="${size}" shape-rendering="crispEdges">`,
    `<rect width="${totalModules}" height="${totalModules}" fill="${bgColor}"/>`,
    rects.join(""),
    `</svg>`
  ].join("");
}

// Module export for Node.js test runner and browser window
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    generateUPIPaymentString,
    createQrMatrix,
    createQrSvg
  };
}
if (typeof window !== "undefined") {
  window.PosQR = {
    generateUPIPaymentString,
    createQrMatrix,
    createQrSvg
  };
}
