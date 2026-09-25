import { createDb, type Db, type DbHandle } from '@zaboon/db'
import { serverEnv } from './env'

// One pool per server process; kept on globalThis so dev hot reloads don't leak connections.
const holder = globalThis as typeof globalThis & { __zaboonDb?: DbHandle }

export function getDb(): Db {
  holder.__zaboonDb ??= createDb(serverEnv().databaseUrl, { max: 10 })
  return holder.__zaboonDb.db
}
