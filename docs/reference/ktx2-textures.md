# KTX2 Texture Sidecars

> Verified against <code>scripts/convert-ktx2.js</code> and <code>PK3TextureLoader</code> on 2026-08-06.

The converter builds a loose cache from effective textures in <code>public/data</code> PK3 packages:

    public/data/ktx2cache/manifest.json
    public/data/ktx2cache/.../*.ktx2

Packages are processed alphabetically and later packages override earlier ones, matching <code>PK3Loader</code>. TGA, PNG, JPG, and JPEG are supported. Competing extensions use TGA, PNG, JPG, JPEG priority.

Color textures use ETC1S/Basis-LZ. Normal, bump, height, metallic, roughness, MR, and AO-like names use UASTC; normal/bump maps are normalized. Mipmaps are generated.

Requirements: Khronos KTX-Software 5.x <code>ktx</code> or legacy <code>toktx</code>. <code>KTX_TOOLS_PATH</code> may point to the executable or its directory.

    npm run tools:textures:audit
    npm run tools:textures
    npm run tools:textures:clean
    npm run build:prod

The browser fetches the manifest and prefers listed sidecars when <code>r_ktx2=1</code>, then falls back to the original PK3 texture. Changing the cvar affects later texture loads, not textures already cached.

The clean command removes only the validated <code>public/data/ktx2cache</code> output. Review the audit before rebuilding a large data set.
