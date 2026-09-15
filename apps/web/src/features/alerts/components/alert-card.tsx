"use client";

import { ClockIcon, FileTextIcon, UserRoundIcon } from "lucide-react";
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
import { WhatsAppIcon } from "@/components/shared/whatsapp-icon";
import { formatCurrency, formatRelativeTime, initials } from "@/lib/utils";
import { useAcknowledgeAlert } from "../hooks/use-seller-alerts";

function openWhatsApp(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function HeaderDivider() {
  return <span aria-hidden className="hidden h-10 w-px shrink-0 bg-border sm:block" />;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function AlertCard({ alert }: { alert: SellerAlert }) {
  const acknowledge = useAcknowledgeAlert();
  const fullName = `${alert.customer.firstName} ${alert.customer.lastName}`;

  function handlePrimaryAction() {
    acknowledge.mutate(alert.id);
    openWhatsApp(alert.whatsappUrl);
  }

  return (
    <Card className="gap-0 p-0">
      <CardHeader className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar>
            <AvatarImage src={alert.customer.avatarUrl} alt={fullName} />
            <AvatarFallback>{initials(fullName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-semibold">{fullName}</p>
            <p className="text-sm text-muted-foreground">{alert.customer.phone}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <HeaderDivider />
          <LevelBadge level={alert.priority} />

          {alert.opportunityValue != null && (
            <>
              <HeaderDivider />
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Valor potencial</p>
                <p className="text-lg font-bold">{formatCurrency(alert.opportunityValue)}</p>
              </div>
            </>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 py-4 text-sm">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 font-semibold">
            <FileTextIcon className="size-5 text-muted-foreground" />
            Resumen
          </div>
          <p className="text-muted-foreground">{alert.summary}</p>
        </div>

        <div className="-mx-4 border-t border-border" />

        <div className="flex items-start gap-3 rounded-lg bg-muted p-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background/60 ring-1 ring-border">
            <UserRoundIcon className="size-4 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold">Necesita de ti</p>
            <p>{alert.requiredAction}</p>
          </div>
        </div>

        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ClockIcon className="size-4" />
          {capitalize(formatRelativeTime(alert.createdAt))}
        </span>
      </CardContent>

      <CardFooter className="p-4">
        <Button
          onClick={handlePrimaryAction}
          disabled={acknowledge.isPending}
          className="h-12 w-full bg-[#3BA65C] text-base text-white hover:bg-[#359955]"
        >
          <WhatsAppIcon className="size-5" />
          {acknowledge.isPending ? "Procesando..." : "Abrir WhatsApp"}
        </Button>
      </CardFooter>
    </Card>
  );
}
