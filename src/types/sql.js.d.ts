declare module 'sql.js' {
  /** Значение, которое SQLite может вернуть в ячейке результата. */
  export type SqlValue = number | string | Uint8Array | null;

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }
  export interface Database {
    run(sql: string, params?: SqlValue[]): Database;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    close(): void;
  }
  export interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }
  export interface Statement {
    bind(params?: SqlValue[]): boolean;
    step(): boolean;
    getAsObject(params?: SqlValue[]): Record<string, SqlValue>;
    free(): boolean;
  }
  export interface InitSqlJsOptions {
    locateFile?: (file: string) => string;
    wasmBinary?: ArrayBuffer;
  }
  export default function initSqlJs(opts?: InitSqlJsOptions): Promise<SqlJsStatic>;
}
