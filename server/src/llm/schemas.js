// JSON Schemas passed to `claude --json-schema`, derived from what the callers actually read
// (index.js letter/answers routes, cv-tailor.js validateProposal). Kept minimal and permissive:
// callers still validate and clamp everything. No `&|<>^%` characters (cmd.exe quoting).
const str = { type: 'string' };
const strings = { type: 'array', items: str };

export const SCHEMAS = {
  // POST /applications/:id/letter
  letter: {
    type: 'object',
    properties: {
      language: { type: 'string', enum: ['fr', 'en'] },
      company: str,
      jobTitle: str,
      subject: str,
      recipient: str,
      location: str,
      body: str,
      highlights: strings,
      warnings: strings,
    },
    required: ['body'],
  },
  // POST /answers : { answers: { fieldId: { value, confidence, note } } }
  answers: {
    type: 'object',
    properties: {
      answers: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            value: { type: ['string', 'number', 'boolean', 'array', 'null'] },
            confidence: { type: 'number' },
            note: str,
          },
          required: ['value'],
        },
      },
    },
    required: ['answers'],
  },
  // tailorCv : { about, skills: [{ label, items }], keywords, warnings }
  tailor: {
    type: 'object',
    properties: {
      about: str,
      skills: { type: 'array', items: { type: 'object', properties: { label: str, items: strings }, required: ['label', 'items'] } },
      keywords: strings,
      warnings: strings,
    },
    required: ['about', 'skills'],
  },
};

export const schemaFor = (task, schema) => schema ?? SCHEMAS[task] ?? null;
