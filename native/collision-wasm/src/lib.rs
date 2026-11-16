//! The world part of SweepCollisionBackend.trace (src/engine/physics), ported
//! statement for statement: the BSP node walk, leaf brushes with their
//! containment pruning, the clip-brush fallback, and patch facets. Movers
//! (lifts, switchable brush models, buttons) are left out.
//!
//! The tables are the backend's own prepared data, written into this module's
//! memory by compare.ts (see `set_table` for the layout). A trace reads its
//! input from, and writes its result to, f64 buffers in the same memory, so a
//! call passes no objects.

#![allow(static_mut_refs)]

use std::slice;

const EPSILON: f64 = 0.03125;
const PLAYERCLIP: i32 = 0x10000;

#[derive(Clone, Copy)]
struct Table {
    ptr: usize,
    len: usize,
}

const TABLES: usize = 15;
static mut T: [Table; TABLES] = [Table { ptr: 0, len: 0 }; TABLES];
static mut BRUSH_VISITS: Vec<u32> = Vec::new();
static mut FACE_VISITS: Vec<u32> = Vec::new();
static mut GENERATION: u32 = 0;

/// Memory for a table or a buffer: `n` f64 slots, 8-byte aligned.
#[no_mangle]
pub extern "C" fn alloc(n: usize) -> *mut f64 {
    let mut v = vec![0f64; n.max(1)];
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// Table `id` is `len` elements at `ptr` (f64 tables: planes 0, brush bounds 5,
/// mesh bounds 11, facet bounds 13, facet planes 14; the rest i32):
/// 0 planes [nx ny nz dist]; 1 nodes [plane child0 child1]; 2 leafs
/// [firstBrush numBrushes firstFace numFaces]; 3 leaf brushes; 4 brushes
/// [firstSide numSides texture parent excluded hasBounds]; 5 brush bounds
/// [min3 max3]; 6 sides [plane surfaceFlags|-1]; 7 textures [contents
/// surfaceFlags collisionMask]; 8 clip brushes; 9 leaf faces; 10 faces [mesh
/// texture firstFacet facetCount 0]; 11 mesh bounds [min3 max3, Q3 axes]; 12
/// facets [firstPlane lastPlane kind: 0 empty, 1 unbounded, 2 bounded]; 13
/// facet bounds; 14 facet planes [nx ny nz dist].
#[no_mangle]
pub extern "C" fn set_table(id: usize, ptr: usize, len: usize) {
    unsafe {
        T[id] = Table { ptr, len };
    }
}

/// Size the visit marks once the tables are in.
#[no_mangle]
pub extern "C" fn init(brushes: usize, faces: usize) {
    unsafe {
        BRUSH_VISITS = vec![0; brushes];
        FACE_VISITS = vec![0; faces];
        GENERATION = 0;
    }
}

fn f(id: usize) -> &'static [f64] {
    unsafe { slice::from_raw_parts(T[id].ptr as *const f64, T[id].len) }
}
fn i(id: usize) -> &'static [i32] {
    unsafe { slice::from_raw_parts(T[id].ptr as *const i32, T[id].len) }
}

struct State {
    start: [f64; 3],
    end: [f64; 3],
    mins: [f64; 3],
    maxs: [f64; 3],
    extents: [f64; 3],
    content_mask: i32,
    fraction: f64,
    normal: Option<[f64; 3]>,
    start_solid: bool,
    all_solid: bool,
    contents: i32,
    hit_brush: i32,
    hit_surface_flags: i32,
    /** The texture of the brush or face hit (its collision texture's index), -1 before a hit. */
    hit_texture: i32,
    face_index: usize,
}

