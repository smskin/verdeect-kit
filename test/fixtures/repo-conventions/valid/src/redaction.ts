// Набор редактирования сервиса (комментарий с import x from './y.js' не проверяется)
import type { KitRedaction } from '@verdeect/kit/observability';
export const redaction: KitRedaction = { sensitiveKeys: ['inn'] };
