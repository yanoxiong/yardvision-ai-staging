# HTTPS HEIC photo testing (public staging ONLY)

- Publishes from the isolated `staging/https-heic-photo-preview-20261104` branch using the GitHub Actions Pages workflow, **not** `main`.
- Build output is a photo-only browser tester. No sign-in, customer account, database, AI generation, upload API, or Stripe.
- Use a non-sensitive yard HEIC/JPG photo. The file stays in the browser; no photo upload or server processing.
- The main test page has a CSP that prohibits JavaScript `unsafe-eval`; current decoder's nested worker is **not production CSP compatible**, and this test alone must never be promoted to production.
- Still blocked for public release: full LGPL/codec license review, bounded decode resources, nested-worker termination, hosted production CSP and account/billing regression, explicit approval.
- For a live preview, repo admin must enable GitHub Pages via Settings > Pages > Source = GitHub Actions. Protect the Pages environment appropriately while allowing this known staging branch.
- If a deployment fails immediately with no job steps after Pages is enabled, check the `github-pages` environment's deployment branch/tag restrictions in Settings > Environments before changing workflow permissions or production branches.
- Confirmation checklist: preview HTTPS response exists, HEIC photo input previews upright, JPG/PNG work, corrupt HEIC rejected, user confirms Galaxy S25.
