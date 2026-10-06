import { z } from "zod";

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));
const optDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a valid date");

/** Validation for the production create/edit form. */
export const productionSchema = z
  .object({
    title: z.string().trim().min(1, "Required").max(200),
    subtitle: optText(200),
    description: optText(4000),
    venue: optText(200),
    defaultLocation: optText(200),
    firstRehearsal: optDate,
    openingDate: optDate,
    closingDate: optDate,
    status: z.enum(["planning", "auditions", "rehearsals", "performances", "closed"]),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a color"),
  })
  .refine((v) => !v.openingDate || !v.closingDate || v.closingDate >= v.openingDate, {
    message: "Closing must be on or after opening",
    path: ["closingDate"],
  });
