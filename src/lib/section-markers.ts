/**
 * Markers an editor puts in its markup so the collapsible section around it can react: a section
 * containing a validation error opens itself, and a closed section mentions unsaved changes.
 */
export const VALIDATION_ERROR_ATTRIBUTE = "data-validation-error";
export const UNSAVED_CHANGES_ATTRIBUTE = "data-unsaved-changes";

/** Spread onto an element that shows a validation error. */
export const validationErrorProps = { [VALIDATION_ERROR_ATTRIBUTE]: "" } as const;
