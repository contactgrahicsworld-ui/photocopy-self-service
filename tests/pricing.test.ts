// Pure-function tests: pricing engine, page ranges, duplex sheet math, UPI URIs.
import { describe, test, expect } from "bun:test";
import { parsePageRanges, calcSheets, calcItem, calcOrderTotals } from "../src/lib/pricing";
import { buildUpiUri, isValidUpiId } from "../src/lib/upi";

const RULES = [
  { paperSize: "A4", colorMode: "BW", pricePerSidePaise: 200, duplexPricePerSidePaise: 150 },
  { paperSize: "A4", colorMode: "COLOR", pricePerSidePaise: 1000, duplexPricePerSidePaise: null },
];

describe("page range parsing", () => {
  test("blank = all pages", () => {
    expect(parsePageRanges(null, 10)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    expect(parsePageRanges("", 3)).toEqual([1,2,3]);
    expect(parsePageRanges("all", 2)).toEqual([1,2]);
  });
  test("single pages, ranges, mixed, deduped & sorted", () => {
    expect(parsePageRanges("5", 10)).toEqual([5]);
    expect(parsePageRanges("1-3", 10)).toEqual([1,2,3]);
    expect(parsePageRanges("5,1-3,5", 10)).toEqual([1,2,3,5]);
    expect(parsePageRanges("8-10,1", 10)).toEqual([1,8,9,10]);
  });
  test("rejects out-of-bounds and garbage", () => {
    expect(() => parsePageRanges("11", 10)).toThrow(/exceeds/);
    expect(() => parsePageRanges("3-1", 10)).toThrow(/Invalid page range/);
    expect(() => parsePageRanges("abc", 10)).toThrow(/Invalid page selection/);
  });
});

describe("duplex sheet math (physical sheets vs printed sides)", () => {
  test("simplex: sheets == sides", () => {
    expect(calcSheets(10, 1, false)).toEqual({ sides: 10, sheets: 10 });
  });
  test("duplex: ceil(pages/2) sheets per copy", () => {
    expect(calcSheets(10, 1, true)).toEqual({ sides: 10, sheets: 5 });
    expect(calcSheets(9, 1, true)).toEqual({ sides: 9, sheets: 5 }); // odd pages
    expect(calcSheets(9, 3, true)).toEqual({ sides: 27, sheets: 15 }); // 5 sheets per copy × 3
    expect(calcSheets(9, 3, false)).toEqual({ sides: 27, sheets: 27 });
  });
});

describe("server-side item calculation", () => {
  test("simplex BW A4: 10 pages × 2 copies @ ₹2", () => {
    const c = calcItem({ pageCount: 10, pageSelection: null, copies: 2, paperSize: "A4", colorMode: "BW", duplex: false }, RULES);
    expect(c.selectedPages).toBe(10);
    expect(c.sides).toBe(20);
    expect(c.sheets).toBe(20);
    expect(c.lineTotalPaise).toBe(4000); // ₹40
  });
  test("duplex uses cheaper duplex rate", () => {
    const c = calcItem({ pageCount: 10, pageSelection: "1-10", copies: 1, paperSize: "A4", colorMode: "BW", duplex: true }, RULES);
    expect(c.sheets).toBe(5);
    expect(c.lineTotalPaise).toBe(1500); // 10 sides × ₹1.50
  });
  test("duplex with no duplex rate falls back to normal rate", () => {
    const c = calcItem({ pageCount: 4, pageSelection: null, copies: 1, paperSize: "A4", colorMode: "COLOR", duplex: true }, RULES);
    expect(c.lineTotalPaise).toBe(4000);
    expect(c.sheets).toBe(2);
  });
  test("page selection is priced, not the whole document", () => {
    const c = calcItem({ pageCount: 100, pageSelection: "1-3,7", copies: 1, paperSize: "A4", colorMode: "BW", duplex: false }, RULES);
    expect(c.selectedPages).toBe(4);
    expect(c.lineTotalPaise).toBe(800);
  });
  test("rejects unpriced combos", () => {
    expect(() => calcItem({ pageCount: 5, copies: 1, paperSize: "A3", colorMode: "BW", duplex: false }, RULES)).toThrow(/No pricing configured/);
  });
});

describe("order totals with charges & tax", () => {
  test("flat charge + GST rounding", () => {
    const t = calcOrderTotals([1000, 2000], 500, 18);
    expect(t.subtotalPaise).toBe(3000);
    expect(t.additionalPaise).toBe(500);
    expect(t.taxPaise).toBe(630); // 18% of 3500 = 630
    expect(t.totalPaise).toBe(4130);
  });
  test("no tax", () => {
    const t = calcOrderTotals([250], 0, 0);
    expect(t.totalPaise).toBe(250);
  });
});

describe("UPI URI building & validation", () => {
  test("valid standard UPI URI with encoding", () => {
    const uri = buildUpiUri({ payeeUpiId: "shop@okicici", payeeName: "Sri Balaji Xerox", amountPaise: 4550, reference: "PMT-AB12CD34EF", note: "Balaji ORD-000001" });
    expect(uri).toContain("upi://pay?");
    expect(uri).toContain("pa=shop%40okicici");
    expect(uri).toContain("pn=Sri%20Balaji%20Xerox");
    expect(uri).toContain("am=45.50");
    expect(uri).toContain("cu=INR");
    expect(uri).toContain("tr=PMT-AB12CD34EF");
  });
  test("amount always has 2 decimals", () => {
    const uri = buildUpiUri({ payeeUpiId: "shop@ybl", payeeName: "X", amountPaise: 10000, reference: "R1" });
    expect(uri).toContain("am=100.00");
  });
  test("rejects invalid VPA / zero amount", () => {
    expect(() => buildUpiUri({ payeeUpiId: "not-an-upi", payeeName: "X", amountPaise: 100, reference: "R" })).toThrow(/Invalid UPI ID/);
    expect(() => buildUpiUri({ payeeUpiId: "ab@b.co", payeeName: "X", amountPaise: 0, reference: "R" })).toThrow(/positive/);
    expect(() => buildUpiUri({ payeeUpiId: "ab@b.co", payeeName: "X", amountPaise: 100, reference: "R" })).not.toThrow();
  });
  test("VPA validator accepts common formats, rejects junk", () => {
    expect(isValidUpiId("name@okhdfcbank")).toBe(true);
    expect(isValidUpiId("user123@ybl")).toBe(true);
    expect(isValidUpiId("shop.name-1@paytm")).toBe(true);
    expect(isValidUpiId("noatsign")).toBe(false);
    expect(isValidUpiId("@nodomain")).toBe(false);
    expect(isValidUpiId("a@")).toBe(false);
  });
});
