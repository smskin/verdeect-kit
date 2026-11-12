// Публичная поверхность @verdeect/kit/http (prd.md §3.5). Всё, что не перечислено, — не экспортируется.
export { bootstrapService } from './bootstrap-service.js';
export type { KitBootstrapOptions } from './bootstrap-service.js';
export { createHttpApp } from './create-http-app.js';
export type {
    KitHttpAppOptions,
    KitHttpOptions,
    KitReferrerPolicy,
    KitSecurityHeaders,
} from './create-http-app.js';
export { defineErrors, DomainError, errorBody, kitErrors } from './errors.js';
export type { KitDomainErrorOptions, KitErrorDictionary, KitErrorEntry } from './errors.js';
export { KitExceptionFilter } from './kit-exception.filter.js';
export {
    afterCursor,
    cursorTimestamp,
    decodeCursor,
    encodeCursor,
    pageOf,
    PageQuerySchema,
} from './pagination.js';
export type { Page } from './pagination.js';
export { ZodValidationPipe } from './zod-validation.pipe.js';
export { Api } from './api/api.decorator.js';
export type { KitApiOptions } from './api/api.decorator.js';
