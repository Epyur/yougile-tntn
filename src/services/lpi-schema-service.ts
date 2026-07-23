import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { requestUrl } from 'obsidian';

export interface ColumnDef {
  cid: number;
  name: string;
  type: string;
  notnull: boolean;
  dflt_value: string | null;
  pk: boolean;
}

export interface ForeignKeyDef {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

export interface TableDef {
  name: string;
  sql: string;
  columns: ColumnDef[];
  foreignKeys: ForeignKeyDef[];
}

export interface SchemaDb {
  tables: TableDef[];
  byName: Map<string, TableDef>;
}

export class LpiSchemaService {
  private wasmBinary: ArrayBuffer | null = null;

  async getWasmBinary(): Promise<ArrayBuffer> {
    if (this.wasmBinary) return this.wasmBinary;
    const wasmPath = path.join(__dirname, 'sql-wasm.wasm');
    try {
      const buf = fs.readFileSync(wasmPath);
      this.wasmBinary = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return this.wasmBinary;
    } catch {
      const url = 'https://raw.githubusercontent.com/Epyur/yougile-tntn/main/sql-wasm.wasm';
      const resp = await requestUrl({ url });
      this.wasmBinary = resp.arrayBuffer;
      try { fs.writeFileSync(wasmPath, Buffer.from(resp.arrayBuffer)); } catch {}
      return this.wasmBinary;
    }
  }

  async openDb(dbPath: string): Promise<any> {
    const wasmBinary = await this.getWasmBinary();
    const SQL = await initSqlJs({ wasmBinary: wasmBinary.slice(0) });
    const dbBuf = fs.readFileSync(dbPath);
    const db = new SQL.Database(new Uint8Array(dbBuf));
    return { db, SQL };
  }

  async loadSchema(dbPath: string): Promise<SchemaDb> {
    const { db } = await this.openDb(dbPath);
    try {
      const tablesResult = db.exec(`SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
      const tables: TableDef[] = [];
      const byName = new Map<string, TableDef>();

      for (const row of tablesResult[0]?.values || []) {
        const name = row[0] as string;
        const sqlCreate = (row[1] as string) || '';
        const colsResult = db.exec(`PRAGMA table_info('${name.replace(/'/g, "''")}')`);
        const columns: ColumnDef[] = (colsResult[0]?.values || []).map((col: any[]) => ({
          cid: col[0] as number,
          name: col[1] as string,
          type: col[2] as string,
          notnull: col[3] === 1,
          dflt_value: col[4] as string | null,
          pk: col[5] === 1,
        }));

        const fkResult = db.exec(`PRAGMA foreign_key_list('${name.replace(/'/g, "''")}')`);
        const foreignKeys: ForeignKeyDef[] = (fkResult[0]?.values || []).map((fk: any[]) => ({
          id: fk[0] as number,
          seq: fk[1] as number,
          table: fk[2] as string,
          from: fk[3] as string,
          to: fk[4] as string,
          on_update: fk[5] as string,
          on_delete: fk[6] as string,
          match: fk[7] as string,
        }));

        const td: TableDef = { name, sql: sqlCreate, columns, foreignKeys };
        tables.push(td);
        byName.set(name, td);
      }
      return { tables, byName };
    } finally {
      db.close();
    }
  }

  async runQuery(dbPath: string, sql: string): Promise<{ columns: string[]; rows: any[][] }> {
    const { db } = await this.openDb(dbPath);
    try {
      const result = db.exec(sql);
      if (!result || result.length === 0) {
        return { columns: [], rows: [] };
      }
      return {
        columns: result[0].columns,
        rows: result[0].values,
      };
    } finally {
      db.close();
    }
  }
}
