"use client";

import { RefreshCwIcon } from "lucide-react";
import { Button } from "@keom/ui";

export function RetryButton() {
  return (
    <Button onClick={() => window.location.reload()}>
      <RefreshCwIcon />
      Reintentar
    </Button>
  );
}
