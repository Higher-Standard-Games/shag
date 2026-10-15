#!/usr/bin/env python3
"""
Post-process GLB weapon models to embed textures from z_weapons.pk3.

Handles TGA, PNG, JPG textures directly via Pillow.
Handles KTX (ETC1/uncompressed) via custom parser + software decoder.

Usage:
    python scripts/embed_weapon_textures.py
"""

import os, sys, struct, json, io, zipfile
import argparse
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, 'config', 'weapon-models.json'), encoding='utf-8') as recipe_file:
    RECIPE = json.load(recipe_file)
PK3_PATH = os.path.join(ROOT, RECIPE['basePackage'])
WEAPONS_DIR = os.path.join(ROOT, RECIPE['sourceDir'])

# ══════════════════════════════════════════════════════════════
#  KTX1 Parser + ETC1 Decoder (ported from KTX1Loader.ts)
# ══════════════════════════════════════════════════════════════

KTX_IDENTIFIER = bytes([0xAB, 0x4B, 0x54, 0x58, 0x20, 0x31, 0x31, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A])
KTX_HEADER_SIZE = 64

# GL format constants
GL_RGB = 0x1907
GL_RGBA = 0x1908
GL_LUMINANCE = 0x1909
GL_LUMINANCE_ALPHA = 0x190A
GL_DXT1_RGB = 0x83F0
GL_DXT1_RGBA = 0x83F1
GL_DXT3 = 0x83F2
GL_DXT5 = 0x83F3
GL_ETC1 = 0x8D64
GL_ETC2_RGB = 0x9274
GL_ETC2_RGBA = 0x9278

ETC1_MODIFIER_TABLE = [
    (2, 8), (5, 17), (9, 29), (13, 42),
    (18, 60), (24, 80), (33, 106), (47, 183),
]


def parse_ktx1(data: bytes):
    """Parse KTX1 file, return (width, height, format, base_format, is_compressed, mip0_data)."""
    if data[:12] != KTX_IDENTIFIER:
        raise ValueError("Invalid KTX1 identifier")

    endianness = struct.unpack_from('<I', data, 12)[0]
    le = endianness == 0x04030201

    fmt_char = '<' if le else '>'
    vals = struct.unpack_from(f'{fmt_char}12I', data, 16)
    gl_type, gl_type_size, gl_format, gl_internal_format, gl_base_format = vals[:5]
    width, height = vals[5], vals[6]
    _depth, _array_elems, _faces, num_mips, kv_bytes = vals[7:12]

    is_compressed = gl_type == 0
    offset = KTX_HEADER_SIZE + kv_bytes

    if offset + 4 > len(data):
        raise ValueError("KTX truncated")

    image_size = struct.unpack_from(f'{fmt_char}I', data, offset)[0]
    offset += 4
    mip_data = data[offset:offset + image_size]

    return width, height, gl_internal_format, gl_base_format, is_compressed, mip_data


