import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Ban,
  CheckCircle2,
  ExternalLink,
  Landmark,
  MoreHorizontal,
  Printer,
  Repeat,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  cancelCheque,
  clearCheque,
  depositCheque,
  replaceCheque,
  RETURN_REASONS,
  returnCheque,
} from '@/db/cheques';
import { newCheque } from '@/db/payments';
import type { ChequeDetails, Payment } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { today } from '@/lib/dates';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/overlay';
import { useAccounts } from '@/features/accounting/account-pickers';
import { BankAccountSelect, ChequeFields } from '@/features/payments/fields';
import { PAYMENT_COPY, paymentDirection } from '@/features/payments/direction';
import { DateField } from '@/components/ui/date-field';

export type ChequeAction = 'deposit' | 'clear' | 'return' | 'cancel' | 'replace';

type ChequePayment = Payment & { cheque: ChequeDetails };

/** What can be done with a cheque in its current state. */
export function chequeActions(payment: ChequePayment): ChequeAction[] {
  const { status, replacedById } = payment.cheque;
  const out = payment.direction === 'out';
  switch (status) {
    case 'held':
      return out
        ? ['clear', 'return', 'replace', 'cancel']
        : ['deposit', 'clear', 'return', 'replace', 'cancel'];
    case 'deposited':
      return ['clear', 'return', 'replace', 'cancel'];
    case 'cleared':
      return ['return'];
    case 'returned':
    case 'cancelled':
      return replacedById ? [] : ['replace'];
  }
}

function actionLabel(action: ChequeAction): string {
  switch (action) {
    case 'deposit':
      return t('Deposit at bank');
    case 'clear':
      return t('Mark cleared');
    case 'return':
      return t('Mark returned');
    case 'replace':
      return t('Replace');
    case 'cancel':
      return t('Cancel cheque');
  }
}

const ACTION_ICONS: Record<ChequeAction, React.ReactNode> = {
  deposit: <Landmark />,
  clear: <CheckCircle2 />,
  return: <Undo2 />,
  replace: <Repeat />,
  cancel: <Ban />,
};

/** A menu with the cheque's actions, plus links to its payment and voucher. */
export function ChequeActionsMenu({
  payment,
  onAction,
  showPaymentLink = true,
  label,
}: {
  payment: ChequePayment;
  onAction: (action: ChequeAction) => void;
  showPaymentLink?: boolean;
  /** Visible button text; an icon button when left out. */
  label?: string;
}) {
  const navigate = useNavigate();
  const base = PAYMENT_COPY[paymentDirection(payment)].base;
  const actions = chequeActions(payment);
  return (
    <DropdownMenu>
      <DropdownTrigger asChild>
        {label ? (
          <Button variant="outline">
            {label} <MoreHorizontal />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('Actions for cheque {number}', { number: payment.cheque.number })}
          >
            <MoreHorizontal />
          </Button>
        )}
      </DropdownTrigger>
      <DropdownContent>
        {actions.map((action) => (
          <DropdownItem
            key={action}
            icon={ACTION_ICONS[action]}
            danger={action === 'return' || action === 'cancel'}
            onSelect={() => onAction(action)}
          >
            {actionLabel(action)}
          </DropdownItem>
        ))}
        {actions.length && showPaymentLink ? <DropdownSeparator /> : null}
        {showPaymentLink ? (
          <DropdownItem icon={<ExternalLink />} onSelect={() => navigate(`${base}/${payment.id}`)}>
            {t('Open payment {number}', { number: payment.number })}
          </DropdownItem>
        ) : null}
        {showPaymentLink ? (
          <DropdownItem
            icon={<Printer />}
            onSelect={() => navigate(`${base}/${payment.id}/voucher`)}
          >
            {t('Print voucher')}
          </DropdownItem>
        ) : null}
      </DropdownContent>
    </DropdownMenu>
  );
}

/** The dialog for one cheque action; renders nothing when `action` is null. */
export function ChequeActionDialog({
  action,
  payment,
  onClose,
  onReplaced,
}: {
  action: ChequeAction | null;
  payment: ChequePayment;
  onClose: () => void;
  onReplaced?: (replacement: Payment) => void;
}) {
  if (!action) return null;
  const props = { payment, onClose };
  switch (action) {
    case 'deposit':
      return <DepositDialog {...props} />;
    case 'clear':
      return <ClearDialog {...props} />;
    case 'return':
      return <ReturnDialog {...props} />;
    case 'cancel':
      return <CancelDialog {...props} />;
    case 'replace':
      return <ReplaceDialog {...props} onReplaced={onReplaced} />;
  }
}

