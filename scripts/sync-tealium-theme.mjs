import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function configBlock(source) {
    const start = source.indexOf('/* TEALIUM_CONFIG_START */');
    const end = source.indexOf('/* TEALIUM_CONFIG_END */', start);
    if (start < 0 || end < 0) throw new Error('Missing Tealium configuration markers');
    return source.slice(start, end);
}

export function synchronizeThemeConfiguration(pixel, theme) {
    const sourceConfig = configBlock(pixel);
    const themeConfig = configBlock(theme);
    let updated = themeConfig;
    // The theme keeps only the connection settings it actually uses.
    for (const [, key] of themeConfig.matchAll(/^\s*(\w+):[^\n]+/gm)) {
        const pattern = new RegExp('^[ \\t]*' + key + ':[^\\n]+', 'm');
        const value = sourceConfig.match(pattern)?.[0];
        if (!value) throw new Error('Missing Pixel configuration: ' + key);
        updated = updated.replace(pattern, value);
    }
    return theme.replace(themeConfig, updated);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const pixel = await readFile(new URL('../shopify/web-pixel.js', import.meta.url), 'utf8');
    const themeUrl = new URL('../shopify/theme-liquid.html', import.meta.url);
    const theme = await readFile(themeUrl, 'utf8');
    const updated = synchronizeThemeConfiguration(pixel, theme);
    if (process.argv.includes('--check')) {
        if (updated !== theme) throw new Error('Theme connection settings differ. Run sync-tealium-theme.mjs.');
    } else if (updated !== theme) await writeFile(themeUrl, updated);
}
