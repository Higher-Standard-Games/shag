/**
 * The part of Node's built-in `node:sqlite` that PlayerStore uses.
 *
 * The installed @types/node predates node:sqlite (added in Node 22.5). Delete
 * this file once @types/node is 22.5 or newer, which ships the full types.
 */
declare module "node:sqlite" {
  type SQLValue = null | number | bigint | string | Uint8Array;

  interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  class StatementSync {
    run(...params: SQLValue[]): StatementResultingChanges;
    get(...params: SQLValue[]): Record<string, SQLValue> | undefined;
    all(...params: SQLValue[]): Record<string, SQLValue>[];
  }

  class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
