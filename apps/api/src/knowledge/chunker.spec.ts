import { chunkText, DEFAULT_CHUNKING } from "./chunker";

function paragraphs(count: number, length: number): string {
  return Array.from({ length: count }, (_, i) => `Paragraph ${i}. ${"word ".repeat(length / 5)}`.trim()).join("\n\n");
}

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    expect(chunkText("La depilación láser de piernas cuesta S/320 por sesión.")).toEqual([
      "La depilación láser de piernas cuesta S/320 por sesión.",
    ]);
  });

  it("returns no chunks for empty text", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("is deterministic", () => {
    const text = paragraphs(20, 300);
    expect(chunkText(text)).toEqual(chunkText(text));
  });

  it("never exceeds maxChars, overlap included", () => {
    const text = paragraphs(30, 400) + "\n\n" + "averyveryverylongtokenwithoutspaces".repeat(80);
    for (const options of [DEFAULT_CHUNKING, { maxChars: 300, overlapChars: 50 }, { maxChars: 500, overlapChars: 0 }]) {
      const chunks = chunkText(text, options);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(options.maxChars);
        expect(chunk.trim()).not.toBe("");
      }
    }
  });

  it("packs short paragraphs together instead of one chunk per paragraph", () => {
    const text = "Precio: S/320.\n\nHorario: sábados de 9 a 17.\n\nLas citas requieren confirmación.";
    expect(chunkText(text)).toEqual([text]);
  });

  it("starts each chunk after the first with the tail of the previous chunk", () => {
    const options = { maxChars: 200, overlapChars: 40 };
    const chunks = chunkText(paragraphs(6, 120), options);
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i++) {
      const overlap = chunks[i]!.split("\n")[0]!;
      expect(overlap.length).toBeLessThanOrEqual(options.overlapChars);
      expect(chunks[i - 1]!.endsWith(overlap)).toBe(true);
    }
  });

  it("splits an oversized paragraph at sentence boundaries", () => {
    const sentences = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} explains one policy detail clearly.`);
    const chunks = chunkText(sentences.join(" "), { maxChars: 200, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk).toMatch(/\.$/);
    }
  });

  it("starts a new block at a Markdown heading", () => {
    const text = `# Prices\nBusiness Plan: $99/month. ${"x ".repeat(80)}\n# Support\nEmail support included.`;
    const chunks = chunkText(text, { maxChars: 180, overlapChars: 0 });
    expect(chunks.some((chunk) => chunk.startsWith("# Support"))).toBe(true);
  });

  it("rejects invalid options", () => {
    expect(() => chunkText("x", { maxChars: 10, overlapChars: 0 })).toThrow(RangeError);
    expect(() => chunkText("x", { maxChars: 200, overlapChars: 150 })).toThrow(RangeError);
  });
});
