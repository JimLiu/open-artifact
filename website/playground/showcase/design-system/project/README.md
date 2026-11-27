Juniper Coffee roasts in small batches and ships the same day. This is what its app, its site and its bags are made from: one palette, two type families, one scale. Calm, warm and exact.

## Principles

- **Paper first.** Pages are `surface`; cards are `surface-raised` with a `line` around them. Color is spent, not spread.
- **One accent.** `accent` marks the one thing a view is for, and where you are. If two things on a screen are terracotta, one of them is wrong.
- **The serif says, the sans does.** Names and headlines are set in `display`, `headline` and `title`; everything you read or press is the system sans.
- **Borders before shadows.** A shadow means "this floats": menus, toasts, sheets. Nothing else gets one.

## Color

| Use | Token | Notes |
| --- | --- | --- |
| Page | `surface` | Cream in the light theme, roast-dark in the dark one |
| Cards, fields | `surface-raised` | Always with a `line` border |
| Copy | `ink`, `ink-muted` | Both read on every surface |
| The main action | `accent` with `on-accent` | Once per view |
| Terracotta as text | `accent-strong` | `accent` itself is too light for body copy on cream |
| Links | `text-link` | Underlined; follows `accent-strong` |
| Brand fills | `forest` with `on-forest` | Toasts, the bag label, a switch that is on |
| Seasonal | `honey`, `honey-soft` | First Light's color: a little at a time |
| Errors | `danger`, `text-danger` | Always with words, never color alone |

Never write a hex value in a component. If a token is missing, add it here first.

## Type

Set one `display` line per page at most. A coffee's name is a `title`; the line above it an `overline`, the only uppercase in the system. Body copy is `body`, 60 to 72 characters wide. Prices, weights and dates in lists use `data`, so digits line up.

## Space and shape

Spacing steps from `space-1` (4px) to `space-8` (72px). Inside a component stay at `space-4` or below; between components start at `space-5`. Corners follow size: `radius-sm` for tags, `radius-md` for buttons and fields, `radius-lg` for cards. Only switches and the roast meter are fully round.

## Themes

Every color has a light and a dark value, and components use tokens only, so a screen changes theme by setting `data-theme="dark"` on its root. Pick the preview theme at the top of Components to check both.
