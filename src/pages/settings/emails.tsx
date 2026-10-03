import { useState } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import type { EmailTemplates } from '@/db/types';
import { defaultEmailTemplates, defaultEmailTemplatesAr, EMAIL_PLACEHOLDERS } from '@/db/defaults';
import { msg, t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Segmented } from '@/components/ui/misc';
import {
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
} from '@/components/ui/overlay';
import { SaveBar, SettingsSection, useCompanyDraft } from './shared';

const KINDS: { value: keyof EmailTemplates; label: string }[] = [
  { value: 'invoice', label: msg('Invoice') },
  { value: 'quote', label: msg('Quote') },
  { value: 'credit', label: msg('Credit note') },
  { value: 'reminder', label: msg('Reminder') },
  { value: 'payment', label: msg('Receipt') },
];

export default function EmailSettings() {
  const { draft, update, dirty, saving, save, reset } = useCompanyDraft();
  const [kind, setKind] = useState<keyof EmailTemplates>('invoice');
  const template = draft.emailTemplates[kind];
  const set = (patch: Partial<typeof template>) =>
    update({ emailTemplates: { ...draft.emailTemplates, [kind]: { ...template, ...patch } } });

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('Email templates')}
        description={t(
          'Used when you send documents from the app. Your email program opens with the message ready.',
        )}
      >
        <Segmented
          value={kind}
          onChange={setKind}
          options={KINDS.map((k) => ({ value: k.value, label: t(k.label) }))}
        />
        <Field label={t('Subject')}>
          {(id) => (
            <Input
              id={id}
              value={template.subject}
              onChange={(e) => set({ subject: e.target.value })}
              dir="auto"
            />
          )}
        </Field>
        <Field label={t('Message')}>
          {(id) => (
            <Textarea
              id={id}
              value={template.body}
              onChange={(e) => set({ body: e.target.value })}
              rows={10}
              dir="auto"
            />
          )}
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            {t('Placeholders:')}{' '}
            {EMAIL_PLACEHOLDERS.map((p) => (
              <code
                key={p}
                dir="ltr"
                className="me-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
              >
                {p}
              </code>
            ))}
          </p>
          <DropdownMenu>
            <DropdownTrigger asChild>
              <Button variant="ghost" size="sm">
                <RotateCcw /> {t('Restore default')} <ChevronDown />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownItem onSelect={() => set(defaultEmailTemplates()[kind])}>
                {t('English text')}
              </DropdownItem>
              <DropdownItem onSelect={() => set(defaultEmailTemplatesAr()[kind])}>
                {t('Arabic text')}
              </DropdownItem>
            </DropdownContent>
          </DropdownMenu>
        </div>
      </SettingsSection>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </div>
  );
}
