// SMART PHOTOCOPY pricing engine — PURE functions, all money math in integer paise.
// Prices are ALWAYS computed server-side; the client price is display-only.

import type { ColorMode, PaperSize } from "./types";

export interface PricingRuleInput {
  paperSize: string;
  colorMode: string;
  pricePerSidePaise: number;
  duplexPricePerSidePaise?: number | null;
}

export interface ItemConfig {
  pageCount: number; // total pages in document
  pageSelection?: string | null; // "1-3,5,8-10" (null/"" = all)
  copies: number;
  paperSize: string;
  colorMode: ColorMode;
  duplex: boolean;
}

export interface ItemCalculation {
  selectedPages: number;
  sides: number;
  sheets: number;
  ratePaisePerSide: number;
  printCostPaise: number;
  lineTotalPaise: number;
  breakdown: string;
  error?: string;
}

/**
 * Parse a page-range string like "1-3,5,8-10" into a sorted unique list of
 * 1-based page numbers, validated against pageCount.
 * Accepts null/""/ "all" for every page.
 */
export function parsePageRanges(sel: string | null | undefined, pageCount: number): number[] {
  if (pageCount <= 0) return [];
  const trimmed = (sel ?? "").trim();
  if (!trimmed || trimmed.toLowerCase() === "all" || trimmed === "-") {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  if (trimmed.length > 200) throw new Error("Page selection is too long");
  const pages = new Set<number>();
  for (const part of trimmed.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const range = /^(\d+)-(\d+)$/.exec(p);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < 1 || to < from) throw new Error(`Invalid page range "${p}"`);
      if (to > pageCount) throw new Error(`Page range "${p}" exceeds document (${pageCount} pages)`);
      if (to - from > 9999) throw new Error(`Page range "${p}" is too large`);
      for (let i = from; i <= to; i++) pages.add(i);
    } else if (/^\d+$/.test(p)) {
      const n = Number(p);
      if (n < 1) throw new Error(`Invalid page number "${p}"`);
      if (n > pageCount) throw new Error(`Page ${n} exceeds document (${pageCount} pages)`);
      pages.add(n);
    } else {
      throw new Error(`Invalid page selection "${p}"`);
    }
  }
  if (pages.size === 0) throw new Error("No valid pages selected");
  return [...pages].sort((a, b) => a - b);
}

/** Physical sheet math: duplex groups 2 printed sides onto 1 sheet PER COPY. */
export function calcSheets(selectedPages: number, copies: number, duplex: boolean): { sides: number; sheets: number } {
  const sides = selectedPages * copies;
  // Each copy of an N-page document: simplex = N sheets, duplex = ceil(N/2) sheets.
  const sheets = duplex ? Math.ceil(selectedPages / 2) * copies : selectedPages * copies;
  return { sides, sheets };
}

/**
 * Calculate one order item line. Throws on invalid config so bad input never
 * reaches the database.
 */
export function calcItem(item: ItemConfig, rules: PricingRuleInput[]): ItemCalculation {
  const rule = rules.find((r) => r.paperSize === item.paperSize && r.colorMode === item.colorMode && r.pricePerSidePaise >= 0);
  if (!rule) {
    throw new Error(`No pricing configured for ${item.paperSize} ${item.colorMode === "BW" ? "B/W" : "Colour"}. Please contact the shop.`);
  }
  if (!Number.isInteger(item.copies) || item.copies < 1 || item.copies > 500) {
    throw new Error("Copies must be between 1 and 500");
  }
  if (item.duplex && rule.duplexPricePerSidePaise == null) {
    // Duplex allowed at the same per-side rate if shop did not set a duplex rate.
  }
  const pages = parsePageRanges(item.pageSelection, item.pageCount);
  const selectedPages = pages.length;
  const { sides, sheets } = calcSheets(selectedPages, item.copies, item.duplex);

  const rate = item.duplex
    ? (rule.duplexPricePerSidePaise ?? rule.pricePerSidePaise)
    : rule.pricePerSidePaise;

  if (!Number.isInteger(rate) || rate < 0) throw new Error("Invalid configured rate");

  const printCostPaise = sides * rate;
  return {
    selectedPages,
    sides,
    sheets,
    ratePaisePerSide: rate,
    printCostPaise,
    lineTotalPaise: printCostPaise,
    breakdown:
      `${selectedPages} page(s) × ${item.copies} copy(ies) = ${sides} sides · ` +
      `${sheets} sheet(s)${item.duplex ? " (duplex)" : ""} @ ₹${(rate / 100).toFixed(2)}/side`,
  };
}

export interface OrderTotals {
  subtotalPaise: number;
  additionalPaise: number;
  taxPaise: number;
  totalPaise: number;
}

/** Order-level totals: subtotal + flat additional charge + tax on (subtotal+additional). */
export function calcOrderTotals(
  lineTotalsPaise: number[],
  additionalChargePaise: number,
  taxPercent: number
): OrderTotals {
  const subtotalPaise = lineTotalsPaise.reduce((a, b) => a + b, 0);
  const additionalPaise = Math.max(0, Math.round(additionalChargePaise || 0));
  const taxable = subtotalPaise + additionalPaise;
  const taxPaise = taxPercent > 0 ? Math.round((taxable * taxPercent) / 100) : 0;
  return {
    subtotalPaise,
    additionalPaise,
    taxPaise,
    totalPaise: taxable + taxPaise,
  };
}

/** Human label for a paper size code (incl. CUSTOM:{name}). */
export function paperSizeLabel(p: string): string {
  if (p.startsWith("CUSTOM:")) return p.slice(7);
  const map: Record<string, string> = {
    A4: "A4",
    A3: "A3",
    LEGAL: "Legal",
    PHOTO_4X6: "Photo 4×6",
  };
  return map[p] ?? p;
}
