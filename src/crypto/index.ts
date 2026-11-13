// Точка входа @verdeect/kit/crypto (prd.md §3.6, E7): явный список экспортов; только node:crypto, zod и config/fragments.
export { createCipher, DecryptError, deriveKeys, generateSecret } from './cipher.js';
export type { DecryptErrorReason, KitCipher, KitCipherOptions, KitDerivedKey } from './cipher.js';
