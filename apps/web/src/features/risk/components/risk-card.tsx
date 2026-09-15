"use client";

import { BarChart3Icon, MessageCircleIcon, TargetIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage, Button, Card } from "@keom/ui";
import type { CustomerRisk } from "@keom/contracts";
import { LevelBadge } from "@/components/shared/level-badge";
import { ScoreCircle } from "@/components/shared/score-circle";
import { WhatsAppIcon } from "@/components/shared/whatsapp-icon";
import { formatCurrency, formatRelativeTime, initials } from "@/lib/utils";

const WHATSAPP_BUTTON_CLASSES = "bg-success text-white hover:bg-success/90";

function openWhatsApp(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function Divider() {
  return <span aria-hidden className="hidden w-px shrink-0 self-stretch bg-border lg:block" />;
}

function IconTile({ icon: Icon }: { icon: typeof TargetIcon }) {
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Icon className="size-4" />
    </div>
  );
}

export function RiskCard({ risk }: { risk: CustomerRisk }) {
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-6 p-5 lg:gap-6 lg:p-6">
        <div className="flex min-w-[220px] flex-1 flex-col gap-3">
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarImage src={risk.avatarUrl} alt={risk.customerName} />
              <AvatarFallback>{initials(risk.customerName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="truncate font-semibold">{risk.customerName}</p>
                <LevelBadge level={risk.riskLevel} className="shrink-0" />
              </div>
              {risk.treatment ? (
                <p className="text-sm text-muted-foreground">{risk.treatment}</p>
              ) : null}
            </div>
          </div>

          <div className="flex items-start gap-3">
            <IconTile icon={MessageCircleIcon} />
            <div className="min-w-0">
              <p className="font-medium">{risk.reason}</p>
              <p className="text-sm text-muted-foreground">
                Último mensaje: {formatRelativeTime(risk.lastActivityAt)}
              </p>
            </div>
          </div>
        </div>

        <Divider />

        <div className="flex min-w-[220px] flex-1 items-start gap-3">
          <TargetIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Siguiente mejor acción</p>
            <p className="font-medium">{risk.nextBestAction}</p>
          </div>
        </div>

        <Divider />

        <div className="flex shrink-0 items-center gap-6">
          {risk.opportunityValue != null ? (
            <div className="flex items-center gap-3">
              <IconTile icon={BarChart3Icon} />
              <div>
                <p className="text-sm text-muted-foreground">Valor potencial</p>
                <p className="text-lg font-bold">{formatCurrency(risk.opportunityValue)}</p>
              </div>
            </div>
          ) : null}

          <ScoreCircle level={risk.riskLevel} score={risk.riskScore} orientation="row" />
        </div>

        <Divider />

        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-4">
          <Button onClick={() => openWhatsApp(risk.whatsappUrl)} className={WHATSAPP_BUTTON_CLASSES}>
            <WhatsAppIcon className="size-4" />
            Abrir WhatsApp
          </Button>
        </div>
      </div>
    </Card>
  );
}
