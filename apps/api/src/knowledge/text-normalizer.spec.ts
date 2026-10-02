import { normalizeText } from "./text-normalizer";

describe("normalizeText", () => {
  it("normalizes line endings, collapses inline whitespace and trims lines", () => {
    expect(normalizeText("  Precio:\t\tS/320  \r\nHorario:   sábados \r\n")).toBe("Precio: S/320\nHorario: sábados");
  });

  it("collapses 3+ newlines to a single blank line", () => {
    expect(normalizeText("A\n\n\n\n\nB")).toBe("A\n\nB");
  });

  it("strips control characters but keeps text", () => {
    expect(normalizeText("Plan\u0000 Business\u0007")).toBe("Plan Business");
  });

  it("applies Unicode NFC so composed and decomposed accents hash identically", () => {
    expect(normalizeText("sábado")).toBe(normalizeText("sábado"));
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeText(" \n\t \r\n ")).toBe("");
  });

  it("is idempotent", () => {
    const once = normalizeText("  # FAQ \r\n\r\n\r\n¿Cuánto   cuesta?  ");
    expect(normalizeText(once)).toBe(once);
  });
});
