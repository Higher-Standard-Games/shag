#!/usr/bin/env python3
"""
Convert IQM weapon models from z_weapons.pk3 to GLB format.

Extracts all .iqm files from the PK3, converts them to .glb using iqm2glb,
and writes unserved exports using config/weapon-models.json.

Usage:
    python scripts/convert_iqm_weapons.py
    npm run convert:weapons
"""

import os
import sys
import zipfile
import shutil
import tempfile
import argparse
import json

# Add scripts dir to path so we can import iqm2glb
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import iqm2glb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, 'config', 'weapon-models.json'), encoding='utf-8') as recipe_file:
    RECIPE = json.load(recipe_file)
PK3_PATH = os.path.join(ROOT, RECIPE['basePackage'])
OUTPUT_BASE = os.path.join(ROOT, RECIPE['sourceDir'])


def convert_weapon(iqm_data: bytes, weapon_name: str, model_name: str, output_dir: str) -> str:
    """Convert a single IQM file to GLB."""
    glb_filename = model_name.replace('.iqm', '.glb')
    output_path = os.path.join(output_dir, glb_filename)
    
    try:
        glb = iqm2glb.iqm2glb(iqm_data, {'model_name': weapon_name, 'z_up_to_y_up': True})
        os.makedirs(output_dir, exist_ok=True)
        with open(output_path, 'wb') as f:
            glb.write(f)
        return output_path
    except Exception as e:
        print(f'  ❌ Failed to convert {model_name}: {e}')
        return None


def main():
    global PK3_PATH, OUTPUT_BASE
    args = argparse.ArgumentParser(description='Convert weapon IQMs to GLB exports')
    args.add_argument('--package', default=PK3_PATH)
    args.add_argument('--output-dir', default=OUTPUT_BASE)
    parsed = args.parse_args()
    PK3_PATH, OUTPUT_BASE = parsed.package, parsed.output_dir
    if not os.path.exists(PK3_PATH):
        print(f'❌ PK3 not found: {PK3_PATH}')
        sys.exit(1)

    print(f'📦 Opening {os.path.basename(PK3_PATH)}...')
    
    with zipfile.ZipFile(PK3_PATH, 'r') as pk3:
        # Find all IQM files
        iqm_files = [f for f in pk3.namelist() if f.lower().endswith('.iqm')]
        print(f'   Found {len(iqm_files)} IQM files')

        converted = 0
        failed = 0

        for iqm_path in sorted(iqm_files):
            # Extract weapon name from path: models/weapons/<weapon>/<file>.iqm
            parts = iqm_path.replace('\\', '/').split('/')
            if len(parts) < 3:
                continue
            
            weapon_name = parts[-2]  # e.g., 'rlauncher'
            model_name = parts[-1]   # e.g., 'rlauncher.iqm'
            
            print(f'  🔄 Converting {iqm_path}...')
            
            iqm_data = pk3.read(iqm_path)
            output_dir = os.path.join(OUTPUT_BASE, weapon_name)
            result = convert_weapon(iqm_data, weapon_name, model_name, output_dir)
            
            if result:
                rel_path = os.path.relpath(result, ROOT)
                print(f'     ✅ → {rel_path}')
                converted += 1
            else:
                failed += 1

    print(f'\n🎉 Done! Converted {converted} models, {failed} failed.')
    if converted > 0:
        print(f'   Output: {os.path.relpath(OUTPUT_BASE, ROOT)}/')
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