struct World {
    planes: &'static [f64],
    nodes: &'static [i32],
    leafs: &'static [i32],
    leaf_brushes: &'static [i32],
    brushes: &'static [i32],
    brush_bounds: &'static [f64],
    sides: &'static [i32],
    textures: &'static [i32],
    clips: &'static [i32],
    leaf_faces: &'static [i32],
    faces: &'static [i32],
    mesh_bounds: &'static [f64],
    facets: &'static [i32],
    facet_bounds: &'static [f64],
    facet_planes: &'static [f64],
    brush_visits: &'static mut [u32],
    face_visits: &'static mut [u32],
    generation: u32,
}

impl World {
    fn plane(&self, p: usize) -> ([f64; 3], f64) {
        let o = p * 4;
        ([self.planes[o], self.planes[o + 1], self.planes[o + 2]], self.planes[o + 3])
    }

    fn brush_texture(&self, b: usize) -> i32 {
        self.brushes[b * 6 + 2]
    }

    fn collides(&self, texture: i32, mask: i32) -> bool {
        (self.textures[texture as usize * 3 + 2] & mask) != 0
    }

    fn swept_bounds(s: &State) -> [f64; 6] {
        let mut b = [0.0; 6];
        for a in 0..3 {
            b[a] = s.start[a].min(s.end[a]) + s.mins[a];
            b[a + 3] = s.start[a].max(s.end[a]) + s.maxs[a];
        }
        b
    }

    fn trace_node(&mut self, node: i32, sf: f64, ef: f64, start: [f64; 3], end: [f64; 3], s: &mut State) {
        if s.fraction <= sf {
            return;
        }
        if node < 0 {
            let leaf = (-(node + 1)) as usize;
            self.trace_leaf(leaf, s);
            return;
        }
        let n = node as usize * 3;
        let (normal, dist) = self.plane(self.nodes[n] as usize);
        let (start_dist, end_dist, offset);
        if normal[0] == 1.0 || normal[0] == -1.0 {
            start_dist = start[0] - dist;
            end_dist = end[0] - dist;
            offset = s.extents[0];
        } else if normal[1] == 1.0 || normal[1] == -1.0 {
            start_dist = start[1] - dist;
            end_dist = end[1] - dist;
            offset = s.extents[1];
        } else if normal[2] == 1.0 || normal[2] == -1.0 {
            start_dist = start[2] - dist;
            end_dist = end[2] - dist;
            offset = s.extents[2];
        } else {
            start_dist = (start[0] * normal[0] + start[1] * normal[1] + start[2] * normal[2]) - dist;
            end_dist = (end[0] * normal[0] + end[1] * normal[1] + end[2] * normal[2]) - dist;
            offset = (s.extents[0] * normal[0]).abs() + (s.extents[1] * normal[1]).abs() + (s.extents[2] * normal[2]).abs();
        }
        let children = [self.nodes[n + 1], self.nodes[n + 2]];
        if start_dist >= offset && end_dist >= offset {
            self.trace_node(children[0], sf, ef, start, end, s);
        } else if start_dist < -offset && end_dist < -offset {
            self.trace_node(children[1], sf, ef, start, end, s);
        } else {
            let side: usize;
            let (mut f1, mut f2);
            if start_dist < end_dist {
                side = 1;
                let inv = 1.0 / (start_dist - end_dist);
                f1 = (start_dist - offset + EPSILON) * inv;
                f2 = (start_dist + offset + EPSILON) * inv;
            } else if start_dist > end_dist {
                side = 0;
                let inv = 1.0 / (start_dist - end_dist);
                f1 = (start_dist + offset + EPSILON) * inv;
                f2 = (start_dist - offset - EPSILON) * inv;
            } else {
                side = 0;
                f1 = 1.0;
                f2 = 0.0;
            }
            f1 = js_max(0.0, js_min(1.0, f1));
            f2 = js_max(0.0, js_min(1.0, f2));
            let mid_f = sf + (ef - sf) * f1;
            let mid = [
                start[0] + f1 * (end[0] - start[0]),
                start[1] + f1 * (end[1] - start[1]),
                start[2] + f1 * (end[2] - start[2]),
            ];
            self.trace_node(children[side], sf, mid_f, start, mid, s);
            let mid_f2 = sf + (ef - sf) * f2;
            let mid2 = [
                start[0] + f2 * (end[0] - start[0]),
                start[1] + f2 * (end[1] - start[1]),
                start[2] + f2 * (end[2] - start[2]),
            ];
            self.trace_node(children[side ^ 1], mid_f2, ef, mid2, end, s);
        }
    }

