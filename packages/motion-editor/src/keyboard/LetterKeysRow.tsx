import { createElement, type ReactElement } from 'react';
import { MenuCheckboxItem } from '@open-artifact/ui';
import { MORE_GROUP, registerMoreItem } from '../transport/more.ts';
import { setLetterKeys, useLetterKeys } from './letter-keys.ts';
import { SINGLE_KEY_SHORTCUTS } from './words.ts';

function LetterKeysRow(): ReactElement {
  const on = useLetterKeys((s) => s.on);
  return (
    <MenuCheckboxItem checked={on} onCheckedChange={setLetterKeys}>
      {SINGLE_KEY_SHORTCUTS}
    </MenuCheckboxItem>
  );
}

/** The More menu's Single-key shortcuts check. */
export function registerLetterKeysRow(): () => void {
  return registerMoreItem({ id: 'letter-keys', group: MORE_GROUP.keys, order: 10, render: () => createElement(LetterKeysRow) });
}
