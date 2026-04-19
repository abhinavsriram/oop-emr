const { z } = require('zod');

const vitalsRowSchema = z.object({
  time: z.string(),
  hr: z.number(),
  sbp: z.number(),
  dbp: z.number(),
  spo2: z.number(),
  rr: z.number(),
});

const tlItemSchema = z.object({
  time: z.string(),
  description: z.string(),
});

const patientSchema = z.object({
  estimated_age: z.string(),
  sex: z.string(),
  mrn: z.string(),
});

const commonFields = {
  encounter_id: z.string().min(1),
  timestamp: z.string(),
  patient: patientSchema,
  mechanism: z.string().optional(),
  primary_diagnosis: z.string().optional(),
  trauma_level: z.number().int().optional(),
  vitals_timeline: z.array(vitalsRowSchema).optional(),
  procedures: z.array(tlItemSchema).optional(),
  medications: z.array(tlItemSchema).optional(),
  resuscitation_events: z.array(tlItemSchema).optional(),
  images: z.array(z.string()).optional(),
  clinical_note: z.string().optional(),
  icd10_codes: z.array(z.string()).optional(),
  ais_score: z.number().optional(),
  hospital_notification_summary: z.string().optional(),
  transcript: z.string().optional(),
  status: z.string().optional(),
};

const initialPayloadSchema = z.object({
  event_type: z.literal('initial'),
  ...commonFields,
});

const updatePayloadSchema = z.object({
  event_type: z.literal('update'),
  ...commonFields,
});

const payloadSchema = z.discriminatedUnion('event_type', [
  initialPayloadSchema,
  updatePayloadSchema,
]);

module.exports = {
  payloadSchema,
  initialPayloadSchema,
  updatePayloadSchema,
  vitalsRowSchema,
  tlItemSchema,
  patientSchema,
};
