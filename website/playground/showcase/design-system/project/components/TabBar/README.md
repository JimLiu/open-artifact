The app's four places, at the bottom of every top-level screen. The current one is `accent-strong`, icon and label together; the others are `ink-muted`.

- Always four items, always icon plus label. Icons are 24px, 1.75 stroke, drawn with `currentColor`.
- It sits on `surface-raised` with a `line` around it and never scrolls away.
- On screens wider than a phone, the same items move to the top of the page as Tabs.
- You provide `value` and `onChange`; the items are fixed.
