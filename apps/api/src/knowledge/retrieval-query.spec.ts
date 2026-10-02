import { CommercialContextMessage } from "../llm/commercial-interpreter";
import { buildRetrievalQuery, MAX_RETRIEVAL_QUERY_CHARS } from "./retrieval-query";

function msg(direction: "INBOUND" | "OUTBOUND", text: string): CommercialContextMessage {
  return { direction, text, sentAt: new Date("2026-01-01T00:00:00Z") };
}

describe("buildRetrievalQuery", () => {
  it("uses the latest customer message, not business messages", () => {
    const query = buildRetrievalQuery([
      msg("INBOUND", "Hola"),
      msg("OUTBOUND", "¡Hola! ¿En qué te ayudo?"),
      msg("INBOUND", "¿Cuánto cuesta y cuáles son sus políticas de cancelación?"),
    ]);
    expect(query).toBe("¿Cuánto cuesta y cuáles son sus políticas de cancelación?");
  });

  it("adds the previous customer message when the latest is too short to stand alone", () => {
    const query = buildRetrievalQuery([msg("INBOUND", "¿Cuánto cuesta la depilación láser de piernas?"), msg("OUTBOUND", "..."), msg("INBOUND", "¿y el sábado?")]);
    expect(query).toBe("¿Cuánto cuesta la depilación láser de piernas? ¿y el sábado?");
  });

  it("appends M2B entities that are not already in the text", () => {
    expect(buildRetrievalQuery([msg("INBOUND", "¿Cuánto cuesta?")], { serviceName: "depilación láser" })).toBe("¿Cuánto cuesta? depilación láser");
    expect(buildRetrievalQuery([msg("INBOUND", "¿Cuánto cuesta el Business Plan?")], { productName: "business plan" })).toBe(
      "¿Cuánto cuesta el Business Plan?",
    );
  });

  it("returns null when there is no customer text", () => {
    expect(buildRetrievalQuery([msg("OUTBOUND", "Hola")])).toBeNull();
    expect(buildRetrievalQuery([msg("INBOUND", "   ")])).toBeNull();
  });

  it("is bounded", () => {
    const query = buildRetrievalQuery([msg("INBOUND", "palabra ".repeat(500))]);
    expect(query!.length).toBeLessThanOrEqual(MAX_RETRIEVAL_QUERY_CHARS);
  });
});
