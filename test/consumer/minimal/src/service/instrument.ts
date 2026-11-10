// instrument сервиса-потребителя (AC-9.1, AC-3.11; prd.md §3.2): подключается node --import до загрузки приложения.
import { initSentry } from '@verdeect/kit/observability';

initSentry({ service: 'consumer' });
