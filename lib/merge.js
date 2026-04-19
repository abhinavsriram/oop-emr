const APPEND_ARRAYS = [
  'vitals_timeline',
  'procedures',
  'medications',
  'resuscitation_events',
  'images',
];

const OVERWRITE_SCALARS = [
  'status',
  'trauma_level',
  'primary_diagnosis',
  'mechanism',
  'clinical_note',
  'icd10_codes',
  'ais_score',
  'hospital_notification_summary',
  'transcript',
];

function mergePayload(existing, delta) {
  const next = { ...existing };
  for (const k of APPEND_ARRAYS) {
    if (Array.isArray(delta[k]) && delta[k].length > 0) {
      next[k] = [...(Array.isArray(existing[k]) ? existing[k] : []), ...delta[k]];
    }
  }
  for (const k of OVERWRITE_SCALARS) {
    if (delta[k] !== undefined) next[k] = delta[k];
  }
  return next;
}

module.exports = { mergePayload, APPEND_ARRAYS, OVERWRITE_SCALARS };
