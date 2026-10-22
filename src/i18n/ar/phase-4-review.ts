import type { Dictionary } from '../index';

/**
 * Fixes after the review of Phase 4 (leave reasons, salary approval, expiry
 * alerts, employee letters). Payroll: the Super Admin's decision is موافقة.
 */
export default {
  // Salary approval: approvers the owner gave no access to People
  'The owner has given you no access to Maham People, so you don’t decide pay runs.':
    'لم يمنحك المالك صلاحية الوصول إلى مهام بيبول، فلا تبتّ في الموافقة على مسيرات الرواتب.',

  // Employee letters
  'Write what happened. It is printed in the warning letter.':
    'اكتب ما حدث، فهو يُطبع في خطاب الإنذار.',
  'Write what the company has no objection to. It is printed in the certificate.':
    'اكتب ما لا تمانع فيه الشركة، فهو يُطبع في الشهادة.',
  'Your access to Maham People doesn’t let you issue letters, so you can’t approve this request. The owner or another approver can.':
    'صلاحيتك في مهام بيبول لا تسمح لك بإصدار الخطابات، فلا يمكنك اعتماد هذا الطلب. يمكن ذلك للمالك أو لمعتمِد آخر.',
  'The request expired before it was decided.': 'انتهت مدة الطلب قبل البتّ فيه.',

  // Settings → Email alerts
  'Invoices, bills and cheques are left out: the owner has given you no access to Maham Books.':
    'لا تشمل الفواتير وفواتير الموردين والشيكات: لم يمنحك المالك صلاحية الوصول إلى مهام بوكس.',

  // Payslips
  'Leave as recorded when the pay run was approved.':
    'الإجازات كما كانت مسجلة عند اعتماد مسير الرواتب.',
} satisfies Dictionary;
