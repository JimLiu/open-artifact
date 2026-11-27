/** Asks a doc of several tabs whether an export takes the open tab or all of them. */
import { Button, Dialog } from '@open-artifact/ui';
import { type ReactNode } from 'react';
import { answerExportScope } from './export-scope.ts';
import { useTopBar } from './store.ts';
import { EXPORT_ALL_TABS, EXPORT_THIS_TAB, SCOPE_QUESTION, SCOPE_TITLE } from './words.ts';

export function ExportScopeDialog(): ReactNode {
  const asking = useTopBar(state => state.askingScope);
  return (
    <Dialog
      open={asking !== null}
      onOpenChange={open => {
        if (!open) answerExportScope(null);
      }}
      title={SCOPE_TITLE}
      description={SCOPE_QUESTION}
      footer={
        <>
          <Button onClick={() => answerExportScope('tab')}>{EXPORT_THIS_TAB}</Button>
          <Button variant="primary" onClick={() => answerExportScope('doc')}>
            {EXPORT_ALL_TABS}
          </Button>
        </>
      }
    />
  );
}
