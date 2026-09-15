"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@keom/ui";
import { LEVEL_CONFIG, type Level } from "@/components/shared/level-badge";

const LEVEL_OPTIONS: { value: "all" | Level; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "HIGH", label: LEVEL_CONFIG.HIGH.label },
  { value: "MEDIUM", label: LEVEL_CONFIG.MEDIUM.label },
  { value: "LOW", label: LEVEL_CONFIG.LOW.label },
];

const TRIGGER_CLASSES: Record<"all" | Level, string> = {
  all: "border-input bg-transparent",
  HIGH: "border-risk-high-border bg-risk-high-bg text-risk-high-fg",
  MEDIUM: "border-risk-medium-border bg-risk-medium-bg text-risk-medium-fg",
  LOW: "border-risk-low-border bg-risk-low-bg text-risk-low-fg",
};

export function RiskFilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") ?? "");
  const level = (searchParams.get("level") ?? "all") as "all" | Level;

  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams);
    if (!value || value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    startTransition(() => {
      router.push(params.size > 0 ? `${pathname}?${params.toString()}` : pathname);
    });
  }

  // Debounced so typing doesn't trigger a server round-trip on every keystroke.
  useEffect(() => {
    const timeout = setTimeout(() => updateParam("search", searchInput), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  return (
    <div className="flex flex-wrap gap-3">
      <div className="relative max-w-72 flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar cliente..."
          aria-label="Buscar cliente"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          className="h-11 rounded-xl pl-9"
        />
      </div>
      <Select value={level} onValueChange={(value) => updateParam("level", value)}>
        <SelectTrigger
          className={`h-11 w-36 gap-2 rounded-xl px-3 font-medium ${TRIGGER_CLASSES[level]}`}
          aria-label="Nivel de riesgo"
        >
          <SelectValue>
            {(value: string) => {
              const option = value as "all" | Level;
              const Icon = option === "all" ? undefined : LEVEL_CONFIG[option].icon;
              return (
                <>
                  {Icon ? <Icon className="size-4" /> : null}
                  {LEVEL_OPTIONS.find((o) => o.value === option)?.label}
                </>
              );
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {LEVEL_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
