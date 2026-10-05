import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import type { Account, ID, PayRunStatus } from '@/db/types';
import type { PayWarning } from '@/lib/hr/payroll';
import { countryName } from '@/lib/geo';
import { today } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { useFormat } from '@/app/company';
import { Badge, PageHeader } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { localName } from '@/i18n/names';
import { msg, t } from '@/i18n';
import { DateField } from '@/components/ui/date-field';

/** Title and the Pay runs / Leave / Loans / Settings tabs of the payroll pages. */
export function PayrollHeader({
  description,
  actions,
}: {
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      'border-b-2 px-1 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors',
      isActive
        ? 'border-primary-600 text-primary-700'
        : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
    );
  return (
    <div className="mb-6">
      <PageHeader
        title={t('Payroll')}
        description={description ?? t('Monthly pay runs, PIFSS, payslips, leave and staff loans.')}
        actions={actions}
      />
      <nav
        className="-mt-2 flex gap-6 overflow-x-auto border-b border-slate-200"
        aria-label={t('Payroll sections')}
      >
        <NavLink to="/payroll" end className={tab}>
          {t('Pay runs')}
        </NavLink>
        <NavLink to="/payroll/leave" className={tab}>
          {t('Leave')}
        </NavLink>
        <NavLink to="/payroll/loans" className={tab}>
          {t('Loans')}
        </NavLink>
        <NavLink to="/payroll/settings" className={tab}>
          {t('Settings')}
        </NavLink>
      </nav>
    </div>
  );
}

export const RUN_STATUS: Record<PayRunStatus, { label: string; tone: 'gray' | 'blue' | 'green' }> =
  {
    draft: { label: msg('Draft'), tone: 'gray' },
    approved: { label: msg('Approved'), tone: 'blue' },
    paid: { label: msg('Paid'), tone: 'green' },
  };

export function RunStatusBadge({ status }: { status: PayRunStatus }) {
  return <Badge tone={RUN_STATUS[status].tone}>{t(RUN_STATUS[status].label)}</Badge>;
}

/** "Verify" next to a legal figure that changes and should be checked before relying on it. */
export function VerifyBadge() {
  return (
    <span title={t('Check the current figure with the authority before relying on it.')}>
      <Badge tone="amber">{t('Verify')}</Badge>
    </span>
  );
}

/** A pay line warning in words. */
export function useWarningText(): (warning: PayWarning) => string {
  const fmt = useFormat();
  return (w) => {
    switch (w.code) {
      case 'negative_net':
        return t('Net pay is below zero. Lower the deductions.');
      case 'loan_cap':
        return t('Loan recovery is over 10% of the wage ({limit}), the most the law allows.', {
          limit: fmt.money(w.limit),
        });
      case 'deduction_cap':
        return t('Deductions are over 25% of the wage ({limit}), the most the law allows.', {
          limit: fmt.money(w.limit),
        });
      case 'minimum_wage':
        return t('Net pay is below the minimum wage ({minimum}).', {
          minimum: fmt.money(w.minimum),
        });
      case 'permit_salary':
        return t('Basic salary is below the salary on the work permit ({permit}).', {
          permit: fmt.money(w.permit),
        });
      case 'iban':
        return t('No valid IBAN or salary card number: the salary can’t go in the bank file.');
      case 'gcc_rates':
        return t(
          'No contribution rates for nationals of {country}. Add them in the payroll settings.',
          {
            country: countryName(w.country, fmt.locale),
          },
        );
      case 'pifss_rates':
        return t('No PIFSS rates are set. Add them in the payroll settings.');
      case 'no_salary':
        return t('No salary on record.');
    }
  };
}

export function WarningList({ warnings }: { warnings: PayWarning[] }) {
  const text = useWarningText();
  if (warnings.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {warnings.map((w, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
          <span>{text(w)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Bank and cash accounts money can be paid from, by code. */
export function moneyAccounts(accounts: Account[], keep?: ID | null): Account[] {
  return accounts
    .filter((a) => a.type === 'asset_cash' && (!a.archived || a.id === keep))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

/** Asks for the date and the bank account of a payment. */
export function PayDialog({
  title,
  description,
  amount,
  defaultDate,
  defaultAccountId,
  accounts,
  confirmLabel,
  onPay,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  amount: number;
  defaultDate?: string;
  defaultAccountId: ID | null;
  accounts: Account[];
  confirmLabel?: string;
  onPay: (input: { date: string; bankAccountId: ID | null }) => Promise<void>;
  onClose: () => void;
}) {
  const fmt = useFormat();
  const banks = moneyAccounts(accounts);
  const main = accounts.find((a) => a.role === 'bank');
  const [date, setDate] = useState(defaultDate ?? today());
  const [accountId, setAccountId] = useState<ID>(
    defaultAccountId ?? main?.id ?? banks[0]?.id ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pay = async () => {
    setBusy(true);
    setError('');
    try {
      await onPay({ date, bankAccountId: accountId || null });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not record the payment.'));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={title} description={description} size="sm">
        <DialogBody>
          <div className="rounded-lg bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-500">{t('Amount')}</p>
            <p className="tabular text-xl font-semibold text-slate-900">{fmt.money(amount)}</p>
          </div>
          <Field label={t('Payment date')}>
            {(id) => <DateField id={id} value={date} onChange={(iso) => iso && setDate(iso)} />}
          </Field>
          <Field label={t('Paid from')}>
            {(id) => (
              <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {banks.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {localName(a)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void pay()} loading={busy}>
            {confirmLabel ?? t('Record payment')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A label and an amount on one line, for breakdowns. */
export function AmountRow({
  label,
  value,
  strong,
  muted,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 py-1.5 text-sm',
        strong && 'font-semibold text-slate-900',
        muted && 'text-slate-500',
      )}
    >
      <dt className={cn('min-w-0', !strong && !muted && 'text-slate-600')}>{label}</dt>
      <dd className="tabular shrink-0 text-end">{value}</dd>
    </div>
  );
}
