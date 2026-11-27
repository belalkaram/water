// Mirrors backend/src/constants.js — keep in sync.
export type VisitOutcome = 'inspected' | 'closed' | 'refused' | 'not_found' | 'other';
export type ViolationLevel = 'none' | 'minor' | 'major' | 'critical';
export type ComplianceAnswer = 'yes' | 'no' | 'na';

export const OUTCOME_LABELS: Record<VisitOutcome, string> = {
  inspected: 'تمت المعاينة',
  closed: 'المنشأة مغلقة',
  refused: 'رفض المعاينة',
  not_found: 'غير موجودة بالعنوان',
  other: 'أخرى',
};

export const LEVEL_LABELS: Record<ViolationLevel, string> = {
  none: 'لا توجد مخالفة',
  minor: 'بسيطة',
  major: 'جسيمة',
  critical: 'خطيرة',
};

export const COMPLIANCE_ITEMS: { key: string; label: string; badAnswer: ComplianceAnswer }[] = [
  { key: 'pretreatment_present', label: 'توجد وحدة معالجة مبدئية', badAnswer: 'no' },
  { key: 'pretreatment_working', label: 'وحدة المعالجة تعمل', badAnswer: 'no' },
  { key: 'grease_trap_present', label: 'توجد مصيدة شحوم', badAnswer: 'no' },
  { key: 'grease_trap_clean', label: 'مصيدة الشحوم نظيفة', badAnswer: 'no' },
  { key: 'illegal_connection', label: 'توجد توصيلة مخالفة', badAnswer: 'yes' },
];

// أقصى عدد أيام للرجوع بتاريخ المعاينة — يطابق VISIT_DATE_MAX_AGE_DAYS في السيرفر
export const VISIT_DATE_MAX_AGE_DAYS = 90;

/** Today's calendar date (device local time) as YYYY-MM-DD */
export function todayYmd(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** YYYY-MM-DD -> DD/MM/YYYY */
export function formatYmd(ymd?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export const SAMPLE_TYPE_PRESETS = ['صرف صناعي', 'صرف مطعم / مطبخ', 'عينة لحظية', 'عينة مجمعة', 'مياه معالجة', 'مياه شرب'];

export function suggestViolationLevel(compliance: Record<string, ComplianceAnswer>): ViolationLevel {
  const bad = COMPLIANCE_ITEMS.filter((i) => compliance[i.key] === i.badAnswer).map((i) => i.key);
  if (bad.includes('illegal_connection')) return 'critical';
  if (bad.includes('pretreatment_present')) return 'major';
  if (bad.length > 0) return 'minor';
  return 'none';
}

export const LEVEL_COLORS: Record<ViolationLevel, { bg: string; fg: string }> = {
  none: { bg: '#E9F6E5', fg: '#4FA336' },
  minor: { bg: '#FEF3C7', fg: '#D97706' },
  major: { bg: '#FFEDD5', fg: '#C2410C' },
  critical: { bg: '#FEE2E2', fg: '#DC2626' },
};

// المدن الرسمية فقط (أسماء ملفات الإكسيل) — تطابق backend/src/constants.js
export const OFFICIAL_CENTERS = [
  'أشمون', 'الباجور', 'الشهداء', 'بركة السبع', 'تلا',
  'سرس الليان', 'شبين الكوم', 'قويسنا', 'قويسنا المنطقة الصناعية', 'منوف',
];

// أقسام النشاط — كل قسم اختيار مستقل (تطابق ACTIVITY_TYPES في backend/src/utils/centerParser.js)
export const ACTIVITY_TYPES = [
  'مطعم', 'مطبخ', 'كافيه', 'مخبز', 'حلواني', 'مغسلة', 'مصنع', 'ورشة',
  'محطة وقود', 'مركز خدمة سيارات', 'مزرعة', 'مجزر', 'أخرى',
];
