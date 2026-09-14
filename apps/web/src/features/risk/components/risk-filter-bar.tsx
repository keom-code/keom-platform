"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@keom/ui";

const LEVEL_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "HIGH", label: "Alto" },
  { value: "MEDIUM", label: "Medio" },
  { value: "LOW", label: "Bajo" },
];

export function RiskFilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") ?? "");

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
      <Input
        placeholder="Buscar cliente..."
        value={searchInput}
        onChange={(event) => setSearchInput(event.target.value)}
        className="max-w-56"
      />
      <Select
        value={searchParams.get("level") ?? "all"}
        onValueChange={(value) => updateParam("level", value)}
      >
        <SelectTrigger className="w-32">
          <SelectValue>
            {(value: string) => LEVEL_OPTIONS.find((option) => option.value === value)?.label}
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
