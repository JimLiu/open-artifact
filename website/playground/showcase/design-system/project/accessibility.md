# Accessibility

- **Contrast.** Copy meets 4.5:1 on the surface its token names, in both themes; control borders (`line-strong`) and the focus ring meet 3:1. The Colors section checks every pair on each change.
- **Focus.** Every control shows `accent-focus` as a 2px solid ring, 2px away from its edge, on keyboard focus. Never remove it; never rely on a color change alone.
- **Color is never the only signal.** Tags carry a word, errors carry a message, the roast meter carries a label.
- **Targets.** Anything you can press is at least 44px tall on touch screens: the `md` and `lg` button sizes, a tab, a switch with its label.
- **Motion.** Durations come from the Motion tokens and are wrapped in `prefers-reduced-motion`. Nothing moves that the person did not start.
