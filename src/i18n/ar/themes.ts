import type { Dictionary } from '../index';

/** Themes: their names, Settings → Appearance and the quick switch in the header. */
export default {
  // Theme names ("Classic" is in documents-pdf.ts)
  'Gulf blue': 'أزرق الخليج',
  Sky: 'سماوي',
  Turquoise: 'فيروزي',
  Oasis: 'الواحة',
  'Desert sand': 'رمال الصحراء',
  Sunset: 'الغروب',
  Rose: 'وردي',
  Lavender: 'خزامى',
  Graphite: 'جرافيت',
  Midnight: 'منتصف الليل',
  'Deep sea': 'أعماق البحر',
  Lagoon: 'البحيرة',
  'Oasis night': 'ليل الواحة',
  'Desert night': 'ليل الصحراء',
  Ember: 'الجمر',
  'Rose night': 'وردي ليلي',
  Amethyst: 'الجمشت',
  Charcoal: 'فحمي',
  'Black (high contrast)': 'أسود (تباين عالٍ)',

  // Settings → Appearance
  'This device': 'هذا الجهاز',
  Appearance: 'المظهر',
  'Choose how Maham One looks on this device. Documents always print on white paper.':
    'اختر مظهر مهام ون على هذا الجهاز. تُطبع المستندات دائماً على ورق أبيض.',
  'Match my device': 'مطابقة إعداد الجهاز',
  'Use a light theme by day and a dark one when this device is set to dark.':
    'سمة فاتحة في العادة، وسمة داكنة عندما يكون هذا الجهاز على الوضع الداكن.',
  'Showing {theme}. Pick one light and one dark theme below.':
    'المعروضة الآن: {theme}. اختر أدناه سمة فاتحة وأخرى داكنة.',
  'Light themes': 'السمات الفاتحة',
  'Dark themes': 'السمات الداكنة',
  'When your device is light': 'عندما يكون جهازك على الوضع الفاتح',
  'When your device is dark': 'عندما يكون جهازك على الوضع الداكن',

  // Header and command palette
  Theme: 'السمة',
  'All appearance settings': 'كل إعدادات المظهر',
  'Change theme': 'تغيير السمة',
  'Switch to dark theme': 'التبديل إلى السمة الداكنة',
  'Switch to light theme': 'التبديل إلى السمة الفاتحة',
} satisfies Dictionary;
