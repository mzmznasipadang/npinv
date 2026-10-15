# Montserrat

Used by the invoice print document that the mobile API serves (`src/lib/invoice-print.ts`),
so PDFs made in the iOS app use the same typeface as the web dashboard.

- Font: Montserrat, variable weight 100–900. Copyright 2011 The Montserrat Project Authors
  (https://github.com/JulietaUla/Montserrat).
- License: SIL Open Font License, Version 1.1, in `OFL.txt` (from the Montserrat repository;
  also at https://openfontlicense.org).
- Files: the Google Fonts `latin` and `latin-ext` subsets, the same files `next/font/google`
  downloads for the web dashboard (copied from a local build's `.next/static/media`).
  - `montserrat-latin.woff2`: U+0000–00FF, U+0131, U+0152–0153, U+02BB–02BC, U+02C6, U+02DA,
    U+02DC, U+0304, U+0308, U+0329, U+2000–206F, U+20AC, U+2122, U+2191, U+2193, U+2212,
    U+2215, U+FEFF, U+FFFD.
  - `montserrat-latin-ext.woff2`: U+0100–02BA and the other ranges listed in `invoice-print.ts`.
