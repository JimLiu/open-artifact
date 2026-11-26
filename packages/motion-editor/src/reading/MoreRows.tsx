import type { ReactElement } from 'react';
import { MenuCheckboxItem, MenuItem } from '@open-artifact/ui';
import { useFilm } from '../stores/film.ts';
import { useUi } from '../stores/ui.ts';
import { setDescribeAloud, useDescribeAloud } from './describe-aloud.ts';
import { READ_PANEL } from './panel-id.ts';
import * as words from './words.ts';

export function ReadAsTextRow(): ReactElement {
  const ready = useFilm((s) => s.stage === 'ready');
  return (
    <MenuItem disabled={!ready} onSelect={() => useUi.getState().openPanel(READ_PANEL)}>
      {words.READ_AS_TEXT}
    </MenuItem>
  );
}

/** Left out where the browser has no voice of its own for the page's language. */
export function DescribeAloudRow(): ReactElement | null {
  const on = useDescribeAloud((s) => s.on);
  const voice = useDescribeAloud((s) => s.voice);
  const scenes = useFilm((s) => s.scenes !== null);
  if (!voice || !scenes) return null;
  return (
    <MenuCheckboxItem checked={on} onCheckedChange={setDescribeAloud}>
      {words.DESCRIBE_SCENES_ALOUD}
    </MenuCheckboxItem>
  );
}
