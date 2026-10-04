import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  Check,
  Copy,
  Crown,
  DoorOpen,
  Link2,
  Mail,
  MessageCircle,
  Trash2,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { deleteCompany } from '@/db/records';
import { useCompany, useFormat } from '@/app/company';
import { t } from '@/i18n';
import { tr } from '@/i18n/provider';
import { localName } from '@/i18n/names';
import { isValidEmail } from '@/lib/email';
import { Button, buttonClass } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, EmptyState, Spinner } from '@/components/ui/misc';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  useConfirm,
} from '@/components/ui/overlay';
import { ReadOnlyContext } from '@/components/ui/read-only';
import { cloudErrorMessage, type Invite, type TeamMember } from '@/cloud/api';
import { useCloud } from '@/cloud/store';
import { useCloudLink } from '@/cloud/hooks';
import { emailInvite, inviteUrl, whatsappInvite } from '@/cloud/invite';
import {
  canManageTeam,
  INVITE_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type MemberRole,
} from '@/cloud/roles';
import { deleteFromCloud, isDemoCompany, startUpload } from '@/cloud/sync';
import { Avatar } from '@/features/cloud/account-menu';
import { FormError } from '@/features/cloud/auth-shell';
import { SettingsSection } from './shared';

const NOT_READ_ONLY = { readOnly: false, reason: '' };

