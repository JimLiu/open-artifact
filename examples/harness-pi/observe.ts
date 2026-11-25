import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  pi.on('input', (event) => {
    if (event.source !== 'extension') return;
    pi.sendMessage({ customType: 'observed-open-artifact-input', content: event.text, display: true });
    return { action: 'handled' };
  });
}
