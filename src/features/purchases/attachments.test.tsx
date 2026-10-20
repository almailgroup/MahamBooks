import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AttachmentList, type AttachedFile } from './attachments';

/** Made-up data only. */

afterEach(cleanup);

const scan: AttachedFile = {
  id: 'att-1',
  name: 'cheque-scan.jpg',
  type: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,AAAA',
};

function renderList(props: { files: AttachedFile[]; readOnly?: boolean }) {
  render(
    <AttachmentList
      {...props}
      onAdd={() => undefined}
      onRemove={() => undefined}
      emptyText="No files attached."
    />,
  );
}

describe('attachment lists', () => {
  it('add and remove files', () => {
    renderList({ files: [scan] });
    expect(screen.getByText('cheque-scan.jpg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove cheque-scan.jpg' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Attach file' })).toBeTruthy();
    expect(screen.getByLabelText('Attach a file')).toBeTruthy();
  });

  it('read only, open the files and change nothing', () => {
    renderList({ files: [scan], readOnly: true });
    expect(screen.getByRole('button', { name: /cheque-scan\.jpg/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove cheque-scan.jpg' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Attach file' })).toBeNull();
    expect(screen.queryByLabelText('Attach a file')).toBeNull();
  });

  it('read only and empty, say so', () => {
    renderList({ files: [], readOnly: true });
    expect(screen.getByText('No files attached.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
