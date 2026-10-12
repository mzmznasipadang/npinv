"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import type { FieldErrors, FormState } from "@/lib/schemas";

/** Controlled form values, submitted through a Server Action that returns field errors. */
export function useServerForm<V extends object>(initial: V, submit: (values: V) => Promise<FormState>) {
  const [values, setValues] = useState<V>(initial);
  const [state, setState] = useState<FormState>({});
  const [pending, startTransition] = useTransition();

  function set<K extends keyof V>(key: K, value: V[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function reset(next: V) {
    setValues(next);
    setState({});
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await submit(values);
      if (!result) return; // the action redirected
      setState(result);
      if (result.message) toast.error(result.message);
    });
  }

  const errors: FieldErrors = state.errors ?? {};
  return { values, setValues, set, reset, errors, pending, onSubmit };
}

/** Runs a one-off Server Action with a pending flag, and a toast when it fails. */
export function useAction() {
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<FormState>, onOk?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (!result) return; // the action redirected
      if (result.ok) onOk?.();
      else toast.error(result.message ?? Object.values(result.errors ?? {})[0] ?? "Something went wrong.");
    });
  }

  return { pending, run };
}
