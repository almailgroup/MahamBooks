import { db } from '../db';
import {
  draftFromTemplate,
  getTemplate,
  issueLetter,
  markLettersPrinted,
  saveLetterDraft,
  saveTemplate,
  setLettersOn,
} from '../letters';
import { defaultTemplateId } from '@/lib/hr/letter-templates';
import type { DemoBooks } from './books';

/**
 * Employee letters (#19) in the demo: switched on, signed by the
 * operations manager; a salary certificate for a bank issued and
 * printed last month, another in Arabic and English issued this week and
 * waiting to be printed, an
 * experience certificate drafted for the employee who resigned, and the
 * employment certificate set to draft itself for each new joiner.
 */
export async function lettersStory(books: DemoBooks): Promise<void> {
  const cal = books.calendar;
  await setLettersOn(books.id, true);
  const signatory = books.employees.abdulaziz;
  for (const kind of ['salary_certificate', 'experience_certificate'] as const) {
    const template = (await getTemplate(books.id, defaultTemplateId(books.id, kind)))!;
    await saveTemplate({
      ...template,
      signatoryName: signatory.name,
      signatoryTitle: signatory.jobTitle,
    });
  }
  const employment = (await getTemplate(
    books.id,
    defaultTemplateId(books.id, 'employment_certificate'),
  ))!;
  await saveTemplate({ ...employment, autoOn: ['joining'] });
  const salary = (await getTemplate(books.id, defaultTemplateId(books.id, 'salary_certificate')))!;

  const forBank = await saveLetterDraft({
    ...draftFromTemplate(salary, books.employees.rajesh.id),
    addressee: 'إلى البنك المعني',
  });
  const first = await issueLetter(forBank.id, cal.workday(cal.ago(34)));
  await markLettersPrinted([first.id]);

  const forEmbassy = await saveLetterDraft(
    draftFromTemplate(salary, books.employees.maryam.id, 'ar-en'),
  );
  await issueLetter(forEmbassy.id, cal.workday(cal.ago(3)));

  const experience = (await getTemplate(
    books.id,
    defaultTemplateId(books.id, 'experience_certificate'),
  ))!;
  const leaver = await db.employees.get(books.employees.ahmed.id);
  if (leaver) {
    await saveLetterDraft({
      ...draftFromTemplate(experience, leaver.id),
      trigger: 'leaving',
    });
  }
}
