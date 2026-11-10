// AC-1.2 (C): без опциональных peer /config и /observability импортируются, /testing падает с текстом AC-1.2.
const results = [];
for (const subpath of ['config', 'observability']) {
    try {
        await import(`@verdeect/kit/${subpath}`);
        results.push(`${subpath}:ok`);
    } catch (error) {
        results.push(`${subpath}:${error?.code ?? error}`);
    }
}
try {
    await import('@verdeect/kit/testing');
    results.push('testing:ok');
} catch (error) {
    results.push(`testing:${error?.message ?? error}`);
}
console.log(results.join('\n'));
