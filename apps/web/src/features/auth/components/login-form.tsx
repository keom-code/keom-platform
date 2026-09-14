"use client";

import { useActionState } from "react";
import { Button, Input } from "@keom/ui";
import { loginAction, type LoginActionState } from "../actions";

const initialState: LoginActionState = {};

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="dni" className="text-sm font-medium">
          DNI
        </label>
        <Input
          id="dni"
          name="dni"
          inputMode="numeric"
          autoComplete="off"
          placeholder="12345678"
          maxLength={8}
          required
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Ingresando..." : "Ingresar"}
      </Button>
    </form>
  );
}
