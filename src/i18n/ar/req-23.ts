import type { Dictionary } from '../index';

/** Printing cheques issued onto Burgan Bank and KFH leaves: layouts, test print, spoiled leaves. */
export default {
  // Settings → Payment details
  'Cheque printing': 'طباعة الشيكات',
  'Print cheques issued to vendors straight onto Burgan Bank and KFH cheque leaves. Every print is recorded on the cheque; nothing is posted.':
    'اطبع الشيكات الصادرة للموردين مباشرةً على أوراق شيكات بنك برقان وبيت التمويل الكويتي. تُسجَّل كل طباعة على الشيك ولا يُرحَّل أي قيد.',
  'Print cheques issued': 'طباعة الشيكات الصادرة',
  'Adds Print cheque to cheques issued, on the payment and in the cheque register. Check the layout with a test print on plain paper first.':
    'يضيف «طباعة الشيك» إلى الشيكات الصادرة في صفحة الدفعة وسجل الشيكات. افحص النموذج أولًا بطباعة تجريبية على ورق عادي.',
  'Owners, admins and accountants turn cheque printing on or off.':
    'يشغّل المالكون والمديرون والمحاسبون طباعة الشيكات أو يوقفونها.',
  'Cheque layouts': 'نماذج الشيكات',

  // Printing a cheque
  'Print cheque': 'طباعة الشيك',
  'Print cheque {number}': 'طباعة الشيك {number}',
  'Test print': 'طباعة تجريبية',
  'This cheque could not be found.': 'تعذّر العثور على هذا الشيك.',
  'There is no cheque layout for {bank}. Cheques on Burgan Bank and KFH are printed.':
    'لا يوجد نموذج شيك لـ{bank}. تُطبع شيكات بنك برقان وبيت التمويل الكويتي.',
  'this bank': 'هذا البنك',
  'Back to payment {number}': 'العودة إلى الدفعة {number}',
  'Cheque {number} printed': 'تمت طباعة الشيك {number}',
  'Cheque printing is off. The owner turns it on in Settings → Payment details.':
    'طباعة الشيكات متوقفة. يشغّلها المالك من الإعدادات ← بيانات الدفع.',
  'Cheque printing is off. The owner turns it on in {place}.':
    'طباعة الشيكات متوقفة. يشغّلها المالك من {place}.',
  'Settings → Payment details': 'الإعدادات ← بيانات الدفع',
  'Printed on {date} on leaf {number}.': 'طُبع في {date} على الورقة {number}.',
  'To print it again, mark that leaf spoiled first.':
    'لطباعته مرة أخرى، سجّل تلك الورقة كورقة تالفة أولًا.',
  'Print again on a new leaf': 'الطباعة مجددًا على ورقة جديدة',
  'The payee’s name doesn’t fit on its line. Shorten it on the payment, or make the line longer in the cheque layout.':
    'اسم المستفيد لا يتسع في سطره. اختصره في الدفعة، أو أطِل السطر في نموذج الشيك.',
  'The amount in figures or the date doesn’t fit in its box. Make the box wider in the cheque layout.':
    'المبلغ رقمًا أو التاريخ لا يتسع في خانته. وسّع الخانة في نموذج الشيك.',
  'Enter who the cheque is payable to (Pay to) on the payment first.':
    'أدخل اسم المستفيد (ادفعوا لأمر) في الدفعة أولًا.',
  'The amount in words doesn’t fit on the two lines of the leaf. Make the lines longer in the cheque layout.':
    'المبلغ كتابةً لا يتسع في سطري الورقة. أطِل السطرين في نموذج الشيك.',
  'This layout has not been checked against a real leaf yet. Make a test print on plain paper first and hold it over a leaf.':
    'لم يُفحص هذا النموذج على ورقة شيك حقيقية بعد. اطبع أولًا طباعة تجريبية على ورق عادي وضعها فوق ورقة الشيك.',
  'Put leaf {number} in the printer. Print at 100% (actual size) with no margins, from Chrome or Edge.':
    'ضع الورقة {number} في الطابعة. اطبع بحجم 100% (الحجم الفعلي) ودون هوامش من متصفح Chrome أو Edge.',
  'Cross the cheque: A/C payee only': 'تسطير الشيك: يصرف للمستفيد الأول',
  'Prints “يصرف للمستفيد الأول / A/C Payee Only”.': 'يطبع «يصرف للمستفيد الأول / A/C Payee Only».',
  'Did the cheque print correctly?': 'هل طُبع الشيك بشكل صحيح؟',
  'Check leaf {number}: the date, the payee, and the amount in words and in figures.':
    'افحص الورقة {number}: التاريخ والمستفيد والمبلغ كتابةً ورقمًا.',
  'It didn’t print': 'لم يُطبع',
  'No, the leaf is spoiled': 'لا، الورقة تالفة',
  'Yes, record the print': 'نعم، سجّل الطباعة',

  // Spoiled leaves
  'Spoiled leaf': 'ورقة تالفة',
  'Spoiled leaves': 'الأوراق التالفة',
  Spoiled: 'تالفة',
  'Printed wrongly': 'طُبعت بشكل خاطئ',
  'Printed again': 'أُعيدت الطباعة',
  'Changed after printing': 'تغيّر بعد الطباعة',
  'Leaf {number} is recorded as spoiled: destroy it. The cheque then prints on the next leaf.':
    'تُسجَّل الورقة {number} كورقة تالفة، فأتلِفها. ثم يُطبع الشيك على الورقة التالية.',
  'Number of the next leaf': 'رقم الورقة التالية',
  'The number the bank printed on the next leaf of the cheque book.':
    'الرقم الذي طبعه البنك على الورقة التالية في دفتر الشيكات.',
  'Record the spoiled leaf': 'تسجيل الورقة التالفة',
  'Leaf {number} recorded as spoiled. Put leaf {next} in the printer.':
    'سُجّلت الورقة {number} كورقة تالفة. ضع الورقة {next} في الطابعة.',
  'Enter the number of the next leaf.': 'أدخل رقم الورقة التالية.',
  'The leaf with this number is spoiled. Enter the number of the next leaf.':
    'الورقة بهذا الرقم تالفة. أدخل رقم الورقة التالية.',
  'Leaf {number} was recorded as spoiled when the cheque changed after printing. Take the next leaf.':
    'سُجّلت الورقة {number} كورقة تالفة عندما تغيّر الشيك بعد طباعته. استخدم الورقة التالية.',
  'Take the next leaf': 'استخدام الورقة التالية',
  'Leaf {number} is spoiled. The cheque prints on the next leaf.':
    'الورقة {number} تالفة. يُطبع الشيك على الورقة التالية.',
  'Put leaf {next} in the printer.': 'ضع الورقة {next} في الطابعة.',
  'Use this leaf': 'استخدام هذه الورقة',
  'Payment {payment} is now on cheque leaf {next}': 'الدفعة {payment} الآن على ورقة الشيك {next}',
  'Leaf {number} is spoiled: enter the next one.': 'الورقة {number} تالفة: أدخل الورقة التالية.',

  // The payment, the register and the payment form
  Printed: 'مطبوع',
  'Printed on': 'تاريخ الطباعة',
  'A/C payee only': 'يصرف للمستفيد الأول',
  'This cheque was printed on {date}. Saving another amount, payee, number, bank or date marks the printed leaf spoiled: destroy it and print the cheque again.':
    'طُبع هذا الشيك في {date}. حفظ مبلغ أو مستفيد أو رقم أو بنك أو تاريخ مختلف يسجّل الورقة المطبوعة كورقة تالفة: أتلِفها واطبع الشيك من جديد.',

  // Which cheques print
  'This payment has no cheque.': 'لا يوجد شيك في هذه الدفعة.',
  'Only cheques the company issues are printed.': 'تُطبع الشيكات التي تصدرها الشركة فقط.',
  'This cheque is void.': 'هذا الشيك ملغى.',
  'This cheque was cancelled.': 'أُلغي هذا الشيك.',
  'This cheque has cleared.': 'تم تحصيل هذا الشيك.',
  'This cheque came back unpaid.': 'ارتُدّ هذا الشيك دون صرف.',
  'Only a cheque not yet presented can be printed.': 'لا يُطبع إلا شيك لم يُقدَّم للبنك بعد.',
  'Only cheques in Kuwaiti dinars are printed.': 'تُطبع الشيكات بالدينار الكويتي فقط.',
  'The cheque has no amount.': 'لا يوجد مبلغ في الشيك.',
  'This cheque was printed. To print it again, mark its leaf spoiled first.':
    'طُبع هذا الشيك. لطباعته مرة أخرى، سجّل ورقته كورقة تالفة أولًا.',
  'This cheque was printed. Cancel the cheque instead of paying another way.':
    'طُبع هذا الشيك. ألغِ الشيك بدلًا من تغيير طريقة الدفع.',
  'Leaves of this cheque were printed. Cancel the cheque instead of deleting it.':
    'طُبعت أوراق من هذا الشيك. ألغِ الشيك بدلًا من حذفه.',
  'Cheque printing is off for this company.': 'طباعة الشيكات متوقفة في هذه الشركة.',

  // Activity
  'Cheque {number} on payment {payment} printed': 'طُبع الشيك {number} في الدفعة {payment}',
  'Cheque {number} on payment {payment} sent to the printer':
    'أُرسل الشيك {number} في الدفعة {payment} إلى الطابعة',
  'This cheque can’t be printed now. The page on screen says why.':
    'لا يمكن طباعة هذا الشيك الآن، والسبب مذكور في الصفحة على الشاشة.',
  'Cheque leaf {number} spoiled; payment {payment} is now on leaf {next}':
    'ورقة الشيك {number} تالفة، والدفعة {payment} الآن على الورقة {next}',
  'Cheque leaf {number} spoiled: payment {payment} changed after printing':
    'ورقة الشيك {number} تالفة: تغيّرت الدفعة {payment} بعد الطباعة',
  'Cheque layout {name} saved': 'حُفظ نموذج الشيك {name}',
  'Cheque layout {name} updated': 'حُدّث نموذج الشيك {name}',
  'Cheque layout {name} put away: the built-in layout prints again':
    'أُوقف نموذج الشيك {name}، وعادت الطباعة بالنموذج المدمج',

  // Cheque layouts
  'Where each bank’s cheque leaf takes the date, the payee and the amount, for printing cheques issued.':
    'مواضع التاريخ والمستفيد والمبلغ على ورقة شيك كل بنك، لطباعة الشيكات الصادرة.',
  'Owners, admins and accountants change cheque layouts. You can look at them.':
    'يعدّل المالكون والمديرون والمحاسبون نماذج الشيكات. يمكنك الاطلاع عليها.',
  'Saving layouts needs the latest database script on the server: ask the owner to run it (Settings → Cloud and sync). The built-in layouts print meanwhile.':
    'يتطلب حفظ النماذج تشغيل أحدث سكربت لقاعدة البيانات على الخادم: اطلب من المالك تشغيله (الإعدادات ← السحابة والمزامنة). تُستخدم النماذج المدمجة للطباعة في الأثناء.',
  'Saving cheque layouts needs the latest database script. Ask the owner to run it.':
    'يتطلب حفظ نماذج الشيكات أحدث سكربت لقاعدة البيانات. اطلب من المالك تشغيله.',
  'Cheque layout not found.': 'تعذّر العثور على نموذج الشيك.',
  'Cheque layout saved': 'تم حفظ نموذج الشيك',
  'Use the built-in layout again?': 'العودة إلى النموذج المدمج؟',
  'Cheques on this bank print with the built-in layout. This layout is kept with the cheques printed with it.':
    'تُطبع شيكات هذا البنك بالنموذج المدمج. يُحتفظ بهذا النموذج مع الشيكات التي طُبعت به.',
  'Use the built-in layout': 'استخدام النموذج المدمج',
  'The built-in layout prints again': 'عادت الطباعة بالنموذج المدمج',
  'This company’s layout prints cheques on this bank.': 'تُطبع شيكات هذا البنك بنموذج الشركة.',
  'The built-in layout prints cheques on this bank.': 'تُطبع شيكات هذا البنك بالنموذج المدمج.',
  'Save layout': 'حفظ النموذج',
  'At the leaf’s real size, with a sample cheque of 1,250.750 dinars.':
    'بالحجم الفعلي للورقة، مع شيك تجريبي بمبلغ 1,250.750 دينار.',
  'At the leaf’s real size, with a sample cheque of 1,250.750 dinars. Not checked against a real leaf yet.':
    'بالحجم الفعلي للورقة، مع شيك تجريبي بمبلغ 1,250.750 دينار. لم يُفحص على ورقة حقيقية بعد.',
  'Show the crossing': 'إظهار التسطير',
  Leaf: 'ورقة الشيك',
  'Measured from the top left corner of the leaf, in millimetres.':
    'تُقاس من الزاوية العليا اليسرى للورقة، بالمليمتر.',
  'Width (mm)': 'العرض (مم)',
  'Height (mm)': 'الارتفاع (مم)',
  'Move every field right (mm)': 'تحريك كل الحقول لليمين (مم)',
  'Move every field down (mm)': 'تحريك كل الحقول للأسفل (مم)',
  'For every printer; each printer also has its own, in the test print.':
    'لكل الطابعات، ولكل طابعة أيضًا إزاحتها الخاصة في الطباعة التجريبية.',
  'Date written as': 'كتابة التاريخ',
  'One digit per box': 'رقم في كل خانة',
  'Before the figures': 'قبل المبلغ رقمًا',
  'Such as KD, when the leaf has none.': 'مثل د.ك، إذا لم تكن مطبوعة على الورقة.',
  'Around the figures': 'حول المبلغ رقمًا',
  'So that nothing can be added, such as **.': 'حتى لا يمكن إضافة شيء، مثل **.',
  'Checked against a real leaf': 'تم فحصه على ورقة حقيقية',
  'Turn on once a test print on plain paper lines up with a real leaf on the office printer.':
    'شغّله بعد أن تتطابق طباعة تجريبية على ورق عادي مع ورقة شيك حقيقية على طابعة المكتب.',
  Fields: 'الحقول',
  Field: 'الحقل',
  'From the left': 'من اليسار',
  'From the top': 'من الأعلى',
  Width: 'العرض',
  Height: 'الارتفاع',
  '{field}: from the left (mm)': '{field}: من اليسار (مم)',
  '{field}: from the top (mm)': '{field}: من الأعلى (مم)',
  '{field}: width (mm)': '{field}: العرض (مم)',
  '{field}: height (mm)': '{field}: الارتفاع (مم)',
  'Amount in words, line 1': 'المبلغ كتابةً، السطر 1',
  'Amount in words, line 2': 'المبلغ كتابةً، السطر 2',
  'Amount in figures': 'المبلغ رقمًا',
  'Give the layout a name.': 'أعطِ النموذج اسمًا.',
  'A cheque leaf is between 100 and 250 mm wide and 50 and 120 mm high.':
    'يتراوح عرض ورقة الشيك بين 100 و250 مم وارتفاعها بين 50 و120 مم.',
  'The layout can be moved by up to 15 mm.': 'يمكن تحريك النموذج حتى 15 مم.',
  'Every field needs a place on the leaf.': 'يحتاج كل حقل إلى موضع على الورقة.',
  'Every field must be inside the leaf.': 'يجب أن يكون كل حقل داخل الورقة.',

  // Test print
  'Test print: {name}': 'طباعة تجريبية: {name}',
  'Print on plain paper at 100% (actual size) with no margins, then hold it over a real leaf against the light. If the fields are off, move them by that much and print again.':
    'اطبع على ورق عادي بحجم 100% (الحجم الفعلي) ودون هوامش، ثم ضعها فوق ورقة شيك حقيقية مقابل الضوء. إذا انحرفت الحقول، حرّكها بمقدار الانحراف واطبع مرة أخرى.',
  'Move 0.5 mm left': 'تحريك 0.5 مم لليسار',
  'Move 0.5 mm up': 'تحريك 0.5 مم للأعلى',
  'Move 0.5 mm down': 'تحريك 0.5 مم للأسفل',
  'Move 0.5 mm right': 'تحريك 0.5 مم لليمين',
  'This printer: {x} mm across, {y} mm down': 'هذه الطابعة: {x} مم أفقيًا، {y} مم للأسفل',
  'Kept on this device only: each printer has its own. Moving the layout for every printer is in Cheque layouts.':
    'تُحفظ على هذا الجهاز فقط، فلكل طابعة إزاحتها. تحريك النموذج لكل الطابعات في نماذج الشيكات.',
} satisfies Dictionary;
