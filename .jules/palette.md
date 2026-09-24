## 2026-03-31 - Web UI Navigation and Form Accessibility
**Learning:** In NaIA's server-rendered HTML shells (`production-web-ui` and `minimal-web-ui`), landmark navigation (`aria-label`, `aria-current="page"`) and explicit label-input associations (`for`/`id`) are required for WCAG compliance and keyboard/screen-reader navigation.
**Action:** When adding or extending web surfaces in `src/product/*-web-ui.mjs`, ensure all `<nav>` tags specify `aria-label`, active links use `aria-current="page"`, form controls have matching `for`/`id` pairs, and CSS includes `:focus-visible` styling.
