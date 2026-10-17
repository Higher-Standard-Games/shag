import { Engine } from "@babylonjs/core/Engines/engine";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { brushFaceKeys, brushFaceMaterial, brushFaceNormal, brushFacePoints, brushFaceST } from "../../src/engine/editor/BrushFaces";
import { faceTexMatrix } from "../../src/engine/editor/FaceUv";
import "@babylonjs/core/Shaders/default.vertex";
import "@babylonjs/core/Shaders/default.fragment";
import "@babylonjs/core/Shaders/color.vertex";
import "@babylonjs/core/Shaders/color.fragment";
import { EditorSession } from "../../src/engine/editor/EditorSession";
import { applyOperations, emptyDocument } from "../../src/engine/editor/api/Operations";
import type { ShaggedApi } from "../../src/engine/editor/ShaggedApi";
import { GamePaths } from "../../src/engine/core/GamePaths";
import { PK3Index } from "../../src/engine/loader/pk3/PK3Index";

/** Static package imports keep the isolated probe on the editor's Babylon module graph. */
export async function runConvexBrowserFixture() {
  await GamePaths.getInstance().init();
  await PK3Index.getInstance().ensureIndex();
  const canvas=document.createElement("canvas");canvas.style.cssText="width:100vw;height:100vh;display:block";document.body.appendChild(canvas);
  const engine=new Engine(canvas,true);
  const api={status:async()=>({saveAvailable:false,compilerAvailable:false,playableAvailable:false,supportedQualities:[],reason:"Isolated QA"})} as unknown as ShaggedApi;
  const session=new EditorSession(engine,canvas,()=>{},api);
  session.root.querySelector<HTMLButtonElement>('[data-view-mode="brush"]')!.click();
  const footprint=Array.from({length:8},(_,i)=>({x:140+48*Math.cos(i*Math.PI/4),y:64+48*Math.sin(i*Math.PI/4)}));
  const doc=applyOperations(emptyDocument("qa_convex_browser"),[
    {op:"box.create",id:"floor",min:{x:-240,y:-200,z:-16},max:{x:240,y:200,z:0},shader:"common/caulk"},
    {op:"box.create",id:"bridge",min:{x:-128,y:-16,z:32},max:{x:128,y:16,z:48},shader:"blx/blx_grid",alignment:"natural",textureSizes:{"blx/blx_grid":[512,256]}},
    {op:"brush.rotate",id:"bridge",axis:"z",degrees:45},
    {op:"gen.prism",id:"platform",footprint,bottom:0,top:64,shader:"blx/blx_grid"},
    {op:"convex.create",id:"wedge",vertices:[{x:-180,y:-64,z:0},{x:-84,y:-64,z:0},{x:-84,y:-64,z:64},{x:-180,y:64,z:0},{x:-84,y:64,z:0},{x:-84,y:64,z:64}],sides:[{vertices:[0,1,2]},{vertices:[3,5,4]},{vertices:[0,3,4,1]},{vertices:[1,4,5,2]},{vertices:[0,2,5,3]}],shader:"blx/blx_grid"},
  ]).doc;
  session.document.transact(draft=>Object.assign(draft,doc));
  // Probe the live editor's internal selection/frame state without saving a user draft.
  const live=session as unknown as {selectedId:string;changed:()=>void;frame:(all:boolean)=>void;meshes:Map<string,import("@babylonjs/core/Meshes/mesh").Mesh>};
  live.selectedId="bridge";live.changed();live.frame(true);
  engine.runRenderLoop(()=>session.render());
  (window as unknown as {__convexQA:unknown}).__convexQA={session,engine};
  const mesh=live.meshes.get("bridge")!;mesh.computeWorldMatrix(true);
  return {gpu:engine.getGlInfo(),hulls:doc.brushes.filter(b=>b.hull).length,bridgeVertices:mesh.getTotalVertices(),hit:mesh.intersects(new Ray(new Vector3(50,120,50),new Vector3(0,-1,0)),false).hit,miss:mesh.intersects(new Ray(new Vector3(90,120,-90),new Vector3(0,-1,0)),false).hit,rotationControl:!!session.root.querySelector("[data-rotate-brush]")};
}

/** Find a visible diagonal side center for a native CDP mouse click. */
export function convexFaceProbePoint() {
  const qa=(window as unknown as {__convexQA:{session:EditorSession;engine:Engine}}).__convexQA;
  const live=qa.session as unknown as {scene:Scene;camera:FreeCamera;meshes:Map<string,import("@babylonjs/core/Meshes/mesh").Mesh>};
  const brush=qa.session.document.snapshot().brushes.find(b=>b.id==="bridge")!;
  qa.session.render();
  const viewport=live.camera.viewport.toGlobal(qa.engine.getRenderWidth(),qa.engine.getRenderHeight());
  // Camera viewports are bottom-origin; Project's screen viewport is top-origin.
  viewport.y=qa.engine.getRenderHeight()-viewport.y-viewport.height;
  for(const key of brushFaceKeys(brush)) {
    if(Math.abs(brushFaceNormal(brush,key).z)>0.1) continue;
    const points=brushFacePoints(brush,key),center=points.reduce((p,v)=>({x:p.x+v.x/points.length,y:p.y+v.y/points.length,z:p.z+v.z/points.length}),{x:0,y:0,z:0});
    const screen=Vector3.Project(new Vector3(center.x,center.z,center.y),Matrix.Identity(),live.scene.getTransformMatrix(),viewport);
    const pick=live.scene.pick(screen.x,screen.y,mesh=>live.meshes.has(mesh.name),false,live.camera);
    if(pick?.pickedMesh?.name==="bridge" && pick.pickedMesh.metadata.convexFaceIndices[pick.faceId]===key) return {x:screen.x,y:screen.y,side:key};
  }
  throw new Error("No visible diagonal side found for face picking probe");
}

export function textureLockProbeSnapshot() {
  const qa=(window as unknown as {__convexQA:{session:EditorSession}}).__convexQA;
  const brush=qa.session.document.snapshot().brushes.find(b=>b.id==="bridge")!;
  return brushFaceKeys(brush).map(key=>brushFacePoints(brush,key).map(point=>brushFaceST(brush,key,faceTexMatrix(brushFaceMaterial(brush,key)!),point)));
}
