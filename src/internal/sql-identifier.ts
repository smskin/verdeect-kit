// quoteIdentifier — экранирование идентификаторов PostgreSQL без pg (KT-20 п. 1; алгоритм escapeIdentifier pg:
// двойные кавычки по краям, внутренняя `"` удваивается).

/**
 * Идентификатор SQL в двойных кавычках: `bff-app` → `"bff-app"`, внутренняя `"` удваивается.
 * @throws {TypeError} пустое имя или символ NUL.
 */
export function quoteIdentifier(name: string): string {
    if (name === '' || name.includes('\0')) {
        throw new TypeError('quoteIdentifier: пустое имя или символ NUL');
    }

    return `"${name.replaceAll('"', '""')}"`;
}
