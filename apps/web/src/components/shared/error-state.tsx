"use client";

import { AlertOctagonIcon } from "lucide-react";
import { Button } from "@keom/ui";

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center">
      <AlertOctagonIcon className="size-8 text-destructive" />
      <p className="font-medium">Ocurrió un error al cargar los datos.</p>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}