    fn trace_leaf(&mut self, leaf: usize, s: &mut State) {
        let l = leaf * 4;
        let (first, count) = (self.leafs[l] as usize, self.leafs[l + 1] as usize);
        for k in 0..count {
            let b = self.leaf_brushes[first + k] as usize;
            if self.brushes[b * 6 + 4] != 0 {
                continue;
            }
            if self.brush_visits[b] == self.generation {
                continue;
            }
            if self.brushes[b * 6 + 1] < 1 {
                continue;
            }
            let texture = self.brush_texture(b);
            if texture < 0 || !self.collides(texture, s.content_mask) {
                continue;
            }
            self.brush_visits[b] = self.generation;
            self.trace_brush(b, texture, s);
        }
        let (first_face, faces) = (self.leafs[l + 2] as usize, self.leafs[l + 3] as usize);
        if faces == 0 {
            return;
        }
        let bounds = World::swept_bounds(s);
        for k in 0..faces {
            let face = self.leaf_faces[first_face + k] as usize;
            if self.faces[face * 5] >= 0 {
                self.trace_face_mesh(face, &bounds, s);
            }
        }
    }

    fn trace_face_mesh(&mut self, face: usize, bounds: &[f64; 6], s: &mut State) {
        if self.face_visits[face] == self.generation {
            return;
        }
        self.face_visits[face] = self.generation;
        let row = face * 5;
        let mesh = self.faces[row] as usize * 6;
        let mb = &self.mesh_bounds[mesh..mesh + 6];
        if bounds[3] < mb[0] || bounds[0] > mb[3] || bounds[4] < mb[1] || bounds[1] > mb[4] || bounds[5] < mb[2] || bounds[2] > mb[5] {
            return;
        }
        let texture = self.faces[row + 1];
        if texture < 0 || !self.collides(texture, s.content_mask) {
            return;
        }
        s.face_index = face;
        let (first, count) = (self.faces[row + 2] as usize, self.faces[row + 3] as usize);
        // The facet index returns the overlapping facets and the unbounded ones, in facet order.
        for t in first..first + count {
            let kind = self.facets[t * 3 + 2];
            if kind == 0 {
                continue;
            }
            if kind == 2 {
                let fb = &self.facet_bounds[t * 6..t * 6 + 6];
                let overlap = bounds[0] <= fb[3] && bounds[3] >= fb[0] && bounds[1] <= fb[4] && bounds[4] >= fb[1] && bounds[2] <= fb[5] && bounds[5] >= fb[2];
                if !overlap {
                    continue;
                }
            }
            self.trace_facet(self.facets[t * 3] as usize, self.facets[t * 3 + 1] as usize, texture, s);
        }
    }

