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
  const errors=browser.logs.filter(entry=>/shader.*error|WebGL.*error|exception/i.test(JSON.stringify(entry)));
  assert.equal(errors.length,0,JSON.stringify(errors));
  assert.equal(browser.failed.length,0,JSON.stringify(browser.failed));
  fs.writeFileSync(`.cache/shagged-${vertices?'vertices':'convex'}-browser-report.json`,JSON.stringify({ok:true,result,textured,vertices,logs:browser.logs,failed:browser.failed},null,2));
  console.log(JSON.stringify({ok:true,...result,vertices},null,2));
  await browser.ev('window.__convexQA.engine.stopRenderLoop();window.__convexQA.session.dispose();window.__convexQA.engine.dispose();');
}finally{if(browser)await browser.close();vite.kill();}
