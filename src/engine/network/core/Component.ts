/**
 * Moved to shared/net/Component (QA-3 / QA-WO8): the wire component contract is
 * part of the deterministic shared core, so shared code can use it without
 * importing upward into engine. This shim keeps existing engine-path importers
 * working; new code should import from shared/net directly.
 */
export * from "../../../shared/net/Component";
