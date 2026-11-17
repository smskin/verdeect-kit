// Разбор ошибки окружения для всех команд CLI (prd.md §3.1 v1.35, AC-1.3; ARCHITECTURE «CLI»): JSON
// {code: 'INVALID_ENVIRONMENT', message, keys, issues}, без значений. Статический импорт parse-env.js — файл без peer.
import { InvalidEnvironmentError, type KitEnvironmentIssue } from '../config/parse-env.js';

/** JSON ошибки окружения команды CLI. */
export interface EnvironmentFailure {
    /** Код ошибки. */
    readonly code: 'INVALID_ENVIRONMENT';
    /** Общий текст. */
    readonly message: string;
    /** Пути ключей; без пути — `(root)`. */
    readonly keys: readonly string[];
    /** Тексты схемы после страховки `parseEnv`. */
    readonly issues: readonly KitEnvironmentIssue[];
}

/** JSON ошибки для `InvalidEnvironmentError`, иначе `undefined` — команда разбирает ошибку сама. */
export function environmentFailure(error: unknown): EnvironmentFailure | undefined {
    if (!(error instanceof InvalidEnvironmentError)) {
        return undefined;
    }

    return {
        code: 'INVALID_ENVIRONMENT',
        message: 'Неверное окружение',
        keys: error.keys,
        issues: error.issues,
    };
}
