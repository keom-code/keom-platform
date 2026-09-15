/**
 * One-off generator for the PWA icon set (Phase 9). No design asset exists yet — this
 * produces a simple "K" monogram on the app's dark surface color so the manifest has
 * real files to point at. Swap for real brand icons whenever design delivers them; run
 * with `node scripts/generate-pwa-icons.cjs` from apps/web.
 */
const { ImageResponse } = require("next/og");
const fs = require("fs");
const path = require("path");

const BG = "#0a0a0a";
const FG = "#ffffff";

function monogram({ size, scale, radius = 0 }) {
  return {
    type: "div",
    props: {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BG,
        borderRadius: radius,
      },
      children: {
        type: "div",
        props: {
          style: {
            color: FG,
            fontSize: Math.round(size * scale),
            fontWeight: 700,
            fontFamily: "sans-serif",
            display: "flex",
          },
          children: "K",
        },
      },
    },
  };
}

async function writePng(el, size, outPath) {
  const res = new ImageResponse(el, { width: size, height: size });
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  console.log(`wrote ${outPath} (${buf.length} bytes)`);
}

async function main() {
  const root = path.join(__dirname, "..");

  // "any" purpose icons — safe to bleed to the edge.
  await writePng(monogram({ size: 192, scale: 0.5 }), 192, path.join(root, "public/icons/icon-192.png"));
  await writePng(monogram({ size: 512, scale: 0.5 }), 512, path.join(root, "public/icons/icon-512.png"));

  // "maskable" icon — Android adaptive icons crop to a circle, so the glyph must sit
  // inside the ~80% safe zone (using a smaller glyph scale) with full-bleed background.
  await writePng(
    monogram({ size: 512, scale: 0.3 }),
    512,
    path.join(root, "public/icons/icon-maskable-512.png"),
  );

  // iOS home screen icon — Next picks up app/apple-icon.png automatically. iOS applies
  // its own corner rounding, so no radius here either.
  await writePng(monogram({ size: 180, scale: 0.5 }), 180, path.join(root, "src/app/apple-icon.png"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