    fn trace_facet(&mut self, first: usize, last: usize, texture: i32, s: &mut State) {
        let p = self.facet_planes;
        let mut enter = -1.0f64;
        let mut leave = 1.0f64;
        let mut start_out = false;
        let mut end_out = false;
        let mut hit: isize = -1;
        for k in first..last {
            let (nx, ny, nz, dist) = (p[k * 4], p[k * 4 + 1], p[k * 4 + 2], p[k * 4 + 3]);
            let ox = if nx < 0.0 { s.maxs[0] } else { s.mins[0] };
            let oy = if ny < 0.0 { s.maxs[1] } else { s.mins[1] };
            let oz = if nz < 0.0 { s.maxs[2] } else { s.mins[2] };
            let sd = (s.start[0] + ox) * nx + (s.start[1] + oy) * ny + (s.start[2] + oz) * nz - dist;
            let ed = (s.end[0] + ox) * nx + (s.end[1] + oy) * ny + (s.end[2] + oz) * nz - dist;
            if sd > 0.0 {
                start_out = true;
            }
            if ed > 0.0 {
                end_out = true;
            }
            if sd > 0.0 && ed > 0.0 {
                return;
            }
            if sd <= 0.0 && ed <= 0.0 {
                continue;
            }
            if sd > ed {
                let fr = (sd - EPSILON) / (sd - ed);
                if fr > enter {
                    enter = fr;
                    hit = k as isize;
                }
            } else {
                let fr = (sd + EPSILON) / (sd - ed);
                if fr < leave {
                    leave = fr;
                }
            }
        }
        let tex = texture as usize * 3;
        if !start_out {
            self.face_visits[s.face_index] = 0;
            let mut best = f64::NEG_INFINITY;
            let mut best_plane: isize = -1;
            for k in first..last {
                let (nx, ny, nz) = (p[k * 4], p[k * 4 + 1], p[k * 4 + 2]);
                let ox = if nx < 0.0 { s.maxs[0] } else { s.mins[0] };
                let oy = if ny < 0.0 { s.maxs[1] } else { s.mins[1] };
                let oz = if nz < 0.0 { s.maxs[2] } else { s.mins[2] };
                let d = (s.start[0] + ox) * nx + (s.start[1] + oy) * ny + (s.start[2] + oz) * nz - p[k * 4 + 3];
                if d > best {
                    best = d;
                    best_plane = k as isize;
                }
            }
            s.start_solid = true;
            s.contents = self.textures[tex];
            if best_plane >= 0 {
                let b = best_plane as usize;
                s.normal = Some([p[b * 4], p[b * 4 + 1], p[b * 4 + 2]]);
            }
            if !end_out {
                s.all_solid = true;
                s.fraction = 0.0;
            }
            return;
        }
        if enter < leave && enter > -1.0 && enter < s.fraction {
            s.fraction = if enter < 0.0 { 0.0 } else { enter };
            s.normal = if hit >= 0 {
                let h = hit as usize;
                Some([p[h * 4], p[h * 4 + 1], p[h * 4 + 2]])
            } else {
                None
            };
            s.contents = self.textures[tex];
            s.hit_surface_flags = self.textures[tex + 1];
            s.hit_texture = texture;
        }
    }

    fn hull_starts_outside(&self, b: usize, s: &State) -> bool {
        let (first, count) = (self.brushes[b * 6] as usize, self.brushes[b * 6 + 1] as usize);
        for k in 0..count {
            let (n, dist) = self.plane(self.sides[(first + k) * 2] as usize);
            let mut d = -dist;
            for a in 0..3 {
                d += (s.start[a] + if n[a] < 0.0 { s.maxs[a] } else { s.mins[a] }) * n[a];
            }
            if d > 0.0 {
                return true;
            }
        }
        false
    }

