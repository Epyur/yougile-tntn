import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { requestUrl } from 'obsidian';
import { errorMessage } from '../utils/errors';

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

/** Приводит значение ячейки PRAGMA к числу (0, если значение не числовое). */
function asNumber(v: SqlValue): number {
  return typeof v === 'number' ? v : Number(v ?? 0) || 0;
}

/** Приводит значение ячейки PRAGMA к строке (пустая строка для NULL). */
function asText(v: SqlValue): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : String(v);
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
      try {
        fs.writeFileSync(wasmPath, Buffer.from(resp.arrayBuffer));
      } catch (e: unknown) {
        console.error('LPI Schema: не удалось закэшировать sql-wasm.wasm:', errorMessage(e));
      }
      return this.wasmBinary;
    }
  }

  async openDb(dbPath: string): Promise<{ db: Database; SQL: SqlJsStatic }> {
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
        const columns: ColumnDef[] = (colsResult[0]?.values || []).map(col => ({
          cid: asNumber(col[0]),
          name: asText(col[1]),
          type: asText(col[2]),
          notnull: col[3] === 1,
          dflt_value: typeof col[4] === 'string' ? col[4] : null,
          pk: col[5] === 1,
        }));

        const fkResult = db.exec(`PRAGMA foreign_key_list('${name.replace(/'/g, "''")}')`);
        const foreignKeys: ForeignKeyDef[] = (fkResult[0]?.values || []).map(fk => ({
          id: asNumber(fk[0]),
          seq: asNumber(fk[1]),
          table: asText(fk[2]),
          from: asText(fk[3]),
          to: asText(fk[4]),
          on_update: asText(fk[5]),
          on_delete: asText(fk[6]),
          match: asText(fk[7]),
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

  async runQuery(dbPath: string, sql: string): Promise<{ columns: string[]; rows: SqlValue[][] }> {
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
