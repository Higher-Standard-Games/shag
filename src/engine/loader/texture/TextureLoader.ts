/**
 * Texture Loader with TGA Support
 * 
 * Loads textures with automatic TGA decoding for legacy game assets.
 * Tries PNG/JPG first (native browser support), falls back to TGA decoding.
 */

import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Scene } from '@babylonjs/core/scene';
import { decodeTGA } from './TgaDecoder';

export interface TextureLoadOptions {
    hasAlpha?: boolean;
    basePath?: string; // e.g., '/games/default/'
}

/**
 * Load a texture with automatic format detection and TGA fallback.
 * Tries: provided path → .png → .jpg → .tga (with decoding)
 */
export async function loadTextureWithTgaFallback(
    texturePath: string,
    scene: Scene,
    options: TextureLoadOptions = {}
): Promise<Texture | null> {
    const basePath = options.basePath || '/games/default/';
    const cleanPath = texturePath.replace(/^\//, '');
    const pathWithoutExt = cleanPath.replace(/\.(tga|png|jpg|jpeg)$/i, '');

    // Extensions to try in order
    const extensions = ['.png', '.jpg', '', '.tga'];

    for (const ext of extensions) {
        const tryPath = `${basePath}${pathWithoutExt}${ext}`;

        try {
            const resp = await fetch(tryPath, { method: 'HEAD' });
            if (!resp.ok) continue;

            // Check if it's a TGA that needs decoding
            if (ext === '.tga' || tryPath.endsWith('.tga')) {
                console.log(`[TextureLoader] Decoding TGA: ${tryPath}`);
                const dataResp = await fetch(tryPath);
                const buffer = await dataResp.arrayBuffer();
                const dataUrl = await decodeTGA(buffer);
                const texture = new Texture(dataUrl, scene);
                texture.name = cleanPath;
                texture.hasAlpha = options.hasAlpha ?? false;
                return texture;
            } else {
                // Native format - load directly
                console.log(`[TextureLoader] Loading: ${tryPath}`);
                const texture = new Texture(tryPath, scene);
                texture.name = cleanPath;
                texture.hasAlpha = options.hasAlpha ?? false;
                return texture;
            }
        } catch {
            // Try next extension
            continue;
        }
    }

    console.warn(`[TextureLoader] Texture not found: ${cleanPath}`);
    return null;
}

/**
 * Create a Babylon Texture, automatically handling TGA format.
 * This is a drop-in helper for loading textures that may be TGA.
 */
export function createTextureWithTgaSupport(
    url: string,
    scene: Scene,
    onLoad?: () => void,
    onError?: () => void,
    hasAlpha: boolean = false
): Texture {
    // Check if it's a TGA file
    if (url.toLowerCase().endsWith('.tga')) {
        // Create placeholder texture, then decode TGA async
        const placeholder = new Texture(null, scene);
        placeholder.name = url;

        fetch(url)
            .then(resp => {
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                return resp.arrayBuffer();
            })
            .then(buffer => decodeTGA(buffer))
            .then(dataUrl => {
                // Load decoded data into the placeholder
                const decoded = new Texture(dataUrl, scene);
                decoded.hasAlpha = hasAlpha;
                // Copy decoded texture to placeholder's internal texture
                if (placeholder.getInternalTexture() && decoded.getInternalTexture()) {
                    placeholder._texture = decoded.getInternalTexture();
                }
                onLoad?.();
            })
            .catch(err => {
                console.error(`[TextureLoader] TGA decode failed: ${url}`, err);
                onError?.();
            });

        return placeholder;
    } else {
        // Standard texture load
        return new Texture(url, scene, undefined, undefined, undefined, onLoad, onError);
    }
}
