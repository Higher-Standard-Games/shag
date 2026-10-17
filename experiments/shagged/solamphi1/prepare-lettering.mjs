import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import JSZip from 'jszip';
const index=JSON.parse(fs.readFileSync('public/data/pk3_index.json','utf8'));
const font='fonts/droidsans-bold.ttf';
const archive=await JSZip.loadAsync(fs.readFileSync('public/data/'+index.files[font]));
const entry=Object.keys(archive.files).find(p=>p.toLowerCase()===font);
if(!entry)throw new Error('Installed Droid Sans font missing');
const root='.cache/relay-yard-lettering';fs.mkdirSync(root,{recursive:true});
fs.writeFileSync(root+'/relay_yard.ttf',await archive.file(entry).async('nodebuffer'));
execFileSync(process.platform==='win32'?'tools/makebsp/makebsp.exe':'tools/makebsp/makebsp',['-fontatlas',root+'/relay_yard.ttf','512','40'],{windowsHide:true,stdio:'pipe'});
const path='textures/decals/fonts/relay_yard';
const descriptor=JSON.parse(fs.readFileSync(root+'/relay_yard.font','utf8'));descriptor.texture=path;
const shader=`${path}
{
 qer_editorimage ${path}.tga
 q3map_vertexcolor 255 255 255
 surfaceparm nomarks
 surfaceparm nodlight
 surfaceparm nonsolid
 surfaceparm trans
 polygonOffset
 nopicmip
 {
  map ${path}.tga
  blendFunc blend
  rgbGen vertex
  alphaGen vertex
 }
}
`;
fs.writeFileSync('experiments/shagged/solamphi1/lettering.shader',shader);
const zip=new JSZip();zip.file(path+'.font',JSON.stringify(descriptor));zip.file(path+'.tga',fs.readFileSync(root+'/relay_yard.tga'));zip.file('scripts/relay_yard_lettering.shader',shader);
zip.file('LETTERING_SOURCE.txt',`DroidSans-Bold.ttf from ${index.files[font]}, baked with MakeBSP fontatlas. Original font license and authorship remain applicable.`);
fs.writeFileSync('public/data/solamphi1_lettering.pk3',await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
console.log('Prepared compiler font descriptor, atlas and shader');