def decompress_etc1_block(block: bytes, out: bytearray, out_off: int, stride: int):
    """Decompress a single ETC1 4x4 block."""
    high = (block[0] << 24) | (block[1] << 16) | (block[2] << 8) | block[3]
    low = (block[4] << 24) | (block[5] << 16) | (block[6] << 8) | block[7]

    diff_bit = (high >> 1) & 1
    flip_bit = high & 1
    table_idx0 = (high >> 5) & 7
    table_idx1 = (high >> 2) & 7

    if diff_bit:
        br = (high >> 27) & 0x1F
        bg = (high >> 19) & 0x1F
        bb = (high >> 11) & 0x1F
        dr = (high >> 24) & 0x07
        dg = (high >> 16) & 0x07
        db = (high >> 8) & 0x07
        sdr = dr - 8 if dr >= 4 else dr
        sdg = dg - 8 if dg >= 4 else dg
        sdb = db - 8 if db >= 4 else db
        r0 = (br << 3) | (br >> 2)
        g0 = (bg << 3) | (bg >> 2)
        b0 = (bb << 3) | (bb >> 2)
        r1_5 = br + sdr
        g1_5 = bg + sdg
        b1_5 = bb + sdb
        r1 = (r1_5 << 3) | (r1_5 >> 2)
        g1 = (g1_5 << 3) | (g1_5 >> 2)
        b1 = (b1_5 << 3) | (b1_5 >> 2)
    else:
        r0_4 = (high >> 28) & 0xF
        g0_4 = (high >> 20) & 0xF
        b0_4 = (high >> 12) & 0xF
        r1_4 = (high >> 24) & 0xF
        g1_4 = (high >> 16) & 0xF
        b1_4 = (high >> 8) & 0xF
        r0 = (r0_4 << 4) | r0_4
        g0 = (g0_4 << 4) | g0_4
        b0 = (b0_4 << 4) | b0_4
        r1 = (r1_4 << 4) | r1_4
        g1 = (g1_4 << 4) | g1_4
        b1 = (b1_4 << 4) | b1_4

    for row in range(4):
        for col in range(4):
            pixel_idx = col * 4 + row
            msb = (low >> (pixel_idx + 16)) & 1
            lsb = (low >> pixel_idx) & 1
            mod_idx = (msb << 1) | lsb

            if flip_bit:
                in_sub0 = row < 2
            else:
                in_sub0 = col < 2

            base_r = r0 if in_sub0 else r1
            base_g = g0 if in_sub0 else g1
            base_b = b0 if in_sub0 else b1
            entry = ETC1_MODIFIER_TABLE[table_idx0 if in_sub0 else table_idx1]

            if mod_idx == 0:
                modifier = entry[0]
            elif mod_idx == 1:
                modifier = entry[1]
            elif mod_idx == 2:
                modifier = -entry[0]
            else:
                modifier = -entry[1]

            o = out_off + row * stride + col * 4
            out[o] = max(0, min(255, base_r + modifier))
            out[o + 1] = max(0, min(255, base_g + modifier))
            out[o + 2] = max(0, min(255, base_b + modifier))
            out[o + 3] = 255


def decompress_dxt1_block(block: bytes, out: bytearray, out_off: int, stride: int):
    """Decompress a DXT1 4x4 block."""
    c0 = block[0] | (block[1] << 8)
    c1 = block[2] | (block[3] << 8)

    r0 = int(((c0 >> 11) & 0x1F) * 255 / 31)
    g0 = int(((c0 >> 5) & 0x3F) * 255 / 63)
    b0 = int((c0 & 0x1F) * 255 / 31)
    r1 = int(((c1 >> 11) & 0x1F) * 255 / 31)
    g1 = int(((c1 >> 5) & 0x3F) * 255 / 63)
    b1 = int((c1 & 0x1F) * 255 / 31)

    pal = [(r0, g0, b0, 255), (r1, g1, b1, 255)]
    if c0 > c1:
        pal.append((int((2*r0+r1)/3), int((2*g0+g1)/3), int((2*b0+b1)/3), 255))
        pal.append((int((r0+2*r1)/3), int((g0+2*g1)/3), int((b0+2*b1)/3), 255))
    else:
        pal.append((int((r0+r1)/2), int((g0+g1)/2), int((b0+b1)/2), 255))
        pal.append((0, 0, 0, 0))

    lookup = block[4] | (block[5] << 8) | (block[6] << 16) | (block[7] << 24)
    for row in range(4):
        for col in range(4):
            ci = (lookup >> ((row * 4 + col) * 2)) & 3
            o = out_off + row * stride + col * 4
            out[o], out[o+1], out[o+2], out[o+3] = pal[ci]


