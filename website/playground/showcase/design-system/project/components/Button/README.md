The thing a view is for. One **primary** per view, the terracotta one; everything else is **secondary** or **quiet**. Use **danger** only for what cannot be undone, and say what it does: "Cancel subscription", never "Confirm".

- Labels are sentence case and start with a verb: "Add to bag", "Skip this delivery".
- `md` (44px) is the default and the smallest size for touch. `sm` is for dense rows on a pointer device.
- An icon follows the label and repeats its meaning; it never replaces it.
- You provide the label and the handler. The button keeps its own height, padding and focus ring (`accent-focus`).
