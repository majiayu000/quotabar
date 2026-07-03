# GH-18 Product Spec: Settings View, Tray Controls, and Footer Actions

Linked issue: https://github.com/majiayu000/quotabar/issues/18

## Goals

- Redesign the settings experience from the current compact foldout into a settings view or equivalent compact panel matching the design package.
- Preserve and polish existing settings: theme, macOS Hide Dock, and per-provider tray toggles.
- Keep the at-least-one-tray-enabled guard visible and reliable.
- Redesign bottom actions to match the design footer while keeping Refresh, Dashboard, and Quit behavior scoped to the active provider/app.
- Leave space for future panel section and notification settings without presenting unsupported controls as functional.

## Non-Goals

- Do not implement native notification scheduling or quota threshold alerts in this issue.
- Do not change backend tray command protocols.
- Do not modify high-context workflow files such as `AGENTS.md`, `WORKFLOW.md`, hooks, or settings files.
- Do not create fake settings that appear to work but are not wired to state or backend behavior.

## Acceptance Criteria

- Settings UI is usable within the menubar popover height and 320-340px width constraints, without overlapping text or footer controls.
- Theme selection, Hide Dock, settings expanded/view state, and tray visibility continue to persist with existing storage keys unless a migration is explicitly documented.
- Tray toggles list all services and still prevent disabling the final enabled tray.
- Footer actions operate on the active provider: refresh active data, open active dashboard, quit app.
- Loading/disabled states are visible and accessible.
- Tray activation event still switches to the selected provider.
- Any future-looking settings are either hidden, disabled with clear text, or implemented end-to-end.

## Verification

- `npx tsc --noEmit`
- `npm test`
- `npm run build`
- Manual checks for theme persistence, Hide Dock on macOS, tray toggles, final-tray guard toast, active-provider refresh/dashboard, and quit behavior.
