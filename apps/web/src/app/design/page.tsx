import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@keom/ui";
import { AlertTriangleIcon, InfoIcon, AlertCircleIcon } from "lucide-react";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";

const riskLevels = [
  {
    level: "HIGH",
    label: "Alto",
    Icon: AlertTriangleIcon,
    bg: "bg-risk-high-bg",
    fg: "text-risk-high-fg",
    border: "border-risk-high-border",
  },
  {
    level: "MEDIUM",
    label: "Medio",
    Icon: AlertCircleIcon,
    bg: "bg-risk-medium-bg",
    fg: "text-risk-medium-fg",
    border: "border-risk-medium-border",
  },
  {
    level: "LOW",
    label: "Bajo",
    Icon: InfoIcon,
    bg: "bg-risk-low-bg",
    fg: "text-risk-low-fg",
    border: "border-risk-low-border",
  },
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
        {title}
      </h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

export default function DesignPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Design System</h1>
          <p className="text-sm text-muted-foreground">
            Fase 1 — primitivos de packages/ui y tokens de KEOM.
          </p>
        </div>
        <ThemeSwitcher />
      </header>

      <Section title="Buttons">
        <Button>Default</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
      </Section>

      <Section title="Badges">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="outline">Outline</Badge>
      </Section>

      <Section title="Card">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Juan Pérez</CardTitle>
            <CardDescription>+51 999 111 222</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <Avatar>
              <AvatarImage src="" alt="Juan Pérez" />
              <AvatarFallback>JP</AvatarFallback>
            </Avatar>
            <Skeleton className="h-4 w-40" />
          </CardContent>
        </Card>
      </Section>

      <Section title="Input / Select">
        <Input placeholder="Buscar cliente..." className="max-w-56" />
        <Select defaultValue="all">
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="high">Alto</SelectItem>
            <SelectItem value="medium">Medio</SelectItem>
            <SelectItem value="low">Bajo</SelectItem>
          </SelectContent>
        </Select>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="alerts" className="w-full max-w-sm">
          <TabsList>
            <TabsTrigger value="alerts">Alertas</TabsTrigger>
            <TabsTrigger value="risk">Riesgo</TabsTrigger>
          </TabsList>
          <TabsContent value="alerts">3 oportunidades necesitan una acción.</TabsContent>
          <TabsContent value="risk">Clientes en riesgo.</TabsContent>
        </Tabs>
      </Section>

      <Section title="Sheet">
        <Sheet>
          <SheetTrigger render={<Button variant="outline">Abrir sheet</Button>} />
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Detalle de alerta</SheetTitle>
              <SheetDescription>Contenido de ejemplo para la Fase 1.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      </Section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Risk tokens
        </h2>
        <p className="text-sm text-muted-foreground">
          Cada nivel siempre combina etiqueta + ícono + tinte — nunca color solo.
        </p>
        <div className="flex flex-wrap gap-3">
          {riskLevels.map(({ level, label, Icon, bg, fg, border }) => (
            <div
              key={level}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${bg} ${fg} ${border}`}
            >
              <Icon className="size-4" />
              {label}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