    fn trace_brush(&mut self, b: usize, texture: i32, s: &mut State) {
        let row = b * 6;
        if self.brushes[row + 5] != 0 {
            let bb = &self.brush_bounds[b * 6..b * 6 + 6];
            for a in 0..3 {
                if s.start[a].max(s.end[a]) + s.maxs[a] < bb[a] || s.start[a].min(s.end[a]) + s.mins[a] > bb[a + 3] {
                    return;
                }
            }
        }
        let parent = self.brushes[row + 3];
        if parent >= 0 && self.hull_starts_outside(parent as usize, s) {
            return;
        }
        let (first, count) = (self.brushes[row] as usize, self.brushes[row + 1] as usize);
        let mut enter = -1.0f64;
        let mut leave = 1.0f64;
        let mut start_out = false;
        let mut end_out = false;
        let mut hit_normal: Option<[f64; 3]> = None;
        let mut hit_side_flags: i32 = -1;
        for k in 0..count {
            let side = (first + k) * 2;
            let (n, dist) = self.plane(self.sides[side] as usize);
            let ox = if n[0] < 0.0 { s.maxs[0] } else { s.mins[0] };
            let oy = if n[1] < 0.0 { s.maxs[1] } else { s.mins[1] };
            let oz = if n[2] < 0.0 { s.maxs[2] } else { s.mins[2] };
            let sd = (s.start[0] + ox) * n[0] + (s.start[1] + oy) * n[1] + (s.start[2] + oz) * n[2] - dist;
            let ed = (s.end[0] + ox) * n[0] + (s.end[1] + oy) * n[1] + (s.end[2] + oz) * n[2] - dist;
            if sd > 0.0 {
                start_out = true;
            }
            if ed > 0.0 {
                end_out = true;
            }
            if sd > 0.0 && ed > 0.0 {
                return;
            }
            if sd <= 0.0 && ed <= 0.0 {
                continue;
            }
            if sd > ed {
                let fr = (sd - EPSILON) / (sd - ed);
                if fr > enter {
                    enter = fr;
                    hit_normal = Some(n);
                    hit_side_flags = self.sides[side + 1];
                }
            } else {
                let fr = (sd + EPSILON) / (sd - ed);
                if fr < leave {
                    leave = fr;
                }
            }
        }
        let tex = texture as usize * 3;
        if !start_out {
            self.brush_visits[b] = 0;
            let mut best = f64::NEG_INFINITY;
            let mut best_normal: Option<[f64; 3]> = None;
            for k in 0..count {
                let (n, dist) = self.plane(self.sides[(first + k) * 2] as usize);
                let ox = if n[0] < 0.0 { s.maxs[0] } else { s.mins[0] };
                let oy = if n[1] < 0.0 { s.maxs[1] } else { s.mins[1] };
                let oz = if n[2] < 0.0 { s.maxs[2] } else { s.mins[2] };
                let d = (s.start[0] + ox) * n[0] + (s.start[1] + oy) * n[1] + (s.start[2] + oz) * n[2] - dist;
                if d > best {
                    best = d;
                    best_normal = Some(n);
                }
            }
            s.start_solid = true;
            s.contents = self.textures[tex];
            if best_normal.is_some() {
                s.normal = best_normal;
            }
            if !end_out {
                s.all_solid = true;
                s.fraction = 0.0;
            }
            return;
        }
        if enter < leave && enter > -1.0 && enter < s.fraction {
            s.fraction = if enter < 0.0 { 0.0 } else { enter };
            s.normal = hit_normal;
            s.contents = self.textures[tex];
            s.hit_brush = b as i32;
            s.hit_surface_flags = if hit_side_flags >= 0 { hit_side_flags } else { self.textures[tex + 1] };
            s.hit_texture = texture;
        }
    }

    fn trace_clip_brushes(&mut self, s: &mut State) {
        if (s.content_mask & PLAYERCLIP) == 0 {
            return;
        }
        let bounds = World::swept_bounds(s);
        for k in 0..self.clips.len() {
            let b = self.clips[k] as usize;
            if self.brushes[b * 6 + 5] != 0 {
                let bb = &self.brush_bounds[b * 6..b * 6 + 6];
                let overlap = bounds[0] <= bb[3] && bounds[3] >= bb[0] && bounds[1] <= bb[4] && bounds[4] >= bb[1] && bounds[2] <= bb[5] && bounds[5] >= bb[2];
                if !overlap {
                    continue;
                }
            }
            if self.brush_visits[b] == self.generation {
                continue;
            }
            self.brush_visits[b] = self.generation;
            if self.brushes[b * 6 + 1] < 4 {
                continue;
            }
            let texture = self.brush_texture(b);
            if texture < 0 {
                continue;
            }
            self.trace_brush(b, texture, s);
        }
    }
}

