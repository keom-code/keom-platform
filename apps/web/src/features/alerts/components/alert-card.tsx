"use client";

import { ExternalLinkIcon } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@keom/ui";
import type { SellerAlert } from "@keom/contracts";
import { LevelBadge } from "@/components/shared/level-badge";
import { formatCurrency, formatRelativeTime, initials } from "@/lib/utils";
import { useAcknowledgeAlert } from "../hooks/use-seller-alerts";

function openWhatsApp(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function AlertCard({ alert }: { alert: SellerAlert }) {
  const acknowledge = useAcknowledgeAlert();
  const fullName = `${alert.customer.firstName} ${alert.customer.lastName}`;
  const isPending = alert.status === "PENDING";

  function handlePrimaryAction() {
    if (isPending) {
      acknowledge.mutate(alert.id);
    }
    openWhatsApp(alert.whatsappUrl);
  }

  return (
    <Card className="gap-4">
      <CardHeader className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar>
            <AvatarImage src={alert.customer.avatarUrl} alt={fullName} />
            <AvatarFallback>{initials(fullName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{fullName}</p>
            <p className="text-sm text-muted-foreground">{alert.customer.phone}</p>
          </div>
        </div>
        <LevelBadge level={alert.priority} className="shrink-0" />
      </CardHeader>

      <CardContent className="flex flex-col gap-3 text-sm">
        {alert.opportunityValue != null && (
          <p>
            <span className="text-muted-foreground">Valor potencial: </span>
            <span className="font-medium">{formatCurrency(alert.opportunityValue)}</span>
          </p>
        )}
        <p className="text-muted-foreground">{alert.summary}</p>
        <div className="rounded-lg bg-muted p-3">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Necesita de ti
          </p>
          <p>{alert.requiredAction}</p>
        </div>
        <p className="text-xs text-muted-foreground">{formatRelativeTime(alert.createdAt)}</p>
      </CardContent>

      <CardFooter>
        {isPending ? (
          <Button
            onClick={handlePrimaryAction}
            disabled={acknowledge.isPending}
            className="w-full"
          >
            <ExternalLinkIcon />
            {acknowledge.isPending ? "Procesando..." : "Abrir en WhatsApp"}
          </Button>
        ) : (
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-sm font-medium text-muted-foreground">Atendido</span>
            <Button variant="outline" size="sm" onClick={() => openWhatsApp(alert.whatsappUrl)}>
              <ExternalLinkIcon />
              Abrir WhatsApp
            </Button>
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
