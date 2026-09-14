import { Avatar, AvatarFallback, AvatarImage, Card, CardContent, CardHeader } from "@keom/ui";
import type { CustomerRisk } from "@keom/contracts";
import { LevelBadge } from "@/components/shared/level-badge";
import { ScoreCircle } from "@/components/shared/score-circle";
import { formatCurrency, formatRelativeTime, initials } from "@/lib/utils";

export function RiskCard({ risk }: { risk: CustomerRisk }) {
  return (
    <Card className="gap-3">
      <CardHeader className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar>
            <AvatarImage src={risk.avatarUrl} alt={risk.customerName} />
            <AvatarFallback>{initials(risk.customerName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{risk.customerName}</p>
            {risk.treatment ? (
              <p className="text-sm text-muted-foreground">{risk.treatment}</p>
            ) : null}
          </div>
        </div>
        <ScoreCircle level={risk.riskLevel} score={risk.riskScore} className="shrink-0" />
      </CardHeader>

      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <LevelBadge level={risk.riskLevel} />
          {risk.opportunityValue != null ? (
            <p>
              <span className="text-muted-foreground">Valor potencial: </span>
              <span className="font-medium">{formatCurrency(risk.opportunityValue)}</span>
            </p>
          ) : null}
        </div>
        <p className="text-muted-foreground">{risk.reason}</p>
        <p className="text-xs text-muted-foreground">{formatRelativeTime(risk.lastActivityAt)}</p>
      </CardContent>
    </Card>
  );
}
