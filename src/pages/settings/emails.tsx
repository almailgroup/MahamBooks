import { useState } from 'react';
import type { EmailTemplates } from '@/db/types';
import { defaultEmailTemplates, EMAIL_PLACEHOLDERS } from '@/db/defaults';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Segmented } from '@/components/ui/misc';
import { SaveBar, SettingsSection, useCompanyDraft } from './shared';

const KINDS: { value: keyof EmailTemplates; label: string }[] = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'quote', label: 'Quote' },
  { value: 'credit', label: 'Credit note' },
  { value: 'reminder', label: 'Reminder' },
  { value: 'payment', label: 'Receipt' },
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
        title="Email templates"
        description="Used when you send documents from the app. Your email program opens with the message ready."
      >
        <Segmented value={kind} onChange={setKind} options={KINDS} />
        <Field label="Subject">
          {(id) => (
            <Input
              id={id}
              value={template.subject}
              onChange={(e) => set({ subject: e.target.value })}
            />
          )}
        </Field>
        <Field label="Message">
          {(id) => (
            <Textarea
              id={id}
              value={template.body}
              onChange={(e) => set({ body: e.target.value })}
              rows={10}
            />
          )}
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            Placeholders:{' '}
            {EMAIL_PLACEHOLDERS.map((p) => (
              <code
                key={p}
                className="me-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
              >
                {p}
              </code>
            ))}
          </p>
          <Button variant="ghost" size="sm" onClick={() => set(defaultEmailTemplates()[kind])}>
            Restore default
          </Button>
        </div>
      </SettingsSection>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </div>
  );
}
