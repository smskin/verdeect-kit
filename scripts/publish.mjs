// Публикация из CI по тегу (prd.md AC-1.10, NFR-6, G13); образец — verdeect-platform-client scripts/publish.mjs.
// docs/releasing.md. generic: скрипт выпуска, только stdlib. До npm publish сверяет тег с version и проверяет, что версии нет в npm;
// при любой неопределённости падает и ничего не публикует. Флаг --dry-run передаётся в npm publish.
// Метка npm (G14, AC-1.10): v<x.y.z>-rc.<N> → next, v<x.y.z> → latest, другой суффикс — отказ.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
const RC_TAG_PATTERN = /^v\d+\.\d+\.\d+-rc\.[1-9]\d*$/;
const SUFFIX_TAG_PATTERN = /^v\d+\.\d+\.\d+-.+$/;
const ROOT = join(import.meta.dirname, '..');

function log(message) {
    console.log(`[publish] ${message}`);
}

function fail(message) {
    console.error(`[publish] ${message}`);
    process.exit(1);
}

function readManifest() {
    return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
}

function npm(args) {
    log(`npm ${args.join(' ')}`);

    return spawnSync('npm', args, { cwd: ROOT, encoding: 'utf8' });
}

/** true — версия опубликована, false — E404; иначе падение: без ответа реестра не публикуем. */
function isPublished(name, version) {
    const result = npm(['view', `${name}@${version}`, 'version', '--json']);
    if (result.error) {
        fail(`npm view не запустился: ${result.error.message}`);
    }
    if (result.status === 0) {
        const published = result.stdout.trim().length > 0;
        log(`npm view: ${published ? 'версия найдена' : 'пустой ответ — версии нет'}`);

        return published;
    }
    if (`${result.stdout}\n${result.stderr}`.includes('E404')) {
        log('npm view: E404 — версии нет');

        return false;
    }

    return fail(`npm view завершился с кодом ${result.status}:\n${result.stderr.trim()}`);
}

const dryRun = process.argv.includes('--dry-run');
const tag = process.env.GITHUB_REF_NAME ?? '';
log(`тег ${tag || '(пусто)'}, dry-run ${dryRun}`);

if (tag === '') {
    fail('GITHUB_REF_NAME не задан');
}
if (SUFFIX_TAG_PATTERN.test(tag) && !RC_TAG_PATTERN.test(tag)) {
    fail(
        `тег ${tag}: суффикс не поддерживается — только -rc.<N> (метка next) или без суффикса (latest)`,
    );
}
if (!TAG_PATTERN.test(tag) && !RC_TAG_PATTERN.test(tag)) {
    fail(
        `тег ${tag} не соответствует шаблону v<major>.<minor>.<patch> или v<major>.<minor>.<patch>-rc.<N>`,
    );
}
const distTag = RC_TAG_PATTERN.test(tag) ? 'next' : 'latest';
log(`метка npm: ${distTag}`);

const { name, version } = readManifest();
log(`${name} version ${version}`);
if (tag !== `v${version}`) {
    fail(`тег ${tag} не совпадает с version ${version}`);
}
if (isPublished(name, version)) {
    fail(`версия ${version} уже опубликована, перезапись запрещена`);
}

const publishArgs = [
    'publish',
    '--access',
    'public',
    '--tag',
    distTag,
    ...(dryRun ? ['--dry-run'] : []),
];
log(`решение: публикуем ${name}@${version}`);
// Авторизация — только OIDC (Trusted Publishing, id-token: write): токенов в CI нет (prd.md NFR-6, G13).
log('авторизация: OIDC (Trusted Publishing)');
log(`npm ${publishArgs.join(' ')}`);
const result = spawnSync('npm', publishArgs, { cwd: ROOT, stdio: 'inherit' });
log(`npm ${publishArgs.join(' ')} завершился с кодом ${result.status}`);
process.exit(result.status ?? 1);
