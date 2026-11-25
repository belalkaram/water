import type { ComplianceAnswer, ViolationLevel, VisitOutcome } from './constants';

export type UserRole = 'admin' | 'worker';

export interface User {
  id: string;
  name: string;
  code: string;
  role: UserRole;
  active?: number;
  home_center?: string;
  assigned_centers?: string[];
}

export interface MonthlyPlan {
  id: string;
  month_label: string;
  filename: string;
  uploaded_by: string;
  total_facilities: number;
  created_at: string;
  plan_month?: string | null;
}

export interface SampleItem {
  id: string;
  code?: string;
  name: string;
  type: string;
  count: number;
  ph?: number | null;
  temperature?: number | null;
}

export interface Inspection {
  id: string;
  facility_id: string;
  plan_id: string;
  worker_id: string;
  worker_name: string;
  samples: SampleItem[];
  notes: string;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy?: number | null;
  signature_base64: string;
  created_at: string;
  client_id?: string;
  visit_outcome?: VisitOutcome;
  compliance?: Record<string, ComplianceAnswer>;
  violation_level?: ViolationLevel;
  representative_name?: string;
  representative_phone?: string;
  /** يوم المعاينة وسحب العينة كما كتبه الموظف (YYYY-MM-DD) */
  visit_date?: string;
}

export interface FacilityHistory {
  visits: number;
  worst: ViolationLevel;
  last_at: string;
}

export type FacilityStatus = 'available' | 'reserved' | 'completed';

export interface Facility {
  id: string;
  plan_id: string;
  serial_no: number;
  name: string;
  address: string;
  center: string;
  facility_code: string;
  target_date: string;
  plan_notes: string;
  status: FacilityStatus;
  reserved_by_id?: string | null;
  reserved_by_name?: string | null;
  reserved_at?: string | null;
  completed_by_id?: string | null;
  completed_by_name?: string | null;
  completed_at?: string | null;
  activity_type?: string;
  visit_outcome?: VisitOutcome | '';
  history?: FacilityHistory | null;
  /** لو الصف مرحّل من خطة سابقة: شهرها YYYY-MM */
  carried_from?: string;
  last_visit_date?: string;
  inspection?: Inspection | null;
}

export interface ActivityItem {
  id: string;
  plan_id: string;
  facility_id?: string | null;
  facility_name: string;
  center: string;
  worker_id: string;
  worker_name: string;
  action: 'reserved' | 'released' | 'expired' | 'completed' | 'unlocked' | 'plan_uploaded' | 'rejected' | 'carried_over';
  summary: string;
  created_at: string;
}

export interface PlanStats {
  plan: MonthlyPlan;
  totals: { total: number; completed: number; reserved: number; available: number; completion_rate: number };
  by_center: { center: string; total: number; completed: number; reserved: number }[];
  by_activity: { activity_type: string; total: number; completed: number }[];
  by_worker: { worker_name: string; visits: number; samples: number }[];
  outcomes: Record<string, number>;
  violation_levels: Record<ViolationLevel, number>;
  total_samples: number;
  sample_types: { type: string; count: number }[];
  compliance_failures: { key: string; label: string; count: number }[];
}

export type ReportState = 'done' | 'in_progress' | 'pending' | 'failed';

export interface ReportRow {
  n: number;
  name: string;
  code: string;
  address: string;
  center: string;
  last_visit: string;
  status: string;
  state: ReportState;
  carried: boolean;
}

/** تقرير الخطة: الأعمدة الستة (اسم المنشأة، الكود، العنوان، المدينة، تاريخ آخر معاينة، حالة الخطة) */
export interface PlanReport {
  company: string;
  title: string;
  plan_month: string;
  scope_label: string;
  exported_at: string;
  columns: { key: string; header: string }[];
  rows: ReportRow[];
  summary: { total: number; done: number; in_progress: number; pending: number; carried: number; rate: number };
  file_name: string;
}

export interface ConflictItem {
  id: string;
  facility_name: string;
  center: string;
  worker_name: string;
  completed_by_name: string;
  created_at: string;
  samples: SampleItem[];
  notes: string;
}
