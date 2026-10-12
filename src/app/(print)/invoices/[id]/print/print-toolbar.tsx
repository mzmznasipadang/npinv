"use client";

import { useEffect } from "react";
import Link from "next/link";

type PrintToolbarProps = { auto: boolean; backHref: string; title: string };

/** Screen-only controls. With `auto`, opens the print dialog once fonts and images are ready. */
export function PrintToolbar({ auto, backHref, title }: PrintToolbarProps) {
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
      <button type="button" onClick={() => window.print()}>
        Print / Save as PDF
      </button>
    </div>
  );
}
