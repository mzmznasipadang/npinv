"use client";

import { useEffect } from "react";
import Link from "next/link";

type VersionLink = { label: string; href: string; current: boolean };
type PrintToolbarProps = { auto: boolean; backHref: string; title: string; versions: VersionLink[] };

/** Screen-only controls. With `auto`, opens the print dialog once fonts and images are ready. */
export function PrintToolbar({ auto, backHref, title, versions }: PrintToolbarProps) {
  useEffect(() => {
    // The browser offers the document title as the PDF file name.
    document.title = title;
    if (!auto) return;
    let cancelled = false;
    const images = Array.from(document.images, (image) => image.decode().catch(() => undefined));
    Promise.all([document.fonts.ready, ...images]).then(() => {
      if (!cancelled) window.print();
    });
    return () => {
      cancelled = true;
    };
  }, [auto, title]);

  return (
    <div className="toolbar">
      <Link href={backHref}>Back to invoice</Link>
      {versions.length > 1 ? (
        <nav aria-label="Version" className="versions">
          {versions.map((version) => (
            <Link key={version.href} href={version.href} replace aria-current={version.current ? "page" : undefined}>
              {version.label}
            </Link>
          ))}
        </nav>
      ) : null}
      <button type="button" onClick={() => window.print()}>
        Print / Save as PDF
      </button>
    </div>
  );
}
