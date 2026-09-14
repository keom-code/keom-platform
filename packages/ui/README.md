# @keom/ui

Shared design-system primitives (shadcn/ui, Base UI-based) + KEOM theme tokens. See
[`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) Section F for the design system strategy.

**What belongs here:** shadcn-generated primitives only (Button, Card, Badge, etc.) and the
shared theme (`src/theme/globals.css`). Domain components that know about `SellerAlert`,
`CustomerRisk`, etc. belong in `apps/web` instead — see Section A/C for why.

## Adding a new shadcn primitive

The shadcn CLI's framework detection expects an app (Next.js/Vite), not a library package,
so components are generated in `apps/web` and then moved here:

```bash
cd apps/web
pnpm dlx shadcn@latest add <component>
```

Then, for each generated file in `apps/web/src/components/ui/`:

1. Move it to `packages/ui/src/components/ui/`.
2. Fix any cross-component import from `@/components/ui/<name>` to a relative import
   (e.g. `./button`) — everything else (`cn` from the `cn` package, `@base-ui/react/*`,
   `lucide-react`) resolves the same regardless of which package the file lives in.
3. Export the component's public API from `packages/ui/src/index.ts`.
4. Add any new dependency the component introduces (check its imports) to this package's
   `package.json` — `apps/web` should not need to depend on `@base-ui/react` or
   `class-variance-authority` directly; only `@keom/ui` does.
