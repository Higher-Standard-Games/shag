/**
 * Moved to shared/net/GameState (QA-3 / QA-WO8): the snapshot state shape is
 * part of the wire contract, so shared code (DemoReader etc.) can use it
 * without importing upward into engine. This shim keeps existing engine-path
 * importers working; new code should import from shared/net directly.
 */
export * from "../../../shared/net/GameState";
