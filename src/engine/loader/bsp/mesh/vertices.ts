import type { BspVertex, BspVertexIBSP } from "../BspLoader";
import { q3ToBabylon } from "./coordinates";

export function isIBSPVertex(v: BspVertex): v is BspVertexIBSP {
  return "lightmapCoord" in v;
}

export function getVertexPosition(v: BspVertex): [number, number, number] {
  return q3ToBabylon(v.position[0], v.position[1], v.position[2]);
}

export function getVertexNormal(v: BspVertex): [number, number, number] {
  return q3ToBabylon(v.normal[0], v.normal[1], v.normal[2]);
}

export function getVertexTexCoord(v: BspVertex): [number, number] {
  return [v.texCoord[0], v.texCoord[1]];
}

export function getVertexLightmapCoord(v: BspVertex): [number, number] {
  if (isIBSPVertex(v)) {
    return [v.lightmapCoord[0], v.lightmapCoord[1]];
  }
  // FBSP: use first lightmap coord
  return [v.lightmapCoords[0][0], v.lightmapCoords[0][1]];
}

export function getVertexColor(v: BspVertex): [number, number, number, number] {
  if (isIBSPVertex(v)) {
    return [v.color[0] / 255, v.color[1] / 255, v.color[2] / 255, v.color[3] / 255];
  }
  // FBSP: use first color
  return [v.colors[0][0] / 255, v.colors[0][1] / 255, v.colors[0][2] / 255, v.colors[0][3] / 255];
}
