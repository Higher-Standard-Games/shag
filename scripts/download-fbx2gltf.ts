/**
 * Download FBX2glTF tool for converting Mixamo FBX files to GLB
 * 
 * Run with: npm run tools:fbx2gltf
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const TOOL_DIR = join(process.cwd(), 'tools');
const FBX2GLTF_DIR = join(TOOL_DIR, 'FBX2glTF-windows-x86_64');
const FBX2GLTF_ZIP = join(TOOL_DIR, 'FBX2glTF.zip');
const DOWNLOAD_URL = 'https://github.com/godotengine/FBX2glTF/releases/download/v0.13.1/FBX2glTF-windows-x86_64.zip';

async function main() {
    // Check if already downloaded
    if (existsSync(join(FBX2GLTF_DIR, 'FBX2glTF-windows-x86_64.exe'))) {
        console.log('FBX2glTF already installed at:', FBX2GLTF_DIR);
        console.log('Usage: .\\tools\\FBX2glTF-windows-x86_64\\FBX2glTF-windows-x86_64.exe --binary --input file.fbx --output file');
        return;
    }

    // Create tools directory
    if (!existsSync(TOOL_DIR)) {
        mkdirSync(TOOL_DIR, { recursive: true });
    }

    console.log('Downloading FBX2glTF...');

    try {
        // Download using PowerShell
        execSync(
            `powershell -Command "Invoke-WebRequest -Uri '${DOWNLOAD_URL}' -OutFile '${FBX2GLTF_ZIP}'"`,
            { stdio: 'inherit' }
        );

        console.log('Extracting...');
        execSync(
            `powershell -Command "Expand-Archive -Path '${FBX2GLTF_ZIP}' -DestinationPath '${TOOL_DIR}' -Force"`,
            { stdio: 'inherit' }
        );

        console.log('FBX2glTF installed successfully!');
        console.log('Location:', FBX2GLTF_DIR);
        console.log('');
        console.log('Usage:');
        console.log('  .\\tools\\FBX2glTF-windows-x86_64\\FBX2glTF-windows-x86_64.exe --binary --input file.fbx --output file');
        console.log('');
        console.log('Or convert all FBX in a folder:');
        console.log('  Get-ChildItem "folder\\*.fbx" | ForEach-Object { .\\tools\\FBX2glTF-windows-x86_64\\FBX2glTF-windows-x86_64.exe --binary --input $_.FullName --output "folder\\$($_.BaseName)" }');

    } catch (error) {
        console.error('Failed to download FBX2glTF:', error);
        process.exit(1);
    }
}

main();
