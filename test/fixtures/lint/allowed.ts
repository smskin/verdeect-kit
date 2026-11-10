// identity.outbox и pgSchema('identity') в комментарии не проверяются
import type { X } from 'identity.client';
export { type X };
export const name = 'kit.outbox';
export const schema = (svc: string) => pgSchemaLike(svc);
declare function pgSchemaLike(name: string): unknown;
