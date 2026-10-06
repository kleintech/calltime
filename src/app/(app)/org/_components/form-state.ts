/** Result of a form Server Action used with <ActionForm>. */
export type FormState = {
  error?: string;
  ok?: string;
  /** An invite link to show with a copy/share button. */
  link?: string;
  /** Prewritten text to share with the link. */
  message?: string;
};

/** First zod issue as a friendly sentence. */
export function firstIssue(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Please check the form.";
}
