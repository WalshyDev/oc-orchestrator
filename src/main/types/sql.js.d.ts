declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database
  }

  interface Database {
    run(sql: string, params?: unknown[]): Database
    exec(sql: string): QueryExecResult[]
    prepare(sql: string): Statement
    export(): Uint8Array
    close(): void
  }

  interface Statement {
    bind(params?: unknown[]): boolean
    step(): boolean
    get(params?: unknown[]): unknown[]
    getColumnNames(): string[]
    free(): boolean
    run(params?: unknown[]): void
  }

  interface QueryExecResult {
    columns: string[]
    values: unknown[][]
  }

  export default function initSqlJs(): Promise<SqlJsStatic>
  export { Database, Statement, QueryExecResult }
}
