// Точка входа @verdeect/kit/testing (prd.md §3.8, E1): явный список экспортов; только условие development (NFR-4).
export { TEST_IMAGES } from './images.js';
export { startTestStack } from './start-test-stack.js';
export { tcpProxy } from './tcp-proxy.js';
export type { TcpProxy } from './tcp-proxy.js';
export { TEST_TIMEOUT_SCALE } from './timeout-scale.js';
export { assertRepoConventions } from './repo-conventions.js';
export { timingGuard } from './timing-guard.js';
