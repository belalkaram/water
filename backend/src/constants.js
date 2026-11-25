// Shared domain vocabulary (mirrored in mobile/src/constants/domain.ts)
const VISIT_OUTCOMES = ['inspected', 'closed', 'refused', 'not_found', 'other'];
const VIOLATION_LEVELS = ['none', 'minor', 'major', 'critical'];
const COMPLIANCE_ANSWERS = ['yes', 'no', 'na'];
const COMPLIANCE_KEYS = [
  'pretreatment_present',
  'pretreatment_working',
  'grease_trap_present',
  'grease_trap_clean',
  'illegal_connection',
];
// المدن الرسمية = أسماء ملفات الإكسيل العشرة فقط (لا تزيد ولا تنقص)
const OFFICIAL_CENTERS = [
  'أشمون', 'الباجور', 'الشهداء', 'بركة السبع', 'تلا',
  'سرس الليان', 'شبين الكوم', 'قويسنا', 'قويسنا المنطقة الصناعية', 'منوف',
];
const REVISIT_MONTHS = 6;
// أقصى عدد أيام مسموح للرجوع بتاريخ المعاينة (لمنع الأخطاء الكتابية)
const VISIT_DATE_MAX_AGE_DAYS = 90;
const RESERVATION_TTL_HOURS = Number(process.env.RESERVATION_TTL_HOURS || 6);

const OUTCOME_LABELS = {
  inspected: 'تمت المعاينة',
  closed: 'المنشأة مغلقة',
  refused: 'رفض المعاينة',
  not_found: 'غير موجودة بالعنوان',
  other: 'أخرى',
};
const LEVEL_LABELS = { none: 'لا توجد مخالفة', minor: 'بسيطة', major: 'جسيمة', critical: 'خطيرة' };
const COMPLIANCE_LABELS = {
  pretreatment_present: 'توجد وحدة معالجة مبدئية',
  pretreatment_working: 'وحدة المعالجة تعمل',
  grease_trap_present: 'توجد مصيدة شحوم',
  grease_trap_clean: 'مصيدة الشحوم نظيفة',
  illegal_connection: 'توجد توصيلة مخالفة',
};

module.exports = {
  OFFICIAL_CENTERS, REVISIT_MONTHS, VISIT_DATE_MAX_AGE_DAYS,
  VISIT_OUTCOMES, VIOLATION_LEVELS, COMPLIANCE_ANSWERS, COMPLIANCE_KEYS,
  RESERVATION_TTL_HOURS, OUTCOME_LABELS, LEVEL_LABELS, COMPLIANCE_LABELS,
};
