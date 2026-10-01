## 2026-10-01 - Web UI Accessible Controls and Navigation
**Learning:** In template-rendered web UI shells with custom icons (like mic triggers or navigation links), interactive `<span>` click handlers lack keyboard accessibility and screen-reader context (`aria-current` and `aria-label`).
**Action:** Always wrap icon triggers in semantic `<button type="button">` with explicit `aria-label` attributes and include `:focus-visible` outline styles for keyboard navigation.
