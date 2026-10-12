import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">That page or invoice does not exist.</p>
      <Link href="/" className="font-semibold text-primary underline underline-offset-4">
        Back to the dashboard
      </Link>
    </main>
  );
}
