import { pgSchema } from 'drizzle-orm/pg-core';
console.log('x'); // expect: no-console
export const a = pgSchema('identity'); // expect: no-restricted-syntax
export const b = schemas.pgSchema('platform'); // expect: no-restricted-syntax
export const c = 'orchestrator.outbox'; // expect: no-restricted-syntax
export const d = `bff.${'x'}`; // expect: no-restricted-syntax
declare const schemas: { pgSchema(name: string): unknown };
