"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@keom/ui";
import type { DateRangePreset } from "@keom/contracts";

const DATE_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: "TODAY", label: "Hoy" },
  { value: "7D", label: "7 días" },
  { value: "30D", label: "30 días" },
];

export function ReportFilterBar({ treatments }: { treatments: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams);
    if (!value || value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    router.push(params.size > 0 ? `${pathname}?${params.toString()}` : pathname);
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Select value={searchParams.get("range") ?? "30D"} onValueChange={(v) => updateParam("range", v)}>
        <SelectTrigger className="w-32" aria-label="Rango de fechas">
          <SelectValue>
            {(value: string) => DATE_OPTIONS.find((option) => option.value === value)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {DATE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={searchParams.get("treatment") ?? "all"}
        onValueChange={(v) => updateParam("treatment", v)}
      >
        <SelectTrigger className="w-44" aria-label="Servicio">
          <SelectValue>{(value: string) => (value === "all" ? "Todos los servicios" : value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los servicios</SelectItem>
          {treatments.map((treatment) => (
            <SelectItem key={treatment} value={treatment}>
              {treatment}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
