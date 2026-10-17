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
const aseFiles = ['wdm5/wdm5_WallLamp1.ase','wdm5/floor_tile_concrete_1.ase','wdm5/wdm5_pillar1.ase',
  'wdm5/wdm5_SignNatsBar.ase','wdm5/wdm5_MiddleAreaRooftopWindow.ase','wdm5/wdm5_BlueNeonLight.ase',
  'decor_misc/aircondition_01.ase','decor_misc/airshaft.ase','decor_misc/factory_chimney_01.ase',
  'decor_misc/concrete_street_barrier_1.ase','city/trash_container_1.ase','city/fence_3.ase'];
const bounds=[];
for(const file of aseFiles){
  const bytes=fs.readFileSync(path.join(source,'models/mapobjects',file));zip.file('models/mapobjects/'+file,bytes);
  const vertices=[...bytes.toString('utf8').matchAll(/\*MESH_VERTEX\s+\d+\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g)].map(m=>m.slice(1).map(Number));
  bounds.push({model:'models/mapobjects/'+file,vertices:vertices.length,min:[0,1,2].map(i=>Math.min(...vertices.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...vertices.map(p=>p[i])))});
}
fs.writeFileSync('experiments/shagged/solamphi1/source-model-bounds.json',JSON.stringify(bounds,null,2)+'\n');
zip.file('SOLAMPHI_ASSETS.txt', 'Unmodified selected props from the local warfork-maps checkout. Original paths retained. This is local compile media, not a new asset license or redistribution grant.');
fs.writeFileSync('public/data/solamphi1_compile_props.pk3', await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
console.log(`Packaged ${files.length + 4 + aseFiles.length} compile assets from ${source}`);
