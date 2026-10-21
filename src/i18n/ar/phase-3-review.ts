import type { Dictionary } from '../index';

/** Fixes after the review of Phase 3 (Super Admin, approvals, cheques, Updates). */
export default {
  // Decisions carried out once the cloud has them
  'Approved. It is carried out once this device has synced.':
    'معتمد. يُنفَّذ بعد مزامنة هذا الجهاز.',
  'Approved, but not carried out yet on this device. Carry it out again, or reject it if it can’t be carried out.':
    'معتمد، لكنه لم يُنفَّذ بعد على هذا الجهاز. نفّذه مرة أخرى، أو ارفضه إن تعذّر تنفيذه.',
  'Confirmed. It is recorded once this device has synced.': 'مؤكد. يُسجَّل بعد مزامنة هذا الجهاز.',
  'This request was decided on another device meanwhile.':
    'تم البتّ في هذا الطلب على جهاز آخر في هذه الأثناء.',
  'The cloud did not take this decision. See Settings → Cloud and sync.':
    'لم تقبل السحابة هذا القرار. راجع الإعدادات ← السحابة والمزامنة.',

  // Issued invoices kept for approvers
  'This document is issued, so only an approver can delete it. Ask for a void instead.':
    'هذا المستند صادر، فلا يحذفه إلا المعتمِد. اطلب إبطاله بدلاً من ذلك.',
  'This invoice has no number yet. Issue it again to give it one.':
    'لا رقم لهذه الفاتورة بعد. أصدِرها مرة أخرى ليُعطى لها رقم.',

  // Settings → Cloud and sync: changes refused together
  '{count} changes made with it wait with it.': {
    one: 'وينتظر معه تغيير واحد أُجري معه.',
    two: 'وينتظر معه تغييران أُجريا معه.',
    few: 'وتنتظر معه {count} تغييرات أُجريت معه.',
    many: 'وينتظر معه {count} تغييراً أُجري معه.',
    other: 'وينتظر معه {count} تغيير أُجري معه.',
  },

  // Settings → Team
  'Only the owner cancels this invitation.': 'المالك وحده يلغي هذه الدعوة.',

  // Updates: a member's own change of the team
  '{name} became {role}': 'انتقال {name} إلى دور {role}',
} satisfies Dictionary;
