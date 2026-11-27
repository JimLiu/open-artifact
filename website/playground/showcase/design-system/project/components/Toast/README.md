A short confirmation that something happened, with a way back. It floats above the page on `shadow-lg`, bottom center on a phone and bottom left on wider screens, and leaves by itself after six seconds.

- **Success** is a `forest` fill with `on-forest` copy: the person did something and it worked. **Plain** is for news nobody asked for, such as a skipped delivery.
- One sentence, no title, a period at the end. One action at most, and it is almost always "Undo".
- Never use a toast for an error: errors stay beside what caused them until they are fixed.
- You provide `message`, `tone` and, if there is a way back, `action`.
