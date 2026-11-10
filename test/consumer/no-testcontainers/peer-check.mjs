// AC-1.2 (C): без опциональных peer /config импортируется, /testing падает с текстом AC-1.2.
const results = [];
try {
    await import('@verdeect/kit/config');
    results.push('config:ok');
} catch (error) {
    results.push(`config:${error?.code ?? error}`);
}
try {
    await import('@verdeect/kit/testing');
    results.push('testing:ok');
} catch (error) {
    results.push(`testing:${error?.message ?? error}`);
}
console.log(results.join('\n'));
