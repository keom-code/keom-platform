"use client";

import { useTransition } from "react";
import { LogOutIcon } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@keom/ui";
import { useSession } from "@/providers/session-provider";
import { logoutAction } from "@/features/auth/actions";
import { initials } from "@/lib/utils";

const ROLE_LABEL: Record<string, string> = {
  SELLER: "Vendedor",
  ADMIN: "Administrador",
};

export function ProfileMenu() {
  const session = useSession();
  const [, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Menú de perfil"
            className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Avatar className="size-8">
              <AvatarFallback>{initials(session.name)}</AvatarFallback>
            </Avatar>
          </button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block font-medium">{session.name}</span>
            <span className="block text-xs text-muted-foreground">
              {ROLE_LABEL[session.role] ?? session.role}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            startTransition(() => {
              void logoutAction();
            });
          }}
        >
          <LogOutIcon />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
