import type { Dictionary } from '../index';

/**
 * Fixes after the check of Phase 4: a Replace restore keeps the higher
 * numbering counters (D12), and its confirmation says so.
 */
export default {
  // Settings → Backup & data → Replace everything
  'Numbers are the exception: invoices, bills, letters and everything else numbered carry on from the highest number given, on this device or in the backup, so none is used twice.':
    'الأرقام هي الاستثناء: تستمر أرقام الفواتير وفواتير الموردين والخطابات وكل ما له رقم من بعد أعلى رقم أُعطي، على هذا الجهاز أو في النسخة الاحتياطية، فلا يُستخدم أي رقم مرتين.',
} satisfies Dictionary;
