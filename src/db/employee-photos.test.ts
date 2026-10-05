import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  createEmployee,
  deleteEmployee,
  removeEmployeePhoto,
  saveEmployee,
  setEmployeePhoto,
} from './people';
import { setupCompany } from './records';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function employee() {
  const company = await setupCompany({ name: 'Gulf Shield Security' });
  return saveEmployee(createEmployee(company.id, { name: 'Test Guard One', number: '000101' }));
}

describe('employee photos', () => {
  it('are one of their files, replaced and removed with the photo', async () => {
    const e = await employee();
    const first = await setEmployeePhoto(e.id, { name: 'IMG_2041.PNG', dataUrl: JPEG });
    const photo = (await db.attachments.get(first.photoId!))!;
    expect(photo).toMatchObject({
      ownerId: e.id,
      companyId: e.companyId,
      name: 'IMG_2041.jpg',
      type: 'image/jpeg',
      dataUrl: JPEG,
    });

    // A new photo replaces the file of the old one.
    const second = await setEmployeePhoto(e.id, { name: 'portrait', dataUrl: JPEG });
    expect(second.photoId).not.toBe(first.photoId);
    expect(await db.attachments.get(first.photoId!)).toBeUndefined();
    expect((await db.attachments.get(second.photoId!))?.name).toBe('portrait.jpg');
    expect(await db.attachments.where('ownerId').equals(e.id).count()).toBe(1);

    await removeEmployeePhoto(e.id);
    expect((await db.employees.get(e.id))?.photoId).toBeNull();
    expect(await db.attachments.where('ownerId').equals(e.id).count()).toBe(0);
  });

  it('are kept when the employee is saved from a form opened before', async () => {
    const e = await employee();
    const stale = { ...e };
    const withPhoto = await setEmployeePhoto(e.id, { name: 'photo.jpg', dataUrl: JPEG });
    const saved = await saveEmployee({ ...stale, jobTitle: 'Security Guard' });
    expect(saved.photoId).toBe(withPhoto.photoId);
    expect((await db.employees.get(e.id))?.photoId).toBe(withPhoto.photoId);
  });

  it('go with the employee', async () => {
    const e = await employee();
    const withPhoto = await setEmployeePhoto(e.id, { name: 'photo.jpg', dataUrl: JPEG });
    await deleteEmployee(e.id);
    expect(await db.attachments.get(withPhoto.photoId!)).toBeUndefined();
  });
});
