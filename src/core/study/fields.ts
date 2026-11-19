/**
 * Broad fields of study, so the 3D knowledge graph can put related subjects near each other (owner 2026-11-19:
 * "algorithms and operating systems should be closer than English or history"). Each field owns a direction on the
 * sphere; neighbouring fields in FIELDS are neighbours on the sphere (computing ↔ mathematics ↔ engineering ↔ …
 * ↔ languages ↔ arts ↔ computing closes the ring). Pure.
 */

export const FIELDS = ["computing", "mathematics", "engineering", "natural sciences", "health", "business", "social sciences", "humanities", "languages", "arts"] as const;
export type Field = (typeof FIELDS)[number];

export const isField = (v: unknown): v is Field => typeof v === "string" && (FIELDS as readonly string[]).includes(v);

/** The field's direction: the fields sit round a tilted ring, in FIELDS order, so related fields are adjacent. */
export function fieldDirection(field: Field): [number, number, number] {
	const i = FIELDS.indexOf(field);
	const a = (2 * Math.PI * i) / FIELDS.length;
	const tilt = 0.45; // a wavy ring (not a flat circle) so the globe reads as 3D
	const x = Math.cos(a), z = Math.sin(a), y = Math.sin(a * 2) * tilt;
	const l = Math.hypot(x, y, z);
	return [x / l, y / l, z / l];
}

const KEYWORDS: Array<[Field, RegExp]> = [
	["computing", /\b(algorithm|comput|program|software|operating system|\bos\b|network|database|data structure|machine learning|\bai\b|artificial intelligence|cyber|web|compiler|distributed|cloud|coding|\bcs\b)/i],
	["mathematics", /\b(math|algebra|calculus|geometry|statistic|probabilit|linear|discrete|topology|number theory|analysis|combinator|optimi[sz]ation)/i],
	["engineering", /\b(engineer|electrical|electronic|mechanic|circuit|signal|control system|robot|civil|thermodynamic|materials)/i],
	["natural sciences", /\b(physics|chemistry|biology|astronom|geolog|ecolog|genetic|quantum|organic|science)/i],
	["health", /\b(medic|anatom|physiolog|nurs|pharma|health|clinical|neuro|patholog)/i],
	["business", /\b(business|econom|financ|account|market|management|strateg|entrepreneur)/i],
	["social sciences", /\b(psycholog|sociolog|politic|law|anthropolog|government|education|criminolog)/i],
	["humanities", /\b(history|philosoph|religio|ethic|classics|literature|archaeolog|culture)/i],
	["languages", /\b(english|french|spanish|german|hindi|japanese|chinese|mandarin|latin|grammar|language|linguistic|vocabulary|writing)/i],
	["arts", /\b(art|music|design|drawing|paint|film|theat|photograph|architecture|dance)/i],
];

/** A quick guess from the subject's name (used until the model's answer arrives, and when no model is set up). */
export function guessField(name: string): Field | undefined {
	for (const [field, re] of KEYWORDS) if (re.test(name)) return field;
	return undefined;
}
