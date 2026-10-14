"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "@/lib/auth-actions";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(loginAction, null);
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-xl font-semibold">Naspad Studio Invoices</h1>
      <form action={formAction} className="flex flex-col gap-3">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" autoFocus required />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending}>Sign in</Button>
      </form>
    </main>
  );
}
