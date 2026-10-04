import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { t, tp } from '@/i18n';
import { useCloud, signOutCloud } from '@/cloud/store';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { cn } from '@/lib/cn';

/**
 * Signing out on this device. The account's companies can stay here (they
 * sync again at the next sign-in) or be removed, on a shared computer; they
 * stay in the cloud either way. Changes not sent yet are pointed out.
 */
export function SignOutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useCloud();
  const navigate = useNavigate();
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const info = useLiveQuery(async () => {
    if (!user) return { companies: 0, pending: 0 };
    const links = await db.syncState.filter((l) => l.userId === user.id).toArray();
    const ids = links.map((l) => l.companyId);
    const pending = ids.length ? await db.outbox.where('companyId').anyOf(ids).count() : 0;
    return { companies: links.length, pending };
  }, [user?.id]);

  const signOut = async () => {
    setBusy(true);
    try {
      await signOutCloud({ removeCompanies: remove });
      onOpenChange(false);
      toast.success(t('Signed out'));
      navigate('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not sign out.'));
    } finally {
      setBusy(false);
    }
  };

  const option = (value: boolean, title: string, description: string) => (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
        remove === value
          ? 'border-primary-500 bg-primary-50/60'
          : 'border-slate-200 hover:bg-slate-50',
      )}
    >
      <input
        type="radio"
        name="sign-out-companies"
        className="accent-primary-600 mt-0.5 size-4 shrink-0"
        checked={remove === value}
        onChange={() => setRemove(value)}
      />
      <span className="text-sm">
        <span className="block font-medium text-slate-900">{title}</span>
        <span className="block text-slate-500">{description}</span>
      </span>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('Sign out?')} size="sm">
        <DialogBody>
          {info && info.companies > 0 ? (
            <div className="space-y-2">
              {option(
                false,
                t('Keep my companies on this device'),
                t('They sync again the next time you sign in here.'),
              )}
              {option(
                true,
                t('Remove them from this device'),
                t('For a shared computer. They stay safe in the cloud.'),
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-600">{t('You can sign in again at any time.')}</p>
          )}
          {info && info.pending > 0 ? (
            <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-600/20">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {remove
                  ? tp(
                      info.pending,
                      '{count} change has not reached the cloud yet and would be lost. Sync first or keep the companies here.',
                      '{count} changes have not reached the cloud yet and would be lost. Sync first or keep the companies here.',
                    )
                  : tp(
                      info.pending,
                      '{count} change has not reached the cloud yet. It is sent the next time you sign in here.',
                      '{count} changes have not reached the cloud yet. They are sent the next time you sign in here.',
                    )}
              </span>
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button
            variant={remove ? 'danger' : 'primary'}
            onClick={() => void signOut()}
            loading={busy}
            disabled={remove && (info?.pending ?? 0) > 0}
          >
            {t('Sign out')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
