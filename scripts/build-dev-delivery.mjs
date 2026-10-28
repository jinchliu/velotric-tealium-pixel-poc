import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { minify } from 'terser';
import { synchronizeThemeConfiguration } from './sync-tealium-theme.mjs';

const root = new URL('../', import.meta.url);
const devMeasurementId = 'G-4FLMVWWG56';
export const CUSTOM_PIXEL_LENGTH_LIMIT = 64_000;

export async function prepareCustomPixel(source, preamble = '', compact = false) {
    // Reprint parsed JavaScript without comments; preserve names and skip optimizations.
    const { code } = await minify(source, {
        compress: false,
        mangle: false,
        format: { beautify: !compact, indent_level: 4, comments: false, preamble },
    });
    const pixel = code + '\n';
    const characters = pixel.length;
    const bytes = Buffer.byteLength(pixel, 'utf8');
    // Check the complete pasteable file, including its notice, before writing it.
    if (Math.max(characters, bytes) >= CUSTOM_PIXEL_LENGTH_LIMIT) {
        throw new Error('Custom Pixel output must be shorter than ' + CUSTOM_PIXEL_LENGTH_LIMIT
            + ' characters and UTF-8 bytes (' + characters + ' characters, ' + bytes
            + ' bytes). Reduce the source before installation.');
    }
    return pixel;
}

function configBlock(source) {
    const start = source.indexOf('/* TEALIUM_CONFIG_START */');
    const endMarker = '/* TEALIUM_CONFIG_END */';
    const end = source.indexOf(endMarker, start);
    if (start < 0 || end < 0) throw new Error('Missing Tealium configuration markers');
    return source.slice(start, end + endMarker.length);
}

export async function buildDevDelivery() {
    const [pixel, theme] = await Promise.all([
        readFile(new URL('shopify/web-pixel.js', root), 'utf8'),
        readFile(new URL('shopify/theme-liquid.html', root), 'utf8'),
    ]);
    const originalConfig = configBlock(pixel);
    if (synchronizeThemeConfiguration(pixel, theme) !== theme) throw new Error('Run sync-tealium-theme.mjs before building');
    const overrides = {
        enabled: true,
        environment: 'dev',
    };
    let devConfig = originalConfig;
    let devThemeConfig = configBlock(theme);
    for (const [key, value] of Object.entries(overrides)) {
        const pattern = new RegExp('(^[ \\t]*' + key + ':)[^\\n]+', 'm');
        if (!pattern.test(devConfig)) throw new Error('Missing configuration: ' + key);
        devConfig = devConfig.replace(pattern, '$1 ' + JSON.stringify(value) + ',');
        devThemeConfig = devThemeConfig.replace(pattern, '$1 ' + JSON.stringify(value) + ',');
    }
    const measurementPattern = /^([ \t]*measurementId:)[^\n]+/m;
    if (!measurementPattern.test(pixel)) throw new Error('Missing session-cookie measurement ID');
    const devPixel = pixel.replace(originalConfig, devConfig).replace(measurementPattern,
        '$1 ' + JSON.stringify(devMeasurementId) + ',');
    const notice = '// TEALIUM DEV POC. Tealium-only Pixel; no fixed storefront domain.';
    return {
        pixel: await prepareCustomPixel(devPixel, notice),
        minifiedPixel: await prepareCustomPixel(devPixel, notice, true),
        theme: '<!-- TEALIUM DEV POC. Tealium-only storefront integration. -->\n' + theme.replace(configBlock(theme), devThemeConfig),
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const delivery = await buildDevDelivery();
    const directory = new URL('dist/dev/', root);
    await mkdir(directory, { recursive: true });
    await Promise.all([
        writeFile(new URL('web-pixel.js', directory), delivery.pixel),
        writeFile(new URL('web-pixel.min.js', directory), delivery.minifiedPixel),
        writeFile(new URL('theme-liquid.html', directory), delivery.theme),
    ]);
    // Remove the obsolete generated asset when rebuilding an older delivery.
    await rm(new URL('velotric-tealium-bridge.js', directory), { force: true });
    process.stdout.write('Tealium Dev delivery prepared without a fixed storefront domain.\n');
    process.stdout.write('Custom Pixel: ' + delivery.pixel.length + ' characters, '
        + Buffer.byteLength(delivery.pixel, 'utf8') + ' UTF-8 bytes (limit: <'
        + CUSTOM_PIXEL_LENGTH_LIMIT + ').\n');
    process.stdout.write('Compact Custom Pixel: ' + delivery.minifiedPixel.length + ' characters, '
        + Buffer.byteLength(delivery.minifiedPixel, 'utf8') + ' UTF-8 bytes.\n');
}
