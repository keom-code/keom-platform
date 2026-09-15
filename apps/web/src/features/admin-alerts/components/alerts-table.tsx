import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@keom/ui";
import type { AdminAlertRow } from "@keom/contracts";
import { AlertStatusBadge } from "@/components/shared/alert-status-badge";
import { formatRelativeTime } from "@/lib/utils";

export function AlertsTable({ alerts }: { alerts: AdminAlertRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Cliente</TableHead>
          <TableHead>Vendedor</TableHead>
          <TableHead>Motivo</TableHead>
          <TableHead>Hora</TableHead>
          <TableHead>Estado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {alerts.map((alert) => (
          <TableRow key={alert.id}>
            <TableCell className="font-medium">
              <Link href={`/admin/alerts/${alert.id}`} className="hover:underline">
                {alert.customerName}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">{alert.sellerName}</TableCell>
            <TableCell className="text-muted-foreground">{alert.reason}</TableCell>
            <TableCell className="text-muted-foreground">
              {formatRelativeTime(alert.createdAt)}
            </TableCell>
            <TableCell>
              <AlertStatusBadge status={alert.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
