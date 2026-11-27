import { IS_APPLE_PLATFORM } from '../ui/dom-events.ts';
export const IS_IOS_BROWSER = typeof CSS < 'u' && CSS.supports('-webkit-touch-callout', 'none');
export const IS_MAC_SAFARI = IS_APPLE_PLATFORM && !IS_IOS_BROWSER && typeof CSS < 'u' && CSS.supports('font', '-apple-system-body');
