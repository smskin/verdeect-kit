// Загрузка опционального peer с текстом ошибки AC-1.2 (prd.md §3, NFR-3; ARCHITECTURE.md «Правила зависимостей»).
// Вызывается top-level await в модуле подпути: статический импорт отсутствующего пакета упал бы при связывании ESM
// с ERR_MODULE_NOT_FOUND до любого кода.

type Importer = (specifier: string) => Promise<unknown>;

/** Текст ошибки AC-1.2. */
export function missingPeerMessage(library: string, subpath: string): string {
    return `@verdeect/kit/${subpath} требует ${library} — добавьте в зависимости сервиса`;
}

/** Не найден сам пакет library; отсутствующая вложенная зависимость peer называет другой пакет. */
function isMissingPackage(error: unknown, library: string): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return false;
    }
    if (error.code !== 'ERR_MODULE_NOT_FOUND') {
        return false;
    }
    const message = 'message' in error ? String(error.message) : '';

    return message.includes(`'${library}'`) || message.includes(`"${library}"`);
}

/** Загружает peer через importer; отсутствие самого пакета → ошибка AC-1.2, прочее — как есть. */
export async function loadPeerWith<T>(
    importer: Importer,
    library: string,
    subpath: string,
): Promise<T> {
    try {
        return (await importer(library)) as T;
    } catch (error) {
        if (isMissingPackage(error, library)) {
            throw new Error(missingPeerMessage(library, subpath), { cause: error });
        }
        throw error;
    }
}

/** Опциональный peer подпути; вызывается top-level await в модуле подпути. */
export function loadPeer<T>(library: string, subpath: string): Promise<T> {
    return loadPeerWith<T>((specifier) => import(specifier), library, subpath);
}
