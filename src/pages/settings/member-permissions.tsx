import { useState } from 'react';
import type { MemberAccess, TeamMember } from '@/cloud/api';
import {
  isApprover,
  lowerAccess,
  MAX_APPROVERS,
  ROLE_LABELS,
  type MemberPermissions,
} from '@/cloud/roles';
import { Button } from '@/components/ui/button';
import { Select, Switch } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { useLanguage } from '@/i18n/provider';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { ACCESS_ICONS, ACCESS_LABELS, ACCESS_TONES } from '@/suite/access-grid';
import { APPS, appTitle, roleAccess } from '@/suite/apps';
import type { AppAccess, AppId } from '@/suite/types';

/**
 * What the owner (the Super Admin) lets one member do, app by app, and
 * whether they may approve requests. Limits only take away from the role:
 * each app offers the role's own access and the levels below it. The server
 * applies the same limits to what the member saves.
 */

/** The levels the owner may give in an app, below the role's own access. */
export function limitChoices(app: AppId, access: AppAccess): AppAccess[] {
  const lower: AppAccess[] = [];
  if (access === 'manage' || access === 'edit') lower.push('view');
  // Books is never hidden: the other apps use its customers and items.
  if (access !== 'none' && app !== 'books') lower.push('none');
  return lower;
}

/** The limits as chosen, keeping only those below the role's own access. */
export function chosenPermissions(
  role: TeamMember['role'],
  chosen: Partial<Record<AppId, AppAccess>>,
): MemberPermissions {
  const apps: Partial<Record<AppId, AppAccess>> = {};
  for (const app of APPS) {
    const limit = chosen[app.id];
    if (limit && limitChoices(app.id, roleAccess(app.id, role)).includes(limit)) {
      apps[app.id] = limit;
    }
  }
  return Object.keys(apps).length ? { apps } : {};
}

const ROLE = 'role';

export function MemberPermissionsDialog({
  open,
  onOpenChange,
  member,
  access,
  otherApprovers,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: TeamMember;
  access: MemberAccess | undefined;
  /** Admins and accountants other than this member who approve. */
  otherApprovers: number;
  onSave: (permissions: MemberPermissions, canApprove: boolean) => Promise<boolean>;
}) {
  const { language } = useLanguage();
  const [chosen, setChosen] = useState<Partial<Record<AppId, AppAccess>>>(
    () => access?.permissions.apps ?? {},
  );
  const [approve, setApprove] = useState(() => isApprover(member.role, access?.canApprove));
  const [busy, setBusy] = useState(false);
  const name = member.fullName || member.email;
  const mayApprove = member.role === 'admin' || member.role === 'accountant';
  const full = otherApprovers >= MAX_APPROVERS && !isApprover(member.role, access?.canApprove);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('What {name} can do', { name })}
        description={t(
          'As {role}, with the limits you set here. Limits only take away from the role, and the cloud applies them to what they save.',
          { role: t(ROLE_LABELS[member.role]) },
        )}
        size="md"
      >
        <DialogBody>
          <ul className="divide-y divide-slate-100">
            {APPS.map((app) => {
              const base = roleAccess(app.id, member.role);
              const choices = limitChoices(app.id, base);
              const current = chosen[app.id];
              const value = current && choices.includes(current) ? current : ROLE;
              const shown = lowerAccess(base, value === ROLE ? undefined : current);
              const Icon = ACCESS_ICONS[shown];
              const title = appTitle(app, language);
              return (
                <li key={app.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="font-medium text-slate-900">{title}</p>
                    <p className={cn('flex items-center gap-1.5 text-xs', ACCESS_TONES[shown])}>
                      <Icon className="size-3.5 shrink-0" aria-hidden />
                      {t(ACCESS_LABELS[shown])}
                    </p>
                  </div>
                  {choices.length ? (
                    <Select
                      value={value}
                      onChange={(e) =>
                        setChosen((c) => ({
                          ...c,
                          [app.id]:
                            e.target.value === ROLE ? undefined : (e.target.value as AppAccess),
                        }))
                      }
                      aria-label={t('Access to {app}', { app: title })}
                      className="w-full sm:w-60"
                    >
                      <option value={ROLE}>
                        {t('As the role: {access}', { access: t(ACCESS_LABELS[base]) })}
                      </option>
                      {choices.map((level) => (
                        <option key={level} value={level}>
                          {t(ACCESS_LABELS[level])}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-sm text-slate-500">{t('As the role')}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-slate-500">
            {t(
              'Settings, files and activity follow the role. What is already on their device stays there.',
            )}
          </p>
          {mayApprove ? (
            <Switch
              checked={approve}
              onChange={setApprove}
              disabled={full && !approve}
              label={t('Can approve')}
              description={
                full && !approve
                  ? t('Two members already approve besides you. Turn one of them off first.')
                  : t(
                      'Decides approval requests besides you, and sees what they are about. Up to two members.',
                    )
              }
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const saved = await onSave(
                chosenPermissions(member.role, chosen),
                mayApprove && approve,
              );
              setBusy(false);
              if (saved) onOpenChange(false);
            }}
          >
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
