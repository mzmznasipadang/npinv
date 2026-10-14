"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_SECONDS, checkPassword, createSession } from "./auth";

export async function loginAction(_: string | null, formData: FormData): Promise<string | null> {
  const attempt = formData.get("password");
  const token = typeof attempt === "string" && checkPassword(attempt) ? createSession() : null;
  if (token === null) {
    // A flat delay makes guessing slow without any server-side bookkeeping.
    await new Promise((resolve) => setTimeout(resolve, 800));
    return process.env.ADMIN_PASSWORD ? "Wrong password." : "ADMIN_PASSWORD is not set on the server.";
  }
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
