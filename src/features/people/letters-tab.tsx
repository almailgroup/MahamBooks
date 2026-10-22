import { useMemo, useState } from 'react';
import { FilePlus2, Mails } from 'lucide-react';
import type { Employee, EmployeeLetter, LetterKind } from '@/db/types';
import { ButtonLink, Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, Spinner } from '@/components/ui/misc';
import { t } from '@/i18n';
import { LetterDialog } from './letter-dialog';
import { pendingByLetter, useLetterRequests, useLetters, useLettersView } from './letter-hooks';
import { LettersTable } from './letters-table';

/**
 * An employee's Letters tab (#19): their letters, the latest first, and a
 * new one for them. `start` opens a new letter of that kind at once (the
 * settlement's link to an experience certificate).
 */
export function LettersTab({
  employee,
  start,
  onStarted,
}: {
  employee: Employee;
  start?: LetterKind | null;
  onStarted?: () => void;
}) {
  const view = useLettersView();
  const letters = useLetters(employee.id);
  const requests = useLetterRequests();
  const [open, setOpen] = useState<EmployeeLetter | 'new' | null>(start ? 'new' : null);
  const byId = useMemo(() => new Map([[employee.id, employee]]), [employee]);
  const pending = useMemo(() => pendingByLetter(requests), [requests]);
  if (view.loading || !letters || !requests) return <Spinner className="py-12" />;
  if (!view.on) {
    return (
      <Card>
        <EmptyState
          icon={<Mails />}
          title={t('Employee letters are off')}
          description={
            view.available
              ? t('Turn them on in People → Letters first.')
              : t(
                  'The cloud needs the latest database script first. Ask the owner of the company to run it.',
                )
          }
          action={
            <ButtonLink to="/people/letters" variant="outline">
              {t('Letters')}
            </ButtonLink>
          }
        />
      </Card>
    );
  }
  const add = view.canDraft ? (
    <Button onClick={() => setOpen('new')}>
      <FilePlus2 /> {t('New letter')}
    </Button>
  ) : undefined;
  return (
    <>
      {letters.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Mails />}
            title={t('No letters yet')}
            description={t(
              'Salary, experience and employment certificates, warning letters and no objection certificates, filled from their record.',
            )}
            action={add}
          />
        </Card>
      ) : (
        <Card>
          <CardHeader title={t('Letters')} actions={add} />
          <LettersTable
            letters={letters}
            employees={byId}
            pending={pending}
            onOpen={(letter) => setOpen(letter)}
            showEmployee={false}
          />
        </Card>
      )}
      {open ? (
        <LetterDialog
          letter={open === 'new' ? null : open}
          employeeId={employee.id}
          kind={open === 'new' ? (start ?? undefined) : undefined}
          onClose={() => {
            setOpen(null);
            onStarted?.();
          }}
        />
      ) : null}
    </>
  );
}