def decode_compressed_ktx(width: int, height: int, fmt: int, data: bytes) -> bytes:
    """Software-decode a compressed KTX mip level to RGBA."""
    rgba = bytearray(width * height * 4)
    bw = max(1, (width + 3) // 4)
    bh = max(1, (height + 3) // 4)
    stride = width * 4
    block_size = 8 if fmt in (GL_DXT1_RGB, GL_DXT1_RGBA, GL_ETC1) else 16

    src_off = 0
    for by in range(bh):
        for bx in range(bw):
            block = data[src_off:src_off + block_size]
            out_off = (by * 4) * stride + (bx * 4) * 4

            if fmt in (GL_DXT1_RGB, GL_DXT1_RGBA):
                decompress_dxt1_block(block, rgba, out_off, stride)
            elif fmt == GL_ETC1:
                decompress_etc1_block(block, rgba, out_off, stride)
            # TODO: DXT3, DXT5, ETC2

            src_off += block_size

    return bytes(rgba)


def ktx_to_png(ktx_data: bytes) -> bytes:
    """Convert KTX texture to PNG bytes."""
    width, height, fmt, base_fmt, is_compressed, mip_data = parse_ktx1(ktx_data)

    if is_compressed:
        if fmt not in (GL_ETC1, GL_DXT1_RGB, GL_DXT1_RGBA):
            raise ValueError(f"Unsupported compressed format 0x{fmt:04x}")
        rgba = decode_compressed_ktx(width, height, fmt, mip_data)
    else:
        pixel_count = width * height
        if base_fmt == GL_RGBA:
            rgba = mip_data[:pixel_count * 4]
        elif base_fmt == GL_RGB:
            rgba = bytearray(pixel_count * 4)
            for i in range(pixel_count):
                rgba[i*4] = mip_data[i*3]
                rgba[i*4+1] = mip_data[i*3+1]
                rgba[i*4+2] = mip_data[i*3+2]
                rgba[i*4+3] = 255
        elif base_fmt == GL_LUMINANCE:
            rgba = bytearray(pixel_count * 4)
            for i in range(pixel_count):
                v = mip_data[i]
                rgba[i*4] = rgba[i*4+1] = rgba[i*4+2] = v
                rgba[i*4+3] = 255
        else:
            raise ValueError(f"Unsupported uncompressed format 0x{base_fmt:04x}")

    # KTX is bottom-to-top (OpenGL), flip for PNG
    row_bytes = width * 4
    flipped = bytearray(len(rgba))
    for y in range(height):
        src_start = y * row_bytes
        dst_start = (height - 1 - y) * row_bytes
        flipped[dst_start:dst_start + row_bytes] = rgba[src_start:src_start + row_bytes]

    img = Image.frombytes('RGBA', (width, height), bytes(flipped))
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════
#  TGA/PNG/JPG to PNG
# ══════════════════════════════════════════════════════════════

def image_to_png(data: bytes) -> bytes:
    """Convert TGA/PNG/JPG image data to PNG bytes."""
    img = Image.open(io.BytesIO(data))
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════
#  GLB Read/Write
# ══════════════════════════════════════════════════════════════

def read_glb(path: str):
    with open(path, 'rb') as f:
        magic = f.read(4)
        if magic != b'glTF':
            raise ValueError(f'Not a GLB file: {path}')
        version, length = struct.unpack('<2I', f.read(8))
        json_len = struct.unpack('<I', f.read(4))[0]
        f.read(4)  # JSON type
        json_data = json.loads(f.read(json_len))
        bin_data = bytearray()
        remaining = length - 12 - 8 - json_len
        if remaining > 0:
            bin_len = struct.unpack('<I', f.read(4))[0]
            f.read(4)  # BIN type
            bin_data = bytearray(f.read(bin_len))
    return json_data, bin_data


def write_glb(path: str, gltf: dict, buffer: bytearray):
    json_bytes = bytearray(json.dumps(gltf, separators=(',', ':')), 'utf-8')
    while len(json_bytes) % 4 != 0:
        json_bytes += b' '
    while len(buffer) % 4 != 0:
        buffer += b'\x00'
    filesize = 12 + 8 + len(json_bytes) + 8 + len(buffer)
    with open(path, 'wb') as f:
        f.write(b'glTF')
        f.write(struct.pack('<2I', 2, filesize))
        f.write(struct.pack('<I', len(json_bytes)))
        f.write(b'JSON')
        f.write(json_bytes)
        f.write(struct.pack('<I', len(buffer)))
        f.write(b'BIN\x00')
        f.write(buffer)


def embed_textures(glb_path: str, texture_map: dict) -> int:
    gltf, buffer = read_glb(glb_path)
    materials = gltf.get('materials', [])
    if not materials:
        return 0

    if 'textures' not in gltf:
        gltf['textures'] = []
    if 'images' not in gltf:
        gltf['images'] = []
    if 'samplers' not in gltf:
        gltf['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]
    if 'bufferViews' not in gltf:
        gltf['bufferViews'] = []

    embedded_count = 0
    for mat in materials:
        mat_name = mat.get('name', '')
        if mat_name in texture_map:
            png_data = texture_map[mat_name]
            while len(buffer) % 4 != 0:
                buffer += b'\x00'
            offset = len(buffer)
            buffer += png_data

            bv_index = len(gltf['bufferViews'])
            gltf['bufferViews'].append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(png_data)})
            img_index = len(gltf['images'])
            gltf['images'].append({'bufferView': bv_index, 'mimeType': 'image/png', 'name': mat_name})
            tex_index = len(gltf['textures'])
            gltf['textures'].append({'sampler': 0, 'source': img_index})

            if 'pbrMetallicRoughness' not in mat:
                mat['pbrMetallicRoughness'] = {}
            mat['pbrMetallicRoughness']['baseColorTexture'] = {'index': tex_index}
            mat['pbrMetallicRoughness']['metallicFactor'] = 0.0
            mat['pbrMetallicRoughness']['roughnessFactor'] = 0.8
            embedded_count += 1

    if gltf.get('buffers'):
        gltf['buffers'][0]['byteLength'] = len(buffer)
    elif len(buffer) > 0:
        gltf['buffers'] = [{'byteLength': len(buffer)}]

    write_glb(glb_path, gltf, buffer)
    return embedded_count


# ══════════════════════════════════════════════════════════════
#  Main
# ══════════════════════════════════════════════════════════════

def main():
    global PK3_PATH, WEAPONS_DIR
    args = argparse.ArgumentParser(description='Embed weapon textures in GLB exports')
    args.add_argument('--package', default=PK3_PATH)
    args.add_argument('--output-dir', default=WEAPONS_DIR)
    parsed = args.parse_args()
    PK3_PATH, WEAPONS_DIR = parsed.package, parsed.output_dir
    if not os.path.exists(PK3_PATH):
        print(f'❌ PK3 not found: {PK3_PATH}')
        sys.exit(1)

    print(f'📦 Opening {os.path.basename(PK3_PATH)} for textures...')

    # Build texture map: normalized_path_without_ext -> (original_name, raw_bytes, ext)
    pk3_textures = {}
    with zipfile.ZipFile(PK3_PATH, 'r') as pk3:
        for name in pk3.namelist():
            lower = name.lower()
            if any(lower.endswith(ext) for ext in ('.tga', '.jpg', '.png', '.ktx')):
                key = lower.rsplit('.', 1)[0]  # path without extension
                ext = '.' + lower.rsplit('.', 1)[1]
                # Prefer TGA/PNG/JPG over KTX (easier to convert), but use KTX if no other
                if key not in pk3_textures or ext != '.ktx':
                    pk3_textures[key] = (name, pk3.read(name), ext)

    print(f'   Found {len(pk3_textures)} textures in PK3')

    # Process each weapon directory
    total_embedded = 0
    for weapon_dir in sorted(os.listdir(WEAPONS_DIR)):
        weapon_path = os.path.join(WEAPONS_DIR, weapon_dir)
        if not os.path.isdir(weapon_path):
            continue

        glb_files = [f for f in os.listdir(weapon_path) if f.endswith('.glb')]
        if not glb_files:
            continue

        for glb_file in sorted(glb_files):
            glb_path = os.path.join(weapon_path, glb_file)
            print(f'  🔧 Processing {weapon_dir}/{glb_file}...')

            try:
                gltf, _ = read_glb(glb_path)
                materials = gltf.get('materials', [])
                if not materials:
                    print(f'     ⚠️  No materials')
                    continue

                tex_map = {}
                for mat in materials:
                    mat_name = mat.get('name', '')
                    mat_key = mat_name.lower()

                    if mat_key in pk3_textures:
                        orig_name, raw_data, ext = pk3_textures[mat_key]
                        try:
                            if ext == '.ktx':
                                png_data = ktx_to_png(raw_data)
                                print(f'     📷 {mat_key} (KTX→PNG) → {len(png_data)//1024}KB')
                            else:
                                png_data = image_to_png(raw_data)
                                print(f'     📷 {mat_key} ({ext}→PNG) → {len(png_data)//1024}KB')
                            tex_map[mat_name] = png_data
                        except Exception as e:
                            print(f'     ⚠️  Failed: {orig_name}: {e}')
                    else:
                        print(f'     ❓ No texture for material: {mat_name}')

                if tex_map:
                    count = embed_textures(glb_path, tex_map)
                    total_embedded += count
                    print(f'     ✅ Embedded {count}/{len(materials)} textures')

            except Exception as e:
                print(f'     ❌ Error: {e}')

    print(f'\n🎉 Done! Embedded {total_embedded} textures total.')


if __name__ == '__main__':
    main()
