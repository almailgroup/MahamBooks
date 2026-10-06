import { db } from '@/db/db';
import type { Attachment } from '@/db/types';
import { t } from '@/i18n';
import { cloudError, type CloudApi } from './api';
import { blobToDataUrl, contentHash } from './files';
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

/**
 * The content of a file kept in the cloud, downloaded for a backup and not
 * kept on this device. Content that is not the file's own (another hash: it
 * changed in the cloud since this device last synced) is refused, so that a
 * backup's record and content agree.
 */
export async function downloadForBackup(
  file: Pick<Attachment, 'storagePath' | 'contentHash' | 'type'>,
  api: CloudApi | null = cloudSnapshot().user ? cloudSnapshot().api : null,
): Promise<string> {
  if (!api) throw new Error(t('Sign in to open files kept in the cloud.'));
  if (!file.storagePath) throw new Error(t('This file is not available.'));
  let blob: Blob;
  try {
    blob = await api.downloadFile(file.storagePath);
  } catch (error) {
    throw cloudError(error);
  }
  if (file.contentHash && (await contentHash(blob)) !== file.contentHash) {
    throw new Error(t('This file is not available.'));
  }
  return blobToDataUrl(blob, file.type || blob.type);
}
