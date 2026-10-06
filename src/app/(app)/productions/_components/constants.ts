/** Labels shared by production pages (safe for client and server). */

export const STATUS_OPTIONS = [
  { value: "planning", label: "Planning" },
  { value: "auditions", label: "Auditions" },
  { value: "rehearsals", label: "In rehearsal" },
  { value: "performances", label: "Performing" },
  { value: "closed", label: "Closed" },
] as const;

export const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s.label]));

export const ROLE_KINDS = [
  { value: "lead", label: "Leads" },
  { value: "supporting", label: "Supporting" },
  { value: "featured", label: "Featured" },
  { value: "ensemble", label: "Ensemble" },
] as const;

export const ROLE_KIND_SINGULAR: Record<string, string> = {
  lead: "Lead",
  supporting: "Supporting",
  featured: "Featured",
  ensemble: "Ensemble",
};

export const ASSIGNMENT_KINDS = [
  { value: "primary", label: "Primary" },
  { value: "understudy", label: "Understudy" },
  { value: "swing", label: "Swing" },
] as const;

/** "understudy" → "Understudy" (never show the raw enum). */
export const kindLabel = (kind: string) => ASSIGNMENT_KINDS.find((k) => k.value === kind)?.label ?? kind;

export const CREATIVE_TITLES = [
  "Director",
  "Assistant Director",
  "Music Director",
  "Choreographer",
  "Stage Manager",
  "Vocal Coach",
  "Producer",
];

/** Swatches for accent colors and role groups. */
export const COLOR_SWATCHES = [
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#ea580c",
  "#d97706",
  "#65a30d",
  "#059669",
  "#0891b2",
  "#2563eb",
  "#4f46e5",
  "#475569",
];

/** Resource link kinds (mirrors RESOURCE_KINDS in lib/production-queries). */
export const RESOURCE_KIND_OPTIONS = [
  { value: "script", label: "Script / sheet music" },
  { value: "track", label: "Track (audio)" },
  { value: "video", label: "Video" },
  { value: "doc", label: "Document" },
  { value: "link", label: "Other link" },
] as const;

export const RESOURCE_KIND_LABEL: Record<string, string> = {
  script: "Script",
  track: "Track",
  video: "Video",
  doc: "Doc",
  link: "Link",
};
