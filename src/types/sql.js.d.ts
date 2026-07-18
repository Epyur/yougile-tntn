declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }
  interface Database {
    run(sql: string, params?: any[]): Database;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    close(): void;
  }
  interface QueryExecResult {
    columns: string[];
    values: any[][];
  }
  interface Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    getAsObject(params?: any[]): Record<string, any>;
    free(): boolean;
  }
  interface InitSqlJsOptions {
    locateFile?: (file: string) => string;
    wasmBinary?: ArrayBuffer;
  }
  export default function initSqlJs(opts?: InitSqlJsOptions): Promise<SqlJsStatic>;
}