function useRunner(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function DialogShell({
  title,
  description,
  children,
  onClose,
  confirm,
  busy,
  danger,
  size,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  confirm: { label: string; onClick: () => void };
  busy: boolean;
  danger?: boolean;
  size?: 'md' | 'lg';
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={title} description={description} size={size}>
        <DialogBody>{children}</DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Close')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={confirm.onClick} loading={busy}>
            {confirm.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function chequeTitle(payment: ChequePayment, fmt: ReturnType<typeof useFormat>) {
  return t('Cheque {number} · {amount}', {
    number: payment.cheque.number,
    amount: fmt.money(payment.amount, payment.currency),
  });
}

function DepositDialog({ payment, onClose }: { payment: ChequePayment; onClose: () => void }) {
  const fmt = useFormat();
  const accounts = useAccounts();
  const [date, setDate] = useState(today() < payment.date ? payment.date : today());
  const [accountId, setAccountId] = useState<string | null>(payment.cheque.bankAccountId ?? null);
  const { busy, run } = useRunner(onClose);
  const early = date < payment.cheque.date;
  return (
    <DialogShell
      title={t('Deposit cheque')}
      description={chequeTitle(payment, fmt)}
      onClose={onClose}
      busy={busy}
      confirm={{
        label: t('Deposit at bank'),
        onClick: () =>
          void run(
            () => depositCheque(payment.id, { date, bankAccountId: accountId }),
            t('Cheque {number} deposited', { number: payment.cheque.number }),
          ),
      }}
    >
      <Field
        label={t('Deposit date')}
        hint={
          early
            ? t(
                'The cheque is dated {date}. It can be presented early, but agree this with the drawer first.',
                { date: fmt.date(payment.cheque.date) },
              )
            : t('Nothing is posted until the cheque clears.')
        }
      >
        {(id) => (
          <DateField
            id={id}
            value={date}
            min={payment.date}
            onChange={(iso) => setDate(iso || today())}
          />
        )}
      </Field>
      <Field label={t('Deposited to')}>
        {(id) => (
          <BankAccountSelect
            id={id}
            value={accountId}
            onChange={setAccountId}
            accounts={accounts ?? []}
          />
        )}
      </Field>
    </DialogShell>
  );
}

function ClearDialog({ payment, onClose }: { payment: ChequePayment; onClose: () => void }) {
  const fmt = useFormat();
  const accounts = useAccounts();
  const out = payment.direction === 'out';
  const earliest = payment.cheque.depositedOn ?? payment.date;
  const [date, setDate] = useState(today() < earliest ? earliest : today());
  const [accountId, setAccountId] = useState<string | null>(payment.cheque.bankAccountId ?? null);
  const { busy, run } = useRunner(onClose);
  return (
    <DialogShell
      title={t('Mark cheque cleared')}
      description={chequeTitle(payment, fmt)}
      onClose={onClose}
      busy={busy}
      confirm={{
        label: t('Mark cleared'),
        onClick: () =>
          void run(
            () => clearCheque(payment.id, { date, bankAccountId: accountId }),
            t('Cheque {number} cleared', { number: payment.cheque.number }),
          ),
      }}
    >
      <p className="text-sm text-slate-600">
        {out
          ? t('The amount leaves the bank account on the clearing date.')
          : t('The amount moves from post-dated cheques to the bank account on the clearing date.')}
      </p>
      <Field label={t('Clearing date')}>
        {(id) => (
          <DateField
            id={id}
            value={date}
            min={earliest}
            onChange={(iso) => setDate(iso || today())}
          />
        )}
      </Field>
      <Field label={out ? t('Paid from') : t('Cleared into')}>
        {(id) => (
          <BankAccountSelect
            id={id}
            value={accountId}
            onChange={setAccountId}
            accounts={accounts ?? []}
          />
        )}
      </Field>
    </DialogShell>
  );
}

const OTHER_REASON = '__other';

function ReturnDialog({ payment, onClose }: { payment: ChequePayment; onClose: () => void }) {
  const company = useCompany();
  const fmt = useFormat();
  const accounts = useAccounts();
  const out = payment.direction === 'out';
  const [date, setDate] = useState(today() < payment.date ? payment.date : today());
  const [choice, setChoice] = useState<string>(RETURN_REASONS[0]);
  const [other, setOther] = useState('');
  const [charge, setCharge] = useState(0);
  const [accountId, setAccountId] = useState<string | null>(payment.cheque.bankAccountId ?? null);
  const { busy, run } = useRunner(onClose);
  const reason = choice === OTHER_REASON ? other.trim() : t(choice);
  return (
    <DialogShell
      title={t('Mark cheque returned')}
      description={chequeTitle(payment, fmt)}
      onClose={onClose}
      busy={busy}
      danger
      confirm={{
        label: t('Mark returned'),
        onClick: () =>
          void run(
            () =>
              returnCheque(payment.id, {
                date,
                reason,
                charge,
                chargeAccountId: accountId,
              }),
            t('Cheque {number} marked as returned', { number: payment.cheque.number }),
          ),
      }}
    >
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        {out
          ? t('The payment is voided and the bills it paid are open again.')
          : t(
              'The payment is voided and the invoices it paid are open again. Returned cheques are counted against the client.',
            )}
        {payment.cheque.status === 'cleared'
          ? ` ${t('The clearing is reversed on the return date.')}`
          : ''}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Return date')}>
          {(id) => (
            <DateField
              id={id}
              value={date}
              min={payment.date}
              onChange={(iso) => setDate(iso || today())}
            />
          )}
        </Field>
        <Field label={t('Reason')}>
          {(id) => (
            <Select id={id} value={choice} onChange={(e) => setChoice(e.target.value)}>
              {RETURN_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(r)}
                </option>
              ))}
              <option value={OTHER_REASON}>{t('Other reason')}</option>
            </Select>
          )}
        </Field>
      </div>
      {choice === OTHER_REASON ? (
        <Field label={t('Other reason')}>
          {(id) => (
            <Textarea id={id} value={other} onChange={(e) => setOther(e.target.value)} rows={2} />
          )}
        </Field>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('Bank charge ({currency})', { currency: company.currency })}
          optional
          hint={t('Recorded as a bank charges expense.')}
        >
          {(id) => (
            <NumberInput id={id} value={charge} onValueChange={setCharge} allowNegative={false} />
          )}
        </Field>
        {charge > 0 ? (
          <Field label={t('Charged to')}>
            {(id) => (
              <BankAccountSelect
                id={id}
                value={accountId}
                onChange={setAccountId}
                accounts={accounts ?? []}
              />
            )}
          </Field>
        ) : null}
      </div>
    </DialogShell>
  );
}

function CancelDialog({ payment, onClose }: { payment: ChequePayment; onClose: () => void }) {
  const fmt = useFormat();
  const [date, setDate] = useState(today() < payment.date ? payment.date : today());
  const [reason, setReason] = useState('');
  const { busy, run } = useRunner(onClose);
  return (
    <DialogShell
      title={t('Cancel cheque')}
      description={chequeTitle(payment, fmt)}
      onClose={onClose}
      busy={busy}
      danger
      confirm={{
        label: t('Cancel cheque'),
        onClick: () =>
          void run(
            () => cancelCheque(payment.id, { date, reason }),
            t('Cheque {number} cancelled', { number: payment.cheque.number }),
          ),
      }}
    >
      <p className="text-sm text-slate-600">
        {t(
          'For a cheque given back or stopped before it was presented. The payment is voided and the documents it paid are open again.',
        )}
      </p>
      <Field label={t('Date')}>
        {(id) => (
          <DateField
            id={id}
            value={date}
            min={payment.date}
            onChange={(iso) => setDate(iso || today())}
          />
        )}
      </Field>
      <Field label={t('Reason')} optional>
        {(id) => (
          <Input
            id={id}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('Given back to the client')}
          />
        )}
      </Field>
    </DialogShell>
  );
}

function ReplaceDialog({
  payment,
  onClose,
  onReplaced,
}: {
  payment: ChequePayment;
  onClose: () => void;
  onReplaced?: (replacement: Payment) => void;
}) {
  const fmt = useFormat();
  const direction = paymentDirection(payment);
  const [date, setDate] = useState(today() < payment.date ? payment.date : today());
  const [amount, setAmount] = useState(payment.amount);
  const [cheque, setCheque] = useState<ChequeDetails>(
    newCheque({
      bank: payment.cheque.bank,
      drawer: payment.cheque.drawer,
      drawerCivilId: payment.cheque.drawerCivilId,
      date: today(),
    }),
  );
  const [busy, setBusy] = useState(false);
  const open = payment.cheque.status === 'held' || payment.cheque.status === 'deposited';
  const save = async () => {
    setBusy(true);
    try {
      const replacement = await replaceCheque(payment.id, {
        date,
        amount,
        cheque,
      });
      toast.success(
        t('Cheque {number} recorded as payment {payment}', {
          number: replacement.cheque?.number ?? '',
          payment: replacement.number,
        }),
      );
      onClose();
      onReplaced?.(replacement);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogShell
      title={t('Replace cheque')}
      description={chequeTitle(payment, fmt)}
      onClose={onClose}
      busy={busy}
      size="lg"
      confirm={{ label: t('Record new cheque'), onClick: () => void save() }}
    >
      <p className="text-sm text-slate-600">
        {open
          ? t('The current cheque is cancelled and the new one pays the same documents.')
          : t('The new cheque pays the same documents, as far as they are still open.')}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Amount ({currency})', { currency: payment.currency })}>
          {(id) => (
            <NumberInput id={id} value={amount} onValueChange={setAmount} allowNegative={false} />
          )}
        </Field>
        <Field label={direction === 'out' ? t('Date issued') : t('Date received')}>
          {(id) => <DateField id={id} value={date} onChange={(iso) => setDate(iso || today())} />}
        </Field>
      </div>
      <ChequeFields
        cheque={cheque}
        onChange={(patch) => setCheque((c) => ({ ...c, ...patch }))}
        direction={direction}
        paymentDate={date}
      />
    </DialogShell>
  );
}