/** The people of the current company, their roles and invitations. */
export default function TeamSettings() {
  const company = useCompany();
  const { user, api } = useCloud();
  const link = useCloudLink(company.id);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  if (link === undefined) return <Spinner className="py-24" label={t('Loading…')} />;

  if (!link || link.status === 'removed' || !user || link.userId !== user.id) {
    const demo = isDemoCompany(company);
    return (
      <SettingsSection title={t('Team')}>
        <EmptyState
          className="py-8"
          icon={<UsersRound />}
          title={t('Work on {company} together', { company: localName(company) })}
          description={
            demo
              ? t(
                  'The demo company stays on this device. Set up your own company to invite your team.',
                )
              : t(
                  'Keep this company in the cloud to invite your accountant and staff, each with their own access.',
                )
          }
          action={
            demo ? null : user && api ? (
              <Button
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await startUpload(company.id, { api, userId: user.id });
                    toast.success(t('{name} is going to the cloud.', { name: localName(company) }));
                  } catch (err) {
                    toast.error(cloudErrorMessage(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('Keep in the cloud')}
              </Button>
            ) : (
              <Button onClick={() => navigate('/signin?next=/settings/team')}>
                {t('Sign in')}
              </Button>
            )
          }
        />
      </SettingsSection>
    );
  }

  return (
    <ReadOnlyContext.Provider value={NOT_READ_ONLY}>
      <Team companyId={company.id} role={link.role} />
    </ReadOnlyContext.Provider>
  );
}

function Team({ companyId, role }: { companyId: string; role: MemberRole }) {
  const company = useCompany();
  const fmt = useFormat();
  const { user, api } = useCloud();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Invite | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const manage = canManageTeam(role);
  const name = localName(company);

  const [version, setVersion] = useState(0);
  const [now] = useState(() => Date.now());
  const load = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    Promise.all([
      api.companyTeam(companyId),
      manage ? api.listInvites(companyId) : Promise.resolve([]),
    ])
      .then(([team, pending]) => {
        if (cancelled) return;
        setMembers(team);
        setInvites(pending);
        setError('');
      })
      .catch((err) => {
        if (cancelled) return;
        setMembers((m) => m ?? []);
        setError(cloudErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [api, companyId, manage, version]);

  if (!api || !user) return null;

  const act = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      toast.success(done);
      load();
    } catch (err) {
      toast.error(cloudErrorMessage(err));
    }
  };

  const linkFor = (invite: Invite) =>
    inviteUrl(invite.token, {
      company: name,
      by: user.fullName || user.email,
      email: invite.email,
      role: invite.role,
    });

  const leave = async () => {
    const ok = await confirm({
      title: t('Leave {company}?', { company: name }),
      description: t(
        'You will no longer see this company. Its copy is removed from this device; it stays in the cloud for the team.',
      ),
      confirmLabel: t('Leave company'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.removeMember(companyId, user.id);
      await deleteCompany(companyId);
      toast.success(t('You left {company}.', { company: name }));
      navigate('/');
    } catch (err) {
      toast.error(cloudErrorMessage(err));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('Delete {company} for everyone?', { company: name }),
      description: t(
        'The company, all its records and files are deleted from the cloud at once, for every member, and from this device. Download a backup first if you may need them. This cannot be undone.',
      ),
      confirmLabel: t('Delete company'),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteFromCloud(companyId, { api, userId: user.id });
      toast.success(t('{name} deleted', { name }));
      navigate('/');
    } catch (err) {
      toast.error(cloudErrorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('Team')}
        description={t('Everyone here works on {company} from their own device.', {
          company: name,
        })}
      >
        <FormError>{error}</FormError>
        {members === null ? (
          <Spinner className="py-6" label={t('Loading…')} />
        ) : (
          <ul className="-my-3 divide-y divide-slate-100">
            {members.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                me={member.userId === user.id}
                canEdit={manage && member.role !== 'owner' && member.userId !== user.id}
                onRole={(next) =>
                  void act(
                    () => api.setMemberRole(companyId, member.userId, next),
                    t('Role changed'),
                  )
                }
                onRemove={async () => {
                  const ok = await confirm({
                    title: t('Remove {name}?', { name: member.fullName || member.email }),
                    description: t(
                      'They lose access to {company} at once. What they recorded stays.',
                      { company: name },
                    ),
                    confirmLabel: t('Remove'),
                    danger: true,
                  });
                  if (ok) {
                    await act(
                      () => api.removeMember(companyId, member.userId),
                      t('{name} was removed', { name: member.fullName || member.email }),
                    );
                  }
                }}
              />
            ))}
          </ul>
        )}
      </SettingsSection>

      {manage ? (
        <InviteForm
          companyId={companyId}
          onCreated={(invite) => {
            setCreated(invite);
            load();
          }}
        />
      ) : null}

      {created ? (
        <InviteLink
          url={linkFor(created)}
          invite={created}
          company={name}
          onDone={() => setCreated(null)}
        />
      ) : null}

      {manage && invites.length > 0 ? (
        <SettingsSection
          title={t('Pending invitations')}
          description={t(
            'Links work once, for 7 days, and only for the address they were made for.',
          )}
        >
          <ul className="-my-3 divide-y divide-slate-100">
            {invites.map((invite) => {
              const expired = Date.parse(invite.expiresAt) < now;
              return (
                <li key={invite.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
                    <Mail className="size-5 shrink-0 text-slate-400" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p dir="ltr" className="truncate font-medium text-slate-900 rtl:text-end">
                        {invite.email}
                      </p>
                      <p className="text-xs text-slate-500">
                        {t(ROLE_LABELS[invite.role])} ·{' '}
                        {expired
                          ? t('Expired')
                          : t('Until {date}', { date: fmt.date(invite.expiresAt.slice(0, 10)) })}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 ps-8 sm:ps-0">
                    {expired ? null : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void copy(linkFor(invite))}
                      >
                        <Copy /> {t('Copy link')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void act(() => api.revokeInvite(invite.id), t('Invitation cancelled'))
                      }
                    >
                      {t('Cancel invitation')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </SettingsSection>
      ) : null}

      <SettingsSection title={t('Leave or delete')}>
        {role === 'owner' ? (
          <div className="space-y-4">
            <Row
              title={t('Transfer ownership')}
              description={t('Make another member the owner. You become an admin.')}
              action={
                <Button
                  variant="outline"
                  onClick={() => setTransferOpen(true)}
                  disabled={!members || members.length < 2}
                >
                  <Crown /> {t('Transfer ownership')}
                </Button>
              }
            />
            <Row
              title={t('Delete company')}
              description={t(
                'Deletes the company and everything in it from the cloud, for everyone.',
              )}
              action={
                <Button variant="danger" onClick={() => void remove()}>
                  <Trash2 /> {t('Delete company')}
                </Button>
              }
            />
          </div>
        ) : (
          <Row
            title={t('Leave company')}
            description={t('You stop seeing this company. It stays with the team.')}
            action={
              <Button variant="outline" onClick={() => void leave()}>
                <DoorOpen /> {t('Leave company')}
              </Button>
            }
          />
        )}
      </SettingsSection>

      {members ? (
        <TransferDialog
          open={transferOpen}
          onOpenChange={setTransferOpen}
          members={members.filter((m) => m.userId !== user.id)}
          onTransfer={(member) =>
            act(
              () => api.transferOwnership(companyId, member.userId),
              t('{name} is now the owner', { name: member.fullName || member.email }),
            )
          }
        />
      ) : null}
    </div>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t('Link copied'));
  } catch {
    toast.error(t('Could not copy. Select the link and copy it.'));
  }
}

function Row({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1 basis-64">
        <p className="font-medium text-slate-900">{title}</p>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      {action}
    </div>
  );
}

function MemberRow({
  member,
  me,
  canEdit,
  onRole,
  onRemove,
}: {
  member: TeamMember;
  me: boolean;
  canEdit: boolean;
  onRole: (role: MemberRole) => void;
  onRemove: () => void;
}) {
  const label = member.fullName || member.email;
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <Avatar name={member.fullName} email={member.email} />
      <div className="min-w-0 flex-1 basis-40">
        <p className="flex min-w-0 items-center gap-2 font-medium text-slate-900">
          <span dir="auto" className="truncate">
            {label}
          </span>
          {me ? <Badge tone="blue">{t('You')}</Badge> : null}
        </p>
        <p dir="ltr" className="truncate text-xs text-slate-500 rtl:text-end">
          {member.email}
        </p>
      </div>
      {canEdit ? (
        <div className="flex items-center gap-2">
          <Select
            value={member.role}
            onChange={(e) => onRole(e.target.value as MemberRole)}
            aria-label={t('Role of {name}', { name: label })}
            className="w-36"
          >
            {INVITE_ROLES.map((role) => (
              <option key={role} value={role}>
                {t(ROLE_LABELS[role])}
              </option>
            ))}
          </Select>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('Remove {name}', { name: label })}
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        </div>
      ) : (
        <Badge tone={member.role === 'owner' ? 'violet' : 'gray'}>
          {t(ROLE_LABELS[member.role])}
        </Badge>
      )}
    </li>
  );
}

function InviteForm({
  companyId,
  onCreated,
}: {
  companyId: string;
  onCreated: (invite: Invite) => void;
}) {
  const { api } = useCloud();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<MemberRole, 'owner'>>('accountant');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isValidEmail(email)) return setError(t('Check the email address.'));
    if (!api) return;
    setBusy(true);
    try {
      const invite = await api.createInvite(companyId, email.trim(), role);
      setEmail('');
      onCreated(invite);
    } catch (err) {
      setError(cloudErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection
      title={t('Invite someone')}
      description={t(
        'You get a link to send them by WhatsApp or email. They sign in with this address to join.',
      )}
    >
      <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <Field label={t('Email')}>
            {(id) => (
              <Input
                id={id}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                inputMode="email"
                autoComplete="off"
                dir="ltr"
                className="rtl:text-end"
                placeholder="name@example.com"
              />
            )}
          </Field>
          <Field label={t('Role')}>
            {(id) => (
              <Select
                id={id}
                value={role}
                onChange={(e) => setRole(e.target.value as Exclude<MemberRole, 'owner'>)}
              >
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(ROLE_LABELS[r])}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <p className="text-sm text-slate-500">{t(ROLE_DESCRIPTIONS[role])}</p>
        <FormError>{error}</FormError>
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>
            <UserPlus /> {t('Create invitation link')}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

function InviteLink({
  url,
  invite,
  company,
  onDone,
}: {
  url: string;
  invite: Invite;
  company: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = t('Join {company} on AlmailBooks as {role}:', {
    company,
    role: t(ROLE_LABELS[invite.role]),
  });
  // On a phone the new link appears below the fold: bring it into view.
  useEffect(() => {
    const card = document.getElementById('invitation-link');
    if (!card || card.getBoundingClientRect().bottom <= window.innerHeight - 96) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
  }, [url]);
  return (
    <SettingsSection
      id="invitation-link"
      title={t('Invitation link ready')}
      description={tr('Send it to {email}. It works once, for 7 days.', {
        email: (
          <strong dir="ltr" className="font-medium text-slate-900">
            {invite.email}
          </strong>
        ),
      })}
    >
      <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200">
        <Link2 className="ms-1 size-4 shrink-0 text-slate-400" aria-hidden />
        <input
          readOnly
          value={url}
          dir="ltr"
          aria-label={t('Invitation link')}
          onFocus={(e) => e.target.select()}
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none"
        />
      </div>
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <Button
          onClick={async () => {
            await copy(url);
            setCopied(true);
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? t('Copied') : t('Copy link')}
        </Button>
        <a
          href={whatsappInvite(url, text)}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass('outline')}
        >
          <MessageCircle /> {t('Send by WhatsApp')}
        </a>
        <a
          href={emailInvite(invite.email, t('Invitation to {company}', { company }), text, url)}
          className={buttonClass('outline')}
        >
          <Mail /> {t('Send by email')}
        </a>
        <Button variant="ghost" className="sm:ms-auto" onClick={onDone}>
          {t('Done')}
        </Button>
      </div>
    </SettingsSection>
  );
}

function TransferDialog({
  open,
  onOpenChange,
  members,
  onTransfer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: TeamMember[];
  onTransfer: (member: TeamMember) => Promise<void>;
}) {
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const member = members.find((m) => m.userId === chosen);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('Transfer ownership')}
        description={t(
          'The new owner can delete the company and manage everyone. You become an admin.',
        )}
        size="sm"
      >
        <DialogBody>
          <Field label={t('New owner')}>
            {(id) => (
              <Select id={id} value={chosen} onChange={(e) => setChosen(e.target.value)}>
                <option value="">{t('Select…')}</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.fullName ? `${m.fullName} (${m.email})` : m.email}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            disabled={!member}
            loading={busy}
            onClick={async () => {
              if (!member) return;
              setBusy(true);
              await onTransfer(member);
              setBusy(false);
              onOpenChange(false);
            }}
          >
            {t('Transfer ownership')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
