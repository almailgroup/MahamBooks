import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReadOnlyContext } from '@/components/ui/read-only';
import { AttachmentList } from '@/features/purchases/attachments';
import { FileList } from './file-list';

/**
 * Files in an app that is view only (a viewer, or an app the owner made view
 * only, such as the personnel file with People view only): they open, and
 * nothing is added or removed. Made-up data only.
 */

afterEach(cleanup);

const files = [{ id: 'att-1', name: 'civil-id.pdf', type: 'application/pdf', dataUrl: 'data:,x' }];

function inApp(readOnly: boolean, children: ReactNode) {
  return (
    <ReadOnlyContext.Provider value={{ readOnly, reason: readOnly ? 'View only in this app' : '' }}>
      {children}
    </ReadOnlyContext.Provider>
  );
}

describe('files of a record', () => {
  it.each([false, true])('are added and removed only where saving is on (view only: %s)', (ro) => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(
      inApp(
        ro,
        <>
          <FileList files={files} onAdd={onAdd} onRemove={onRemove} />
          <AttachmentList files={files} onAdd={onAdd} onRemove={onRemove} />
        </>,
      ),
    );
    expect(screen.getAllByTitle('Open civil-id.pdf')).toHaveLength(2);
    expect(screen.queryAllByRole('button', { name: 'Remove civil-id.pdf' })).toHaveLength(
      ro ? 0 : 2,
    );
    expect(screen.queryAllByRole('button', { name: /Attach file/ })).toHaveLength(ro ? 0 : 2);
  });
});
