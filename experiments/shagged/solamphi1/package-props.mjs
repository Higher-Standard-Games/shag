// Compile-time source models. Run from repository root; optional first argument overrides the local asset checkout.
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
const source = process.argv[2] ?? 'C:/Users/sundf/Desktop/warfork-maps';
const prefix = 'models/mapobjects/industrial/';
const files = ['barrel_2.obj', 'barrel_2.mtl', 'crate_color.obj', 'crate_color.mtl',
  'barrels/albedo.png', 'barrels/albedo_norm.png', 'barrels/albedo_gloss.png',
  'crates/albedovc.jpg', 'crates/albedo.png', 'crates/albedo_color.tga', 'crates/albedo_norm.png', 'crates/albedo_gloss.png'];
const zip = new JSZip();
for (const file of files) zip.file(prefix + file, fs.readFileSync(path.join(source, prefix, file)));
for (const file of ['industrial/electricbox_wires.obj','industrial/electricbox_wires.mtl','cables/cables_2b.obj','cables/cables_2b.mtl'])
  zip.file('models/mapobjects/'+file,fs.readFileSync(path.join(source,'models/mapobjects',file)));
zip.file('SOLAMPHI_ASSETS.txt', 'Unmodified selected props from the local warfork-maps checkout. Original paths retained. This is local compile media, not a new asset license or redistribution grant.');
fs.writeFileSync('public/data/solamphi1_compile_props.pk3', await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
console.log(`Packaged ${files.length + 4} compile assets from ${source}`);
