/**
 * Moved to shared/net/BinaryProtocol (QA-3 / QA-WO8): the wire codec is the
 * deterministic core's contract (demos, input sanitation, server, client all
 * speak it), so it lives in shared and engine imports DOWNWARD. This shim keeps
 * existing engine-path importers working; new code should import from
 * shared/net directly.
 */
export * from "../../../shared/net/BinaryProtocol";
