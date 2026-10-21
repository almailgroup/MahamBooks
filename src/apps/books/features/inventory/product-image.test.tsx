import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { db } from '@/db/db';
import { createProduct } from '@/db/defaults';
import { saveItem } from '@/db/inventory';
import { addProductImages } from '@/db/product-images';
import { setupCompany } from '@/db/records';
import { ItemPicture } from './product-image';

/** Made-up data only. */

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL';

/** Rows that never come on screen. */
class NeverSeen {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function pictured(name: string): Promise<string> {
  const company = await setupCompany({ name: 'Sample Lighting' });
  const item = await saveItem(createProduct(company.id, { name }));
  return (await addProductImages(item.id, [{ name: 'front', dataUrl: JPEG }])).imageIds![0];
}

describe('item pictures in lists', () => {
  it('read no file for rows that are not on screen', async () => {
    const imageId = await pictured('Desk lamp');
    vi.stubGlobal('IntersectionObserver', NeverSeen);
    const reads = vi.spyOn(db.attachments, 'get');
    const { container } = render(<ItemPicture imageId={imageId} />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(reads).not.toHaveBeenCalled();
    expect(container.querySelector('img')).toBeNull();
  });

  it('read a picture once, then show its copy without reading it again', async () => {
    const imageId = await pictured('Floor lamp');
    // jsdom has no IntersectionObserver: every row counts as on screen.
    const reads = vi.spyOn(db.attachments, 'get');
    const first = render(<ItemPicture imageId={imageId} />);
    await waitFor(() => expect(first.container.querySelector('img')).not.toBeNull());
    const read = reads.mock.calls.length;
    expect(read).toBe(1);
    first.unmount();

    // Another list (a search, the line picker) shows it straight away.
    const again = render(<ItemPicture imageId={imageId} size="xs" />);
    expect(again.container.querySelector('img')).not.toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(reads.mock.calls.length).toBe(read);
  });

  it('show a box for an item without a picture', () => {
    const { container } = render(<ItemPicture imageId={undefined} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
