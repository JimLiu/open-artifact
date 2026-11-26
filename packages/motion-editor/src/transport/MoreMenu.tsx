import { Fragment, type ReactElement } from 'react';
import { Ellipsis } from 'lucide-react';
import { ToolButton } from '@open-artifact/editor-kit/react';
import { Menu, MenuSeparator } from '@open-artifact/ui';
import { moreGroups, useMoreItems } from './more.ts';
import * as words from './words.ts';

/** The toolbar's More menu: rows the page's parts add, in groups. Left out while there are none. */
export function MoreMenu(): ReactElement | null {
  const items = useMoreItems((s) => s.items);
  if (items.length === 0) return null;
  const groups = moreGroups(items);
  return (
    <Menu side="top" align="end" trigger={<ToolButton label={words.MORE} size="lg" icon={<Ellipsis />} data-video-more="" />}>
      {groups.map((rows, index) => (
        <Fragment key={rows[0]!.id}>
          {index > 0 ? <MenuSeparator /> : null}
          {rows.map((row) => (
            <Fragment key={row.id}>{row.render()}</Fragment>
          ))}
        </Fragment>
      ))}
    </Menu>
  );
}
