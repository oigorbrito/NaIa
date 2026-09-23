# Palette Agent Journal - Critical UX & Accessibility Learnings

## 2026-03-29 - Navigation Accessibility with ARIA Landmarks and Current Page Indicators
**Learning:** In lightweight server-rendered HTML shells (like `production-web-ui.mjs`), screen readers rely on `<nav>` landmarks having descriptive labels (`aria-label="Main navigation"`) and active links having `aria-current="page"` rather than relying solely on visual CSS classes (`class="active"`).
**Action:** Always ensure navigation `<nav>` containers include an explicit `aria-label` and active page links output `aria-current="page"`.
