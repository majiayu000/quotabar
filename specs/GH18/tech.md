# GH-18 Tech Spec: Settings View, Tray Controls, and Footer Actions

## Proposed Design

Implement after GH-16 shell work, and coordinate with GH-17 because both touch `src/App.tsx` and `src/styles.css`.

## Settings State

Preserve existing storage keys unless the implementation includes a documented migration:

- `claude-quota-theme`
- `claude-quota-dock-hidden`
- `claude-quota-tab`
- `claude-quota-settings-expanded`
- per-provider tray visibility keys from `src/services/tray_visibility.ts`

The settings view can be represented as a local UI mode, separate from provider tabs, so tray activation and provider tab persistence remain stable.

## Tray Controls

Continue using `getSavedTrayEnabled`, `saveTrayEnabled`, and `shouldShowTray`.

The guard behavior remains:

- at least one service remains enabled;
- blocked disable attempt leaves state unchanged;
- user receives visible toast/message.

Do not reinterpret disconnected services as disabled. Enabled-but-disconnected is still a meaningful tray preference.

## Footer Actions

Footer actions should call the existing app handlers:

- refresh active provider and active cost summary where supported;
- open active provider dashboard;
- quit app.

If provider panels keep internal dashboard buttons, the implementation must decide whether to remove duplicates or keep both intentionally. The PR body should record the decision.

## Future Settings

Design package includes menu bar style, panel sections, notifications, recent events, and cycle-one-icon controls. This issue may add layout affordances for them only if they are disabled or fully wired. Do not ship interactive controls without behavior.

## Likely Files

- `src/App.tsx`
- `src/components/ActionButtons.tsx`
- `src/components/TabSwitcher.tsx`
- `src/components/ThemeSelector.tsx`
- `src/components/TrayToggles.tsx`
- `src/services/service_meta.ts`
- `src/services/tray_visibility.ts`
- `src/styles.css`

## Test Plan

- Unit-test any extracted localStorage or settings-mode helpers.
- `npx tsc --noEmit`
- `npm test`
- `npm run build`
- Manual Tauri check for dock visibility and quit behavior.

## Rollback Plan

Revert the GH-18 implementation PR. Existing localStorage keys should continue to work because this issue should not require a destructive settings migration.
