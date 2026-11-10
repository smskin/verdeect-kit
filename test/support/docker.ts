// Общие помощники уровня I: контейнеры по метке startTestStack (prd.md §3.8, AC-1.12, AC-1.13).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Образы запущенных контейнеров с меткой verdeect.kit.service=<service>. */
export async function runningImages(service: string): Promise<string[]> {
    const { stdout } = await exec('docker', [
        'ps',
        '--filter',
        `label=verdeect.kit.service=${service}`,
        '--format',
        '{{.Image}}',
    ]);

    return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
}
