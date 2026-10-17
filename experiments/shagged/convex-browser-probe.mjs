// Isolated real-GPU editor component probe; owns its private Vite and Edge processes.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {openBrowser,sleep} from '../../.claude/skills/browser-probe/scripts/cdp.mjs';
fs.mkdirSync('.cache',{recursive:true});
fs.writeFileSync('.cache/shagged-convex-preview.html','<!doctype html><html><head><meta charset="utf-8"><base href="/"><title>SHAGGED convex QA</title></head><body style="margin:0;background:#101b31"></body></html>');
const port=3112;
// Keep Babylon unbundled on one graph; prebundle only the CommonJS JSZip dependency.
const serverCode=`import {createServer} from 'vite';import path from 'node:path';const root=process.cwd();const server=await createServer({configFile:false,root,cacheDir:path.join(root,'node_modules/.vite-convex-probe'),resolve:{alias:{'@game':path.join(root,'src/games/fps')}},optimizeDeps:{noDiscovery:true,include:['jszip']},server:{port:${port},strictPort:true,host:'127.0.0.1',hmr:false,watch:null}});await server.listen();`;
const vite=spawn(process.execPath,['--input-type=module','-e',serverCode],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']});
let serverLog='';vite.stdout.on('data',d=>serverLog+=d);vite.stderr.on('data',d=>serverLog+=d);
let browser;
try{
  let ready=false;
  for(let i=0;i<100;i++){if(vite.exitCode!==null)throw new Error(serverLog);try{const r=await fetch(`http://127.0.0.1:${port}/.cache/shagged-convex-preview.html`);if(r.ok){ready=true;break;}}catch{}await sleep(200);}
  assert(ready,'private Vite did not become ready');
  browser=await openBrowser({width:1440,height:1000});
  await browser.send('Page.navigate',{url:`http://127.0.0.1:${port}/.cache/shagged-convex-preview.html`});await sleep(500);
  const result=await browser.ev(`(async()=>{const {runConvexBrowserFixture}=await import('/experiments/shagged/convex-browser-fixture.ts');return runConvexBrowserFixture();})()`);
  assert(result&&typeof result==='object',JSON.stringify(result));assert.equal(result.hulls,3);assert(result.hit&&!result.miss&&result.rotationControl);
  await sleep(1200);await browser.shot(path.resolve('.cache/shagged-convex-brush.png'));
  await browser.click('[data-view-mode="wireframe"]');await sleep(300);await browser.shot(path.resolve('.cache/shagged-convex-wireframe.png'));
  await browser.click('[data-view-mode="textured"]');
  let textured=false;
  for(let i=0;i<100;i++){textured=await browser.ev('window.__convexQA.session.texturedMeshes.some(mesh=>mesh.material?.name === "shagged-preview-blx/blx_grid" && mesh.material.diffuseTexture?.isReady())');if(textured)break;await sleep(200);}
  assert(textured,'textured preview did not become ready');
  await sleep(600);await browser.shot(path.resolve('.cache/shagged-convex-textured.png'));
  let vertices;
  if(process.argv.includes('--vertices')) {
    await browser.click('[data-action="vertices"]');
    const start=await browser.ev(`(()=>{const s=window.__convexQA.session,b=s.document.snapshot().brushes.find(b=>b.id==='bridge'),p=b.hull.vertices[0],r=s.root.querySelector('[data-plane="xy"]').getBoundingClientRect();const point={x:b.min.x+p.x*(b.max.x-b.min.x),y:b.min.y+p.y*(b.max.y-b.min.y)};window.__vertexBefore=JSON.stringify(b);window.__vertexTarget={x:point.x+16,y:point.y};return {x:r.left+r.width/2+(point.x-s.viewCenter.x)*s.zoom,y:r.top+r.height/2-(point.y-s.viewCenter.y)*s.zoom,dx:16*s.zoom};})()`);
    assert.equal(typeof start.x,'number');
    await browser.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x,y:start.y});
    await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',x:start.x,y:start.y,button:'left',clickCount:1});
    await browser.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+start.dx,y:start.y,button:'left',buttons:1});
    await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:start.x+start.dx,y:start.y,button:'left',clickCount:1});
    const dragged=await browser.ev(`(()=>{const b=window.__convexQA.session.document.snapshot().brushes.find(b=>b.id==='bridge'),t=window.__vertexTarget;return b.hull.vertices.some(p=>Math.abs(b.min.x+p.x*(b.max.x-b.min.x)-t.x)<1e-5&&Math.abs(b.min.y+p.y*(b.max.y-b.min.y)-t.y)<1e-5)})()`);
    assert.equal(dragged,true,'native mouse drag must move the projected vertex group');
    await browser.click('[data-action="undo"]');
    assert.equal(await browser.ev(`JSON.stringify(window.__convexQA.session.document.snapshot().brushes.find(b=>b.id==='bridge'))===window.__vertexBefore`),true);
    const edited=await browser.ev(`(()=>{const s=window.__convexQA.session,list=s.root.querySelector('[data-vertex-list]');for(const o of list.options)o.selected=o.value==='6';list.dispatchEvent(new Event('change'));const input=s.root.querySelector('[name="vertex-z"]');input.value=String(Number(input.value)+16);s.root.querySelector('[data-vertex-form]').requestSubmit();return s.document.snapshot().brushes.find(b=>b.id==='bridge').max.z})()`);
    assert.equal(edited,64,'numeric corner edit must change the hull height');
    await sleep(300);await browser.shot(path.resolve('.cache/shagged-vertices.png'));
    vertices={dragged,undo:true,numericHeight:edited};
  }
  let faces;
  if(process.argv.includes('--faces')) {
    const target=await browser.ev(`(async()=>{const {convexFaceProbePoint}=await import('/experiments/shagged/convex-browser-fixture.ts');return convexFaceProbePoint()})()`);
    assert.equal(typeof target.side,'number',JSON.stringify(target));
    for(const type of ['mousePressed','mouseReleased'])await browser.send('Input.dispatchMouseEvent',{type,x:target.x,y:target.y,button:'left',clickCount:1,modifiers:8});
    const picked=await browser.ev(`window.__convexQA.session.root.querySelector('[data-face="${target.side}"]').classList.contains('active')`);
    assert.equal(picked,true,'native Shift click must select the actual diagonal side');
    await browser.click('[data-uv-op="fit"]');
    const fitted=await browser.ev(`JSON.stringify(window.__convexQA.session.document.snapshot().brushes.find(b=>b.id==='bridge').hull.sides[${target.side}].material)`);
    await browser.click('[data-uv-nudge="shift-u:1"]');
    const shifted=await browser.ev(`window.__convexQA.session.document.snapshot().brushes.find(b=>b.id==='bridge').hull.sides[${target.side}].material.shift[0]`);
    assert(Math.abs(shifted-JSON.parse(fitted).shift[0]-8)<1e-6);
    await browser.click('[data-action="undo"]');
    assert.equal(await browser.ev(`JSON.stringify(window.__convexQA.session.document.snapshot().brushes.find(b=>b.id==='bridge').hull.sides[${target.side}].material)`),fitted);
    for(const type of ['mousePressed','mouseReleased'])await browser.send('Input.dispatchMouseEvent',{type,x:target.x,y:target.y,button:'left',clickCount:1,modifiers:1});
    const sampled=await browser.ev('window.__convexQA.session.root.querySelector("[data-current-texture]").textContent');
    assert.equal(sampled,'blx/blx_grid');
    await browser.click('[data-face="1"]');await browser.click('[data-uv-op="wrap"]');
    await browser.ev('window.__convexQA.session.inspector.scrollTop=window.__convexQA.session.inspector.scrollHeight');
    await sleep(300);await browser.shot(path.resolve('.cache/shagged-faces.png'));
    faces={side:target.side,picked,shifted,undo:true,sampled};
  }
  let textureLock;
  if(process.argv.includes('--texture-lock')) {
    const snapshot=()=>browser.ev(`(async()=>{const {textureLockProbeSnapshot}=await import('/experiments/shagged/convex-browser-fixture.ts');return textureLockProbeSnapshot()})()`);
    const before=await snapshot();
    const compare=(actual)=>{assert.equal(actual.length,before.length);let maximum=0;before.forEach((side,i)=>side.forEach((uv,j)=>uv.forEach((value,k)=>{const d=value-actual[i][j][k];maximum=Math.max(maximum,Math.abs(d-Math.round(d)));})));assert(maximum<1e-6,`locked corner UV drift: ${maximum}`);return maximum;};
    await browser.ev(`window.__convexQA.session.root.querySelector('[name="rotation-degrees"]').value='17'`);
    await browser.click('[data-rotate-brush]');const rotationDrift=compare(await snapshot());
    const resize=await browser.ev(`(()=>{const s=window.__convexQA.session,b=s.document.snapshot().brushes.find(b=>b.id==='bridge');window.__lockUndoBefore=JSON.stringify(b);const f=s.root.querySelector('[data-brush-form]'),input=f.querySelector('[name="max-x"]');input.value=String(Number(input.value)+48);const valid=f.checkValidity();f.requestSubmit();return {delta:s.document.snapshot().brushes.find(b=>b.id==='bridge').max.x-b.max.x,valid,status:s.root.querySelector('.shagged__status').textContent}})()`);
    assert(Math.abs(resize.delta-48)<1e-6,JSON.stringify(resize));const resizeDrift=compare(await snapshot());
    await browser.click('[data-face="1"]');
    const skew=await browser.ev('Number(window.__convexQA.session.root.querySelector("[name=skew]").value)');
    assert(Math.abs(skew)>1,'nonuniform resize must retain its nonorthogonal texture axes');
    await browser.ev('window.__convexQA.session.inspector.scrollTop=window.__convexQA.session.inspector.scrollHeight');
    await sleep(300);await browser.shot(path.resolve('.cache/shagged-texture-lock.png'));
    await browser.click('[data-action="undo"]');
    assert.equal(await browser.ev(`JSON.stringify(window.__convexQA.session.document.snapshot().brushes.find(b=>b.id==='bridge'))===window.__lockUndoBefore`),true);
    textureLock={rotationDrift,resizeDrift,skew,undo:true};
  }
  let selection;
  if(process.argv.includes('--selection')) {
    await browser.click('[data-action="select"]');
    const points=await browser.ev(`(()=>{const s=window.__convexQA.session,r=s.root.querySelector('[data-plane="xy"]').getBoundingClientRect();window.__selectionBefore=JSON.stringify(s.document.snapshot().brushes);return {bridge:{x:r.left+r.width/2-s.viewCenter.x*s.zoom,y:r.top+r.height/2+s.viewCenter.y*s.zoom},platform:{x:r.left+r.width/2+(140-s.viewCenter.x)*s.zoom,y:r.top+r.height/2-(64-s.viewCenter.y)*s.zoom},dx:16*s.zoom}})()`);
    const clickPoint=async(p,modifiers=0)=>{for(const type of ['mousePressed','mouseReleased'])await browser.send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1,modifiers});};
    await clickPoint(points.bridge);await clickPoint(points.platform,2);
    assert.equal(await browser.ev('window.__convexQA.session.selectedIds.size'),2);
    await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',...points.bridge,button:'left',clickCount:1});
    await browser.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.bridge.x+points.dx,y:points.bridge.y,button:'left',buttons:1});
    await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:points.bridge.x+points.dx,y:points.bridge.y,button:'left',clickCount:1});
    const moved=await browser.ev(`(()=>{const before=JSON.parse(window.__selectionBefore),after=window.__convexQA.session.document.snapshot().brushes;return after.map((b,i)=>({id:b.id,dx:b.min.x-before[i].min.x}))})()`);
    assert(moved.every(b=>Math.abs(b.dx-(['bridge','platform'].includes(b.id)?16:0))<1e-6),JSON.stringify(moved));
    await browser.click('[data-action="undo"]');
    assert.equal(await browser.ev('JSON.stringify(window.__convexQA.session.document.snapshot().brushes)===window.__selectionBefore'),true);
    const facePoint=await browser.ev(`(async()=>{const {convexFaceProbePoint}=await import('/experiments/shagged/convex-browser-fixture.ts');return convexFaceProbePoint()})()`);
    await clickPoint(facePoint,2);assert.equal(await browser.ev('window.__convexQA.session.selectedIds.size'),1);
    await clickPoint(facePoint,2);assert.equal(await browser.ev('window.__convexQA.session.selectedIds.size'),2);
    await browser.ev('window.__convexQA.session.root.querySelector("[data-group-name]").value="Reactor assembly"');
    await browser.click('[data-create-group]');
    await clickPoint(points.bridge);
    assert.equal(await browser.ev('window.__convexQA.session.selectedIds.size'),2);
    await sleep(300);await browser.shot(path.resolve('.cache/shagged-selection.png'));
    await browser.click('[data-action="duplicate"]');
    assert.equal(await browser.ev('window.__convexQA.session.document.snapshot().editorGroups.length'),2);
    await browser.click('[data-action="delete"]');
    assert.equal(await browser.ev('window.__convexQA.session.document.snapshot().brushes.length'),4);
    await browser.click('[data-action="undo"]');
    assert.equal(await browser.ev('window.__convexQA.session.document.snapshot().brushes.length'),6);
    selection={native2DCtrlClick:true,native3DCtrlClick:true,moved,undo:true,groups:true,duplicateDelete:true};
  }
  const errors=browser.logs.filter(entry=>/shader.*error|WebGL.*error|exception/i.test(JSON.stringify(entry)));
  assert.equal(errors.length,0,JSON.stringify(errors));
  assert.equal(browser.failed.length,0,JSON.stringify(browser.failed));
  fs.writeFileSync(`.cache/shagged-${selection?'selection':textureLock?'texture-lock':faces?'faces':vertices?'vertices':'convex'}-browser-report.json`,JSON.stringify({ok:true,result,textured,vertices,faces,textureLock,selection,logs:browser.logs,failed:browser.failed},null,2));
  console.log(JSON.stringify({ok:true,...result,vertices,faces,textureLock,selection},null,2));
  await browser.ev('window.__convexQA.engine.stopRenderLoop();window.__convexQA.session.dispose();window.__convexQA.engine.dispose();');
}finally{if(browser)await browser.close();vite.kill();}
