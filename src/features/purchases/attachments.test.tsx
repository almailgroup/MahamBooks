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

function renderList(props: {
  files: AttachedFile[];
  readOnly?: boolean;
  camera?: boolean;
  compact?: boolean;
}) {
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

  it('with a camera and no file yet, put Take photo first (a bill or a payment form)', () => {
    renderList({ files: [], camera: true });
    const photo = screen.getByRole('button', { name: 'Take photo' });
    expect(photo.className).toContain('bg-primary-solid');
    expect(photo.className).toContain('flex-1');
  });

  it('compact (the Record payment dialog), keep both buttons small and plain', () => {
    renderList({ files: [], camera: true, compact: true });
    for (const name of ['Take photo', 'Choose file']) {
      const button = screen.getByRole('button', { name });
      expect(button.className).not.toContain('bg-primary-solid');
      expect(button.className).toContain('h-8');
      expect(button.className).not.toContain('flex-1');
    }
  });

  it('read only and empty, say so', () => {
    renderList({ files: [], readOnly: true });
    expect(screen.getByText('No files attached.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
