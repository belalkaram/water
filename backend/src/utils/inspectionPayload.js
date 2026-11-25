const {
  VISIT_OUTCOMES, VIOLATION_LEVELS, COMPLIANCE_ANSWERS, COMPLIANCE_KEYS, VISIT_DATE_MAX_AGE_DAYS,
} = require('../constants');

// Local (Egypt) calendar date as YYYY-MM-DD
function todayYmd(d = new Date()) {
  return new Date(d.getTime() + 2 * 3600 * 1000).toISOString().slice(0, 10);
}

function isValidYmd(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// Validates the inspection day typed by the worker. Returns { value } or { error }.
// `reference` = when the inspection was recorded on the device (offline sync may arrive later).
function checkVisitDate(raw, reference) {
  const v = cleanText(raw, 10);
  if (!isValidYmd(v)) return { error: 'اكتب تاريخ المعاينة (يوم سحب العينة) بصيغة صحيحة' };
  const ref = reference ? new Date(reference) : new Date();
  const refDay = todayYmd(Number.isNaN(ref.getTime()) ? new Date() : ref);
  // allow one day of slack for device clock / timezone differences
  const maxDay = todayYmd(new Date(Math.max(Date.now(), ref.getTime() || 0) + 24 * 3600 * 1000));
  if (v > maxDay) return { error: 'تاريخ المعاينة لا يمكن أن يكون في المستقبل' };
  const minDay = todayYmd(new Date(new Date(`${refDay}T12:00:00Z`).getTime() - VISIT_DATE_MAX_AGE_DAYS * 24 * 3600 * 1000));
  if (v < minDay) return { error: `تاريخ المعاينة أقدم من ${VISIT_DATE_MAX_AGE_DAYS} يوماً — راجع التاريخ المكتوب` };
  return { value: v };
}

function cleanText(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}

function cleanNumberOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Validates + normalizes an inspection payload coming from the app (online or from the sync queue).
// Returns { ok: true, value } or { ok: false, error }.
function normalizePayload(body, facility, { recordedAt } = {}) {
  const outcome = VISIT_OUTCOMES.includes(body.visit_outcome) ? body.visit_outcome : 'inspected';
  const notes = cleanText(body.notes, 2000);

  const rawSamples = Array.isArray(body.samples) ? body.samples : [];
  const samples = rawSamples
    .map((s, i) => ({
      id: cleanText(s.id, 60) || `s${i + 1}`,
      code: cleanText(s.code, 40) || `${facility.facility_code}-S${i + 1}`,
      name: cleanText(s.name, 120),
      type: cleanText(s.type, 120),
      count: Math.max(0, parseInt(s.count, 10) || 0),
      ph: cleanNumberOrNull(s.ph),
      temperature: cleanNumberOrNull(s.temperature),
    }))
    .filter((s) => s.name && s.type && s.count > 0);

  if (outcome === 'inspected' && samples.length === 0) {
    return { ok: false, error: 'أضف عينة واحدة على الأقل قبل تأكيد المعاينة' };
  }
  if (outcome !== 'inspected' && !notes) {
    return { ok: false, error: 'اكتب سبب عدم إتمام المعاينة في الملاحظات' };
  }
  let visitDate = '';
  if (outcome === 'inspected') {
    const fallback = body.visit_date ? body.visit_date : todayYmd(recordedAt ? new Date(recordedAt) : new Date());
    const vd = checkVisitDate(fallback, recordedAt);
    if (vd.error) return { ok: false, error: vd.error };
    visitDate = vd.value;
  } else if (body.visit_date && isValidYmd(cleanText(body.visit_date, 10))) {
    visitDate = cleanText(body.visit_date, 10);
  }
  for (const s of samples) {
    if (s.ph !== null && (s.ph < 0 || s.ph > 14)) {
      return { ok: false, error: `قيمة pH غير منطقية في عينة ${s.name} (يجب أن تكون بين 0 و 14)` };
    }
  }

  const compliance = {};
  const rawCompliance = body.compliance && typeof body.compliance === 'object' ? body.compliance : {};
  for (const key of COMPLIANCE_KEYS) {
    const a = rawCompliance[key];
    if (COMPLIANCE_ANSWERS.includes(a)) compliance[key] = a;
  }

  const violationLevel = VIOLATION_LEVELS.includes(body.violation_level) ? body.violation_level : 'none';

  return {
    ok: true,
    value: {
      client_id: cleanText(body.client_id, 80),
      visit_outcome: outcome,
      samples,
      notes,
      compliance,
      violation_level: violationLevel,
      representative_name: cleanText(body.representative_name, 120),
      representative_phone: cleanText(body.representative_phone, 30),
      visit_date: visitDate,
      gps_lat: cleanNumberOrNull(body.gps_lat),
      gps_lng: cleanNumberOrNull(body.gps_lng),
      gps_accuracy: cleanNumberOrNull(body.gps_accuracy),
      signature_base64: typeof body.signature_base64 === 'string' ? body.signature_base64 : '',
    },
  };
}

// Old inspections may carry checklist items that were removed (discharge permit, sampling point)
function pickKnownCompliance(obj) {
  const out = {};
  for (const k of COMPLIANCE_KEYS) if (obj && obj[k]) out[k] = obj[k];
  return out;
}

function hydrateInspection(row) {
  if (!row) return null;
  return {
    ...row,
    samples: JSON.parse(row.samples_json || '[]'),
    compliance: pickKnownCompliance(JSON.parse(row.compliance_json || '{}')),
    visit_date: row.visit_date || String(row.created_at || '').slice(0, 10),
    followup_required: undefined,
    followup_date: undefined,
  };
}

module.exports = { normalizePayload, hydrateInspection, todayYmd, isValidYmd };
