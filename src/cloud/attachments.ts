import { db } from '@/db/db';
import { t } from '@/i18n';
import { cloudSnapshot } from './store';
import { fetchAttachmentContent } from './sync';

/**
 * The content of an attachment as a data URL. Files kept in the cloud that
 * this device has not downloaded yet (large ones) are downloaded now.
 */
export async function attachmentContent(id: string): Promise<{ dataUrl: string; type: string }> {
  const attachment = await db.attachments.get(id);
  if (!attachment) throw new Error(t('This file is not available.'));
  if (attachment.dataUrl) return { dataUrl: attachment.dataUrl, type: attachment.type };
  const { api, user } = cloudSnapshot();
  if (!api || !user) throw new Error(t('Sign in to open files kept in the cloud.'));
  const dataUrl = await fetchAttachmentContent(attachment, { api, userId: user.id });
  return { dataUrl, type: attachment.type };
}
