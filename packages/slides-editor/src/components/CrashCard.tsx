import { localize } from '@open-artifact/runtime';
import type { ReactNode } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { Button, EmptyState } from '@open-artifact/ui';

/**
 * Shown when the editor failed to draw: changes are saved as they are made,
 * so a reload loses nothing. `viewing`: the read-only view, with nothing to save.
 */
export function CrashCard({ viewing = false }: { viewing?: boolean }): ReactNode {
  return (
    <div data-testid="slides-crashed" className="h-full bg-canvas">
      <EmptyState icon={<TriangleAlert className="size-6" />} title={localize('Something went wrong showing this presentation', '显示此演示文稿时出错')}>
        <p role="alert">{viewing ? localize('Reload to try again.', '请重新加载后重试。') : localize('Your changes are saved as you make them. Reload to try again.', '你的更改会自动保存。请重新加载后重试。')}</p>
        <Button className="mt-2" variant="secondary" icon={<RotateCw className="size-4" />} onClick={() => window.location.reload()}>
          {localize('Reload', '重新加载')}
        </Button>
      </EmptyState>
    </div>
  );
}
