import { formatElapsed, isUnanswered, replyStatusText, splitName, summaryText, whatsappUrl } from "./presentation";

const NOW = new Date("2026-01-01T12:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describe("dashboard presentation", () => {
  it("splits WhatsApp profile names and falls back to the phone", () => {
    expect(splitName("Juan Pérez García", "51999111222")).toEqual({ firstName: "Juan", lastName: "Pérez García" });
    expect(splitName("Andrea", "51999111222")).toEqual({ firstName: "Andrea", lastName: "" });
    expect(splitName(null, "51999111222")).toEqual({ firstName: "Cliente", lastName: "+51999111222" });
  });

  it("builds wa.me links from digits only", () => {
    expect(whatsappUrl("+51 999-111-222")).toBe("https://wa.me/51999111222");
  });

  it("formats elapsed time in Spanish", () => {
    expect(formatElapsed(10_000)).toBe("1 min");
    expect(formatElapsed(45 * 60_000)).toBe("45 min");
    expect(formatElapsed(3 * 3_600_000 + 59 * 60_000)).toBe("3 h");
    expect(formatElapsed(24 * 3_600_000)).toBe("1 día");
    expect(formatElapsed(72 * 3_600_000)).toBe("3 días");
  });

  it("describes who owes a reply", () => {
    expect(isUnanswered({ lastInboundAt: ago(120) })).toBe(true);
    expect(isUnanswered({ lastInboundAt: ago(120), lastOutboundAt: ago(60) })).toBe(false);
    expect(replyStatusText({ lastInboundAt: ago(120) }, NOW)).toBe("Sin respuesta del negocio desde hace 2 h");
    expect(replyStatusText({ lastInboundAt: ago(120), lastOutboundAt: ago(60) }, NOW)).toBe("Esperando respuesta del cliente");
    expect(replyStatusText({}, NOW)).toBe("Sin actividad reciente");
  });

  it("summarizes signals and reply status without inventing anything", () => {
    expect(
      summaryText({
        firstName: "Juan",
        signals: ["PRICING_REQUESTED", "AVAILABILITY_REQUESTED", "BOOKING_INTENT", "BOOKING_INTENT"],
        state: "AT_RISK",
        times: { lastInboundAt: ago(300) },
        now: NOW,
      }),
    ).toBe("Juan preguntó precios, consultó disponibilidad y quiere reservar. Sin respuesta del negocio desde hace 5 h. La oportunidad está en riesgo.");
    expect(summaryText({ firstName: "Ana", signals: [], state: "NEW", times: {}, now: NOW })).toBe("Ana inició una conversación. Sin actividad reciente.");
  });
});
