import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { MoreHorizontal, Pause, Pencil, Play, Plus, Repeat, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { FREQUENCY_LABEL, issueNow } from '@/db/recurring';
import type { Client, RecurringProfile } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { computeDocument } from '@/lib/document-calc';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import {
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
  useConfirm,
} from '@/components/ui/overlay';

const STATUS_TONE = { active: 'green', paused: 'amber', completed: 'slate' } as const;

export default function RecurringListPage() {
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const profiles = useLiveQuery(
    () => db.recurring.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );

  const rows = useMemo(() => {
    if (!profiles || !clients) return null;
    const byId = new Map<string, Client>(clients.map((c) => [c.id, c]));
    const order = { active: 0, paused: 1, completed: 2 };
    return profiles
      .map((p) => ({
        profile: p,
        client: byId.get(p.clientId) ?? null,
        total: computeDocument(
          { ...p.template, deposit: 0 },
          { taxExempt: byId.get(p.clientId)?.taxExempt },
        ).total,
      }))
      .sort(
        (a, b) =>
          order[a.profile.status] - order[b.profile.status] ||
          (a.profile.nextIssueDate ?? '').localeCompare(b.profile.nextIssueDate ?? ''),
      );
  }, [profiles, clients]);

  if (!rows) return <Spinner className="py-24" label="Loading…" />;

  const setStatus = async (p: RecurringProfile, status: RecurringProfile['status']) => {
    await db.recurring.put({ ...p, status, updatedAt: new Date().toISOString() });
    toast.success(status === 'paused' ? 'Paused' : 'Resumed');
  };

  const sendNow = async (p: RecurringProfile) => {
    const invoice = await issueNow(p.id);
    if (invoice) {
      toast.success(`Invoice ${invoice.number} created`);
      navigate(`/invoices/${invoice.id}`);
    }
  };

  const remove = async (p: RecurringProfile) => {
    const ok = await confirm({
      title: `Delete “${p.name || 'recurring invoice'}”?`,
      description: 'Invoices already created are kept.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await db.recurring.delete(p.id);
    toast.success('Deleted');
  };

  return (
    <div>
      <PageHeader
        title="Recurring invoices"
        description="Invoices created automatically on a schedule — retainers, subscriptions, monthly services."
        actions={
          <ButtonLink to="/recurring/new">
            <Plus /> New recurring invoice
          </ButtonLink>
        }
      />
      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Repeat />}
            title="No recurring invoices"
            description="Set up an invoice once and it will be created for you every week, month or year."
            action={
              <ButtonLink to="/recurring/new">
                <Plus /> New recurring invoice
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {rows.map(({ profile, client, total }) => (
              <li
                key={profile.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
              >
                <Link to={`/recurring/${profile.id}`} className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium text-slate-900">
                      {profile.name || client?.name || 'Recurring invoice'}
                    </span>
                    <Badge tone={STATUS_TONE[profile.status]}>
                      {profile.status[0].toUpperCase() + profile.status.slice(1)}
                    </Badge>
                  </span>
                  <span className="block text-sm text-slate-500">
                    {client?.name ?? 'No client'} · {FREQUENCY_LABEL[profile.frequency]}
                    {profile.remainingCycles !== null
                      ? ` · ${profile.remainingCycles} left`
                      : ''} · {profile.issuedCount} issued
                  </span>
                </Link>
                <div className="flex items-center gap-4 sm:justify-end">
                  <div className="text-end">
                    <span className="tabular block font-semibold text-slate-900">
                      {fmt.money(total, profile.template.currency)}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {profile.nextIssueDate
                        ? `Next: ${fmt.date(profile.nextIssueDate)}`
                        : 'Finished'}
                    </span>
                  </div>
                  <DropdownMenu>
                    <DropdownTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Actions">
                        <MoreHorizontal />
                      </Button>
                    </DropdownTrigger>
                    <DropdownContent>
                      <DropdownItem
                        icon={<Pencil />}
                        onSelect={() => navigate(`/recurring/${profile.id}`)}
                      >
                        Edit
                      </DropdownItem>
                      {profile.status !== 'completed' ? (
                        <DropdownItem icon={<Send />} onSelect={() => void sendNow(profile)}>
                          Create next invoice now
                        </DropdownItem>
                      ) : null}
                      {profile.status === 'active' ? (
                        <DropdownItem
                          icon={<Pause />}
                          onSelect={() => void setStatus(profile, 'paused')}
                        >
                          Pause
                        </DropdownItem>
                      ) : profile.status === 'paused' ? (
                        <DropdownItem
                          icon={<Play />}
                          onSelect={() => void setStatus(profile, 'active')}
                        >
                          Resume
                        </DropdownItem>
                      ) : null}
                      <DropdownSeparator />
                      <DropdownItem icon={<Trash2 />} danger onSelect={() => void remove(profile)}>
                        Delete
                      </DropdownItem>
                    </DropdownContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="mt-4 text-sm text-slate-500">
        Due invoices are created automatically whenever you open the app. Because everything runs in
        your browser, invoices for a period are created the next time you open it.
      </p>
    </div>
  );
}