/// Math.max / Math.min on non-NaN numbers, -0 and +0 alike.
fn js_max(a: f64, b: f64) -> f64 {
    if a > b || (a == b && a.is_sign_positive()) { a } else { b }
}
fn js_min(a: f64, b: f64) -> f64 {
    if a < b || (a == b && a.is_sign_negative()) { a } else { b }
}

fn world() -> World {
    unsafe {
        GENERATION = GENERATION.wrapping_add(1);
        if GENERATION == 0 {
            BRUSH_VISITS.fill(0);
            FACE_VISITS.fill(0);
            GENERATION = 1;
        }
        World {
            planes: f(0),
            nodes: i(1),
            leafs: i(2),
            leaf_brushes: i(3),
            brushes: i(4),
            brush_bounds: f(5),
            sides: i(6),
            textures: i(7),
            clips: i(8),
            leaf_faces: i(9),
            faces: i(10),
            mesh_bounds: f(11),
            facets: i(12),
            facet_bounds: f(13),
            facet_planes: f(14),
            brush_visits: &mut BRUSH_VISITS[..],
            face_visits: &mut FACE_VISITS[..],
            generation: GENERATION,
        }
    }
}

/// One trace. `input`: start3 end3 mins3 maxs3 contentMask (Q3 axes).
/// `output`: fraction endPos3 normal3 hasNormal startSolid allSolid contents hitBrush hitSurfaceFlags hitTexture.
fn trace_one(input: &[f64], output: &mut [f64]) {
    let mut w = world();
    let mut s = State {
        start: [input[0], input[1], input[2]],
        end: [input[3], input[4], input[5]],
        mins: [input[6], input[7], input[8]],
        maxs: [input[9], input[10], input[11]],
        extents: [0.0; 3],
        content_mask: input[12] as i32,
        fraction: 1.0,
        normal: None,
        start_solid: false,
        all_solid: false,
        contents: 0,
        hit_brush: -1,
        hit_surface_flags: 0,
        hit_texture: -1,
        face_index: 0,
    };
    for a in 0..3 {
        s.extents[a] = js_max(s.mins[a].abs(), s.maxs[a].abs());
    }
    let (start, end) = (s.start, s.end);
    w.trace_node(0, 0.0, 1.0, start, end, &mut s);
    w.trace_clip_brushes(&mut s);
    let mut end_pos = end;
    if s.fraction < 1.0 {
        for a in 0..3 {
            end_pos[a] = start[a] + s.fraction * (end[a] - start[a]);
        }
    }
    output[0] = s.fraction;
    output[1] = end_pos[0];
    output[2] = end_pos[1];
    output[3] = end_pos[2];
    let n = s.normal.unwrap_or([0.0; 3]);
    output[4] = n[0];
    output[5] = n[1];
    output[6] = n[2];
    output[7] = if s.normal.is_some() { 1.0 } else { 0.0 };
    output[8] = if s.start_solid { 1.0 } else { 0.0 };
    output[9] = if s.all_solid { 1.0 } else { 0.0 };
    output[10] = s.contents as f64;
    output[11] = s.hit_brush as f64;
    output[12] = s.hit_surface_flags as f64;
    output[13] = s.hit_texture as f64;
}

pub const IN: usize = 13;
pub const OUT: usize = 14;

/// `count` traces: inputs at `input`, IN f64 each; results at `output`, OUT each.
#[no_mangle]
pub extern "C" fn trace_batch(input: *const f64, output: *mut f64, count: usize) {
    let inputs = unsafe { slice::from_raw_parts(input, count * IN) };
    let outputs = unsafe { slice::from_raw_parts_mut(output, count * OUT) };
    for k in 0..count {
        trace_one(&inputs[k * IN..k * IN + IN], &mut outputs[k * OUT..k * OUT + OUT]);
    }
}
