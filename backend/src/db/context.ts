import { AsyncLocalStorage } from 'node:async_hooks';

export interface DbContext {
  orgId?: number;
  userId?: number;
  mode?: 'login' | 'bootstrap';
}

export const dbContext = new AsyncLocalStorage<DbContext>();

export function withDbContext<T>(context: DbContext, fn: () => Promise<T>): Promise<T> {
  return dbContext.run(context, fn);
}

export function enterDbContext(context: DbContext): void {
  dbContext.enterWith(context);
}

export function currentDbContext(): DbContext {
  return dbContext.getStore() ?? {};
}
