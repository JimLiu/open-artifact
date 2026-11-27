//! The engine core, without the GPU: camera, scene, textures bookkeeping, gestures,
//! overlays and the per-frame update. The WebGL renderer draws from `rd`.

use crate::camera::{Camera, Glide};
use crate::events::{Commit, Event};
use crate::geom::{rotate, to_local, Rect};
use crate::render::{self, Batch, PathVertex, Quad, RenderData, MODE_BOX, MODE_CURSOR, QF_STROKE_SCREEN, SLOT_FLOATS};
use crate::scene::{
    Kind, Scene, F_HANDLES_CORNERS, F_HANDLES_WIDTH, F_LOCK_ASPECT, F_MOVABLE, F_MULTIPLY, F_NO_HOVER, F_NO_OUTLINE, F_RESIZABLE, F_SELECTABLE, F_SNAP,
};
use crate::snap::{self, Guide, Targets};
use crate::textures::TextureStore;

// Modifier bits (TS passes them).
pub const SHIFT: u32 = 1;
pub const ALT: u32 = 2;
pub const CTRL: u32 = 4;
pub const META: u32 = 8;

pub const TOOL_SELECT: u32 = 0;
pub const TOOL_PAN: u32 = 1;
pub const TOOL_NONE: u32 = 2;

pub const PTR_MOUSE: u32 = 0;
pub const PTR_PEN: u32 = 1;
pub const PTR_TOUCH: u32 = 2;

// Keys (TS maps KeyboardEvent.code to these).
pub const KEY_SPACE: u32 = 1;
pub const KEY_ESCAPE: u32 = 2;
pub const KEY_MODIFIER: u32 = 3;

// Cursors (TS maps to CSS).
pub const CUR_DEFAULT: u32 = 0;
pub const CUR_GRAB: u32 = 1;
pub const CUR_GRABBING: u32 = 2;
pub const CUR_MOVE: u32 = 3;
pub const CUR_NS: u32 = 4;
pub const CUR_EW: u32 = 5;
pub const CUR_NWSE: u32 = 6;
pub const CUR_NESW: u32 = 7;
pub const CUR_CROSSHAIR: u32 = 8;

// Resize handle edges.
pub const H_L: u8 = 1;
pub const H_R: u8 = 2;
pub const H_T: u8 = 4;
pub const H_B: u8 = 8;
const HANDLES: [(u8, f64, f64); 8] = [
    (H_L | H_T, -1.0, -1.0),
    (H_R | H_T, 1.0, -1.0),
    (H_R | H_B, 1.0, 1.0),
    (H_L | H_B, -1.0, 1.0),
    (H_T, 0.0, -1.0),
    (H_R, 1.0, 0.0),
    (H_B, 0.0, 1.0),
    (H_L, -1.0, 0.0),
];

// Frame result bits.
pub const FRAME_RENDER: u32 = 1;
pub const FRAME_MORE: u32 = 2;
pub const FRAME_HOLES: u32 = 4;

#[derive(Clone, Debug)]
pub struct Theme {
    pub background: u32,
    pub grid: u32,
    pub selection: u32,
    pub handle: u32,
    pub guide: u32,
    pub marquee: u32,
    pub hover: u32,
}

impl Default for Theme {
    fn default() -> Self {
        Theme {
            background: 0xf5f5f4ff,
            grid: 0xc8c8ccff,
            selection: 0x2563ebff,
            handle: 0xffffffff,
            guide: 0xf43f5eff,
            marquee: 0x2563eb1f,
            hover: 0x60a5faff,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Options {
    pub snap: bool,
    pub snap_px: f64,
    pub drag_px: f64,
    pub hit_px: f64,
    pub handle_px: f64,
    pub settle_ms: f64,
    pub camera_ms: f64,
    pub wheel_zoom: bool,
    pub controlled: bool,
    pub marquee_contain: bool,
    pub fade_ms: f64,
    pub drag_events: bool,
    /// Alt held when a move ends copies instead: the items stay put, ghosts show where the
    /// copies land, and the commit is a `Copy`. Selectable items that cannot move join the
    /// drag for the copy only.
    pub alt_copy: bool,
    /// 0 none, 1 dots, 2 lines.
    pub grid_kind: u32,
    pub grid_spacing: f64,
    /// Each coarser grid level is this many times the spacing of the one below.
    pub grid_major: f64,
    /// Screen spacing (px) at which a finer grid level starts to fade in, and where it is fully in.
    pub grid_fade: (f64, f64),
    pub zoom_speed: f64,
    /// The largest zoom factor one wheel event applies (zooming out, its inverse).
    pub wheel_zoom_max: f64,
    pub theme: Theme,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            snap: true,
            snap_px: 6.0,
            drag_px: 3.0,
            hit_px: 4.0,
            handle_px: 8.0,
            settle_ms: 150.0,
            camera_ms: 100.0,
            wheel_zoom: false,
            controlled: false,
            marquee_contain: false,
            fade_ms: 160.0,
            drag_events: false,
            alt_copy: false,
            grid_kind: 1,
            grid_spacing: 20.0,
            grid_major: 5.0,
            grid_fade: (8.0, 16.0),
            zoom_speed: 0.01,
            wheel_zoom_max: 1.35,
            theme: Theme::default(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Peer {
    pub color: u32,
    pub cursor: Option<(f64, f64)>,
    pub selection: Vec<u32>,
}

#[derive(Clone, Debug)]
pub enum Gesture {
    Idle,
    /// Pressed, not yet past the drag threshold.
    Pending { pid: i32, sx: f64, sy: f64, wx: f64, wy: f64, target: Option<u32>, drag: bool, deselect_to: Option<u32>, additive: bool },
    /// Pressed on something that cannot be dragged: swallow until release.
    Dead { pid: i32 },
    /// `fixed` marks items that only come along for an Alt copy; `copy` is whether the
    /// last update showed a copy (`alt_copy` with Alt held).
    Moving { pid: i32, wx: f64, wy: f64, ids: Vec<u32>, orig: Vec<crate::geom::Rect>, fixed: Vec<bool>, bbox: Rect, free_bbox: Option<Rect>, targets: Targets, dx: f64, dy: f64, copy: bool },
    Resizing { pid: i32, id: u32, handle: u8, orig: Rect, rot: f64, grab: (f64, f64), targets: Targets, rect: Rect },
    Marquee { pid: i32, wx: f64, wy: f64, cur: (f64, f64), base: Vec<u32>, before: Vec<u32>, preview: Vec<u32> },
    Panning { pid: i32, sx: f64, sy: f64 },
    Pinch { a: i32, b: i32, dist: f64, mid: (f64, f64) },
}

pub struct Engine {
    pub cam: Camera,
    pub glide: Option<Glide>,
    pub scene: Scene,
    pub tex: TextureStore,
    pub rd: RenderData,
    pub opts: Options,
    pub tool: u32,
    pub selection: Vec<u32>,
    pub hover: Option<u32>,
    pub gesture: Gesture,
    pub guides: Vec<Guide>,
    /// Guides the host draws (say while it runs a gesture of its own), beside the engine's.
    pub host_guides: Vec<Guide>,
    pub peers: Vec<Peer>,
    pub events: Vec<Event>,
    pub cursor: u32,
    pub now: f64,
    /// Active pointers: (id, x, y, type).
    pointers: Vec<(i32, f64, f64, u32)>,
    last_pointer: Option<(i32, f64, f64)>,
    space: bool,
    mods: u32,
    // Camera bookkeeping.
    cam_dirty: bool,
    pub moving: bool,
    last_cam_change: f64,
    last_cam_emit: f64,
    cam_emit_pending: bool,
    // What the next frame must do.
    visible_dirty: bool,
    pub needs_render: bool,
    fading: Vec<u32>,
    pub holes_out: Vec<f32>,
    holes_dirty: bool,
    pub visible_count: u32,
    pub draw_calls: u32,
}

impl Default for Engine {
    fn default() -> Self {
        Engine::new(2048, 5, 192.0 * 1024.0 * 1024.0)
    }
}

fn dedup_push(v: &mut Vec<u32>, h: u32) {
    if !v.contains(&h) {
        v.push(h);
    }
}

impl Engine {
    pub fn new(page: u32, levels: u32, budget: f64) -> Self {
        Engine {
            cam: Camera::default(),
            glide: None,
            scene: Scene::default(),
            tex: TextureStore::new(page, levels, budget),
            rd: RenderData::default(),
            opts: Options::default(),
            tool: TOOL_SELECT,
            selection: Vec::new(),
            hover: None,
            gesture: Gesture::Idle,
            guides: Vec::new(),
            host_guides: Vec::new(),
            peers: Vec::new(),
            events: Vec::new(),
            cursor: CUR_DEFAULT,
            now: 0.0,
            pointers: Vec::new(),
            last_pointer: None,
            space: false,
            mods: 0,
            cam_dirty: true,
            moving: false,
            last_cam_change: 0.0,
            last_cam_emit: f64::NEG_INFINITY,
            cam_emit_pending: false,
            visible_dirty: true,
            needs_render: true,
            fading: Vec::new(),
            holes_out: Vec::new(),
            holes_dirty: true,
            visible_count: 0,
            draw_calls: 0,
        }
    }

    fn emit(&mut self, e: Event) {
        self.events.push(e);
    }

    pub fn take_events(&mut self) -> Vec<Event> {
        std::mem::take(&mut self.events)
    }

    fn tess_level(&self) -> f64 {
        let z = self.cam.zoom.clamp(1.0, 16.0);
        2f64.powf(z.log2().ceil())
    }

    // ------------------------------------------------------------------ setup

    pub fn resize(&mut self, w: f64, h: f64, dpr: f64) {
        self.cam.vw = w.max(1.0);
        self.cam.vh = h.max(1.0);
        self.cam.dpr = if dpr > 0.0 { dpr } else { 1.0 };
        self.camera_changed();
    }

    pub fn set_option(&mut self, key: u32, v: f64) {
        let o = &mut self.opts;
        let b = v != 0.0;
        match key {
            1 => self.cam.min_zoom = v,
            2 => self.cam.max_zoom = v,
            3 => o.snap = b,
            4 => o.snap_px = v,
            5 => o.drag_px = v,
            6 => o.hit_px = v,
            7 => o.handle_px = v,
            8 => o.settle_ms = v,
            9 => o.camera_ms = v,
            10 => o.wheel_zoom = b,
            11 => o.controlled = b,
            12 => o.marquee_contain = b,
            13 => o.fade_ms = v,
            14 => o.drag_events = b,
            15 => o.grid_kind = v as u32,
            16 => o.grid_spacing = v.max(1e-6),
            17 => self.tex.set_budget(v),
            18 => o.zoom_speed = v,
            19 => o.wheel_zoom_max = v.max(1.0),
            20 => o.grid_major = v.max(2.0),
            21 => o.grid_fade.0 = v.max(1.0),
            22 => o.grid_fade.1 = v,
            23 => o.alt_copy = b,
            30 => o.theme.background = v as u32,
            31 => o.theme.grid = v as u32,
            32 => o.theme.selection = v as u32,
            33 => o.theme.handle = v as u32,
            34 => o.theme.guide = v as u32,
            35 => o.theme.marquee = v as u32,
            36 => o.theme.hover = v as u32,
            _ => {}
        }
        self.rd.overlay_dirty = true;
        self.needs_render = true;
    }

    pub fn set_tool(&mut self, tool: u32) {
        if tool != self.tool {
            self.cancel_gesture();
            self.tool = tool;
            self.cursor = if tool == TOOL_PAN { CUR_GRAB } else { CUR_DEFAULT };
            self.set_hover(None);
            self.rd.overlay_dirty = true;
            self.needs_render = true;
        }
    }

    // ------------------------------------------------------------------ scene

    pub fn apply(&mut self, ops: &[f64], paths: &[f32]) {
        let level = self.tess_level();
        let applied = self.scene.apply(ops, paths, level);
        if !applied.removed.is_empty() {
            let gone = |h: &u32| self.scene.get(*h).is_none();
            let before = self.selection.len();
            self.selection.retain(|h| !gone(h));
            if self.selection.len() != before && !self.opts.controlled {
                let sel = self.selection.clone();
                self.emit(Event::Selection(sel, self.mods));
            }
            if self.hover.is_some_and(|h| self.scene.get(h).is_none()) {
                self.set_hover(None);
            }
        }
        self.visible_dirty = true;
        self.holes_dirty = true;
        self.rd.overlay_dirty = true;
        self.needs_render = true;
    }

    /// Store texture `key` at these sizes; returns each one's placement (None = no room).
    pub fn set_texture(&mut self, key: u32, sizes: &[(u32, u32)]) -> Vec<Option<crate::textures::Placement>> {
        let out = self.tex.set(key, sizes, self.now);
        self.invalidate_textures(&[key]);
        self.drain_evictions();
        out
    }

    pub fn remove_texture(&mut self, key: u32) {
        self.tex.remove(key);
        self.invalidate_textures(&[key]);
    }

    fn drain_evictions(&mut self) {
        let ev = std::mem::take(&mut self.tex.evicted);
        if !ev.is_empty() {
            self.invalidate_textures(&ev);
        }
    }

    /// Items showing any of `keys` re-choose their resolution at the next visibility pass.
    fn invalidate_textures(&mut self, keys: &[u32]) {
        let mut dirty = Vec::new();
        for it in self.scene.items.iter_mut().flatten() {
            if let Some(k) = it.style.texture
                && keys.contains(&k) && it.tex.is_some() {
                it.tex = None;
                it.tex_replaced = true;
                dirty.push(it.handle);
            }
        }
        self.scene.dirty.extend(dirty);
        self.visible_dirty = true;
        self.needs_render = true;
    }

    /// After a GPU context loss: forget every texture, re-upload everything and ask for textures again.
    pub fn reset_gpu(&mut self, page: u32) {
        let budget = self.tex.max_layers as f64 * self.tex.layer_bytes();
        let levels = self.tex.levels;
        self.tex = TextureStore::new(page, levels, budget);
        for it in self.scene.items.iter_mut().flatten() {
            it.tex = None;
        }
        self.fading.clear();
        self.scene.structure_dirty = true;
        self.visible_dirty = true;
        self.needs_render = true;
        self.emit(Event::ContextRestored);
    }

    pub fn set_selection(&mut self, ids: &[u32]) {
        self.selection = ids.iter().copied().filter(|h| self.scene.get(*h).is_some()).collect();
        self.rd.overlay_dirty = true;
        self.needs_render = true;
    }

    /// Selection changes from gestures: applied (and reported) in engine mode, proposed in controlled mode.
    fn propose_selection(&mut self, ids: Vec<u32>) {
        if self.opts.controlled {
            self.emit(Event::Commit(Commit::Select { ids }, self.mods));
        } else if ids != self.selection {
            self.selection = ids.clone();
            self.rd.overlay_dirty = true;
            self.needs_render = true;
            self.emit(Event::Selection(ids, self.mods));
        }
    }

    /// Replaces the host's guides: four numbers each (vertical 0 or 1, at, lo, hi).
    pub fn set_guides(&mut self, data: &[f64]) {
        self.host_guides = data.chunks_exact(4).map(|c| Guide { vertical: c[0] != 0.0, at: c[1], lo: c[2], hi: c[3] }).collect();
        self.rd.overlay_dirty = true;
        self.needs_render = true;
    }

    pub fn set_peers(&mut self, data: &[f64]) {
        self.peers.clear();
        let mut i = 0;
        while i + 5 <= data.len() {
            let color = data[i] as u32;
            let has = data[i + 1] != 0.0;
            let cursor = if has { Some((data[i + 2], data[i + 3])) } else { None };
            let n = data[i + 4] as usize;
            let sel = data.get(i + 5..i + 5 + n).unwrap_or(&[]).iter().map(|v| *v as u32).collect();
            self.peers.push(Peer { color, cursor, selection: sel });
            i += 5 + n;
        }
        self.rd.overlay_dirty = true;
        self.needs_render = true;
    }

    // ------------------------------------------------------------------ camera

    fn camera_changed(&mut self) {
        self.cam_dirty = true;
        self.visible_dirty = true;
        self.holes_dirty = true;
        self.rd.overlay_dirty = true;
        self.needs_render = true;
    }

    pub fn set_camera(&mut self, x: f64, y: f64, zoom: f64) {
        self.glide = None;
        self.cam.set(x, y, zoom);
        self.camera_changed();
        self.reapply_pointer();
    }

    pub fn zoom_at(&mut self, factor: f64, sx: f64, sy: f64) {
        self.glide = None;
        self.cam.zoom_at(factor, sx, sy);
        self.camera_changed();
        self.reapply_pointer();
    }

    pub fn pan_by(&mut self, dx: f64, dy: f64) {
        self.glide = None;
        self.cam.pan_by_screen(dx, dy);
        self.camera_changed();
        self.reapply_pointer();
    }

    pub fn glide_to(&mut self, r: Rect, duration: f64, padding: f64, max_zoom: f64) {
        let to = self.cam.fit(&r, padding, if max_zoom > 0.0 { max_zoom } else { self.cam.max_zoom });
        if duration <= 0.0 {
            self.set_camera(to.0, to.1, to.2);
            return;
        }
        self.glide = Some(Glide { from: self.cam.state(), to, start: 0.0, duration, started: false });
        self.needs_render = true;
    }

    // ------------------------------------------------------------------ input

    pub fn wheel(&mut self, sx: f64, sy: f64, dx: f64, dy: f64, mods: u32) -> bool {
        self.glide = None;
        if mods & (CTRL | META) != 0 || self.opts.wheel_zoom {
            let max = self.opts.wheel_zoom_max;
            let factor = (-dy * self.opts.zoom_speed).exp().clamp(1.0 / max, max);
            self.cam.zoom_at(factor, sx, sy);
        } else {
            let (dx, dy) = if mods & SHIFT != 0 && dx == 0.0 { (dy, 0.0) } else { (dx, dy) };
            self.cam.pan_by_screen(dx, dy);
        }
        self.camera_changed();
        self.reapply_pointer();
        true
    }

    fn reapply_pointer(&mut self) {
        if let Some((pid, x, y)) = self.last_pointer
            && matches!(self.gesture, Gesture::Moving { .. } | Gesture::Resizing { .. } | Gesture::Marquee { .. }) {
            let mods = self.mods;
            self.pointer_move(pid, x, y, 1, mods);
        }
    }

    pub fn key(&mut self, code: u32, down: bool, mods: u32) -> bool {
        self.mods = mods;
        match code {
            KEY_SPACE => {
                self.space = down;
                if matches!(self.gesture, Gesture::Idle) {
                    self.cursor = if down || self.tool == TOOL_PAN { CUR_GRAB } else { CUR_DEFAULT };
                }
                true
            }
            KEY_ESCAPE if down => {
                let active = !matches!(self.gesture, Gesture::Idle);
                self.cancel_gesture();
                active
            }
            KEY_MODIFIER => {
                self.reapply_pointer();
                false
            }
            _ => false,
        }
    }

    fn world(&self, sx: f64, sy: f64) -> (f64, f64) {
        self.cam.screen_to_world(sx, sy)
    }

    /// The single selected, resizable item that shows handles: its handle, rect, rotation and flags.
    fn handle_target(&self) -> Option<(u32, Rect, f64, u32)> {
        if self.tool != TOOL_SELECT || self.selection.len() != 1 {
            return None;
        }
        let it = self.scene.get(self.selection[0])?;
        if !it.visible() || !it.has(F_RESIZABLE) || it.has(F_NO_OUTLINE) {
            return None;
        }
        Some((it.handle, it.rect, it.rot, it.flags))
    }

    /// The handles an item of this size on screen shows: its handle set (all, corners, or left
    /// and right), without edge midpoints when it is small.
    fn shows_handle(&self, r: &Rect, flags: u32, code: u8) -> bool {
        let z = self.cam.zoom;
        let corner = code.count_ones() == 2;
        if flags & F_HANDLES_CORNERS != 0 {
            return corner;
        }
        if flags & F_HANDLES_WIDTH != 0 {
            return code == H_L || code == H_R;
        }
        let small = r.w * z < self.opts.handle_px * 3.0 || r.h * z < self.opts.handle_px * 3.0;
        corner || !small
    }

    /// The resize handle (or edge) under screen point (sx, sy).
    pub fn hit_handle(&self, sx: f64, sy: f64) -> Option<(u32, u8)> {
        let (h, r, rot, flags) = self.handle_target()?;
        let z = self.cam.zoom;
        let reach = self.opts.handle_px * 0.5 + 2.0;
        let (wx, wy) = self.world(sx, sy);
        let (lx, ly) = to_local(&r, rot, wx, wy);
        let (hw, hh) = (r.w * 0.5, r.h * 0.5);
        // Corners and edge midpoints, in screen pixels of the item's own frame.
        for &(code, ux, uy) in HANDLES.iter() {
            if self.shows_handle(&r, flags, code) && ((lx - ux * hw) * z).abs() <= reach && ((ly - uy * hh) * z).abs() <= reach {
                return Some((h, code));
            }
        }
        if flags & F_HANDLES_CORNERS != 0 {
            return None;
        }
        // Anywhere along an edge.
        let near = |d: f64| (d * z).abs() <= 3.0;
        if ly.abs() <= hh {
            if near(lx + hw) {
                return Some((h, H_L));
            }
            if near(lx - hw) {
                return Some((h, H_R));
            }
        }
        if lx.abs() <= hw && flags & F_HANDLES_WIDTH == 0 {
            if near(ly + hh) {
                return Some((h, H_T));
            }
            if near(ly - hh) {
                return Some((h, H_B));
            }
        }
        None
    }

    /// World rect and rotation of item `h`, as the engine has it now (mid-gesture included).
    pub fn item_rect(&self, h: u32) -> Option<(Rect, f64)> {
        self.scene.get(h).map(|it| (it.rect, it.rot))
    }

    /// Reports a double click or context menu at a screen point, with the topmost hittable item under it.
    pub fn pointer_event(&mut self, kind: &'static str, sx: f64, sy: f64, mods: u32) {
        self.mods = mods;
        let id = self.hit_test(sx, sy);
        let world = self.world(sx, sy);
        self.emit(Event::Pointer { kind, id, world, screen: (sx, sy), mods });
    }

    /// Starts moving `target` (and the selection, if it is selected) from a press the host
    /// received (say on a DOM title): pointer `pid` drives it from here like a press on the item,
    /// becoming a move past the drag threshold. False when a gesture runs or it cannot move.
    pub fn start_move(&mut self, pid: i32, sx: f64, sy: f64, target: u32, mods: u32) -> bool {
        if !matches!(self.gesture, Gesture::Idle) || self.tool != TOOL_SELECT || self.drag_ids(target).is_empty() {
            return false;
        }
        self.mods = mods;
        self.last_pointer = Some((pid, sx, sy));
        self.pointers.retain(|p| p.0 != pid);
        self.pointers.push((pid, sx, sy, PTR_MOUSE));
        self.glide = None;
        let (wx, wy) = self.world(sx, sy);
        self.gesture = Gesture::Pending { pid, sx, sy, wx, wy, target: Some(target), drag: true, deselect_to: None, additive: false };
        true
    }

    fn handle_cursor(handle: u8, rot: f64) -> u32 {
        let ux = if handle & H_L != 0 { -1.0 } else if handle & H_R != 0 { 1.0 } else { 0.0 };
        let uy = if handle & H_T != 0 { -1.0 } else if handle & H_B != 0 { 1.0 } else { 0.0 };
        let (x, y) = rotate(ux, uy, rot);
        let mut a = y.atan2(x).to_degrees();
        a = a.rem_euclid(180.0);
        match a {
            a if !(22.5..157.5).contains(&a) => CUR_EW,
            a if a < 67.5 => CUR_NWSE,
            a if a < 112.5 => CUR_NS,
            _ => CUR_NESW,
        }
    }

    /// Topmost hittable item at a screen point (any flags).
    pub fn hit_test(&self, sx: f64, sy: f64) -> Option<u32> {
        let (wx, wy) = self.world(sx, sy);
        self.scene.hit(wx, wy, self.opts.hit_px / self.cam.zoom)
    }

    fn hit_selectable(&self, sx: f64, sy: f64) -> Option<u32> {
        self.hit_test(sx, sy).filter(|h| self.scene.get(*h).is_some_and(|i| i.has(F_SELECTABLE)))
    }

    fn set_hover(&mut self, h: Option<u32>) {
        if h != self.hover {
            self.hover = h;
            self.rd.overlay_dirty = true;
            self.needs_render = true;
            self.emit(Event::Hover(h));
        }
    }

    pub fn pointer_down(&mut self, pid: i32, sx: f64, sy: f64, button: u32, mods: u32, ptype: u32) -> bool {
        self.mods = mods;
        self.last_pointer = Some((pid, sx, sy));
        self.pointers.retain(|p| p.0 != pid);
        self.pointers.push((pid, sx, sy, ptype));
        self.glide = None;
        if ptype == PTR_TOUCH {
            let touches: Vec<(i32, f64, f64)> = self.pointers.iter().filter(|p| p.3 == PTR_TOUCH).map(|p| (p.0, p.1, p.2)).collect();
            if touches.len() == 2 && self.tool != TOOL_NONE {
                self.cancel_gesture();
                let (a, b) = (touches[0], touches[1]);
                let dist = ((a.1 - b.1).powi(2) + (a.2 - b.2).powi(2)).sqrt().max(1.0);
                self.gesture = Gesture::Pinch { a: a.0, b: b.0, dist, mid: ((a.1 + b.1) * 0.5, (a.2 + b.2) * 0.5) };
                self.emit(Event::Gesture { kind: "pinch", phase: "start", mods: self.mods });
                return true;
            }
        }
        if !matches!(self.gesture, Gesture::Idle) {
            return false;
        }
        let pan = button == 1 || (button == 0 && (self.space || self.tool == TOOL_PAN));
        if pan {
            self.gesture = Gesture::Panning { pid, sx, sy };
            self.cursor = CUR_GRABBING;
            self.emit(Event::Gesture { kind: "pan", phase: "start", mods: self.mods });
            return true;
        }
        if button != 0 || self.tool != TOOL_SELECT {
            return false;
        }
        let (wx, wy) = self.world(sx, sy);
        if let Some((id, handle)) = self.hit_handle(sx, sy) {
            let it = self.scene.get(id).unwrap();
            let (orig, rot) = (it.rect, it.rot);
            let targets = self.snap_targets(&[id]);
            self.gesture = Gesture::Resizing { pid, id, handle, orig, rot, grab: to_local(&orig, rot, wx, wy), targets, rect: orig };
            self.cursor = Self::handle_cursor(handle, rot);
            self.emit(Event::Gesture { kind: "resize", phase: "start", mods: self.mods });
            return true;
        }
        let shift = mods & SHIFT != 0;
        match self.hit_selectable(sx, sy) {
            Some(h) => {
                let mut drag = true;
                let mut deselect_to = None;
                if shift {
                    let mut sel = self.selection.clone();
                    if sel.contains(&h) {
                        sel.retain(|x| *x != h);
                        drag = false;
                    } else {
                        sel.push(h);
                    }
                    self.propose_selection(sel);
                } else if !self.selection.contains(&h) {
                    self.propose_selection(vec![h]);
                } else if self.selection.len() > 1 {
                    deselect_to = Some(h);
                }
                self.gesture = Gesture::Pending { pid, sx, sy, wx, wy, target: Some(h), drag, deselect_to, additive: shift };
            }
            None => {
                self.gesture = Gesture::Pending { pid, sx, sy, wx, wy, target: None, drag: false, deselect_to: None, additive: shift };
            }
        }
        true
    }

    /// Items the selection drags when pressed on `target`.
    /// With `alt_copy`, selectable items that cannot move come too (for a copy).
    fn drag_ids(&self, target: u32) -> Vec<u32> {
        let ids: Vec<u32> = if self.selection.contains(&target) { self.selection.clone() } else { vec![target] };
        let copyable = |i: &crate::scene::Item| self.opts.alt_copy && i.has(F_SELECTABLE);
        ids.into_iter().filter(|h| self.scene.get(*h).is_some_and(|i| i.visible() && (i.has(F_MOVABLE) || copyable(i)))).collect()
    }

    /// Whether the move running now (or ending now) copies.
    fn copying(&self) -> bool {
        self.opts.alt_copy && self.mods & ALT != 0
    }

    fn snap_targets(&self, exclude: &[u32]) -> Targets {
        if !self.opts.snap {
            return Targets::default();
        }
        let vp = self.cam.viewport();
        let area = vp.inflate(vp.w.max(vp.h));
        let rects = self.scene.query(&area).into_iter().filter_map(|h| {
            let it = self.scene.get(h)?;
            (it.visible() && it.has(F_SNAP) && !exclude.contains(&h)).then(|| it.rect.rotated_bounds(it.rot))
        });
        Targets::from_rects(rects)
    }

    pub fn pointer_move(&mut self, pid: i32, sx: f64, sy: f64, buttons: u32, mods: u32) -> bool {
        self.mods = mods;
        if let Some(p) = self.pointers.iter_mut().find(|p| p.0 == pid) {
            p.1 = sx;
            p.2 = sy;
        }
        let mine = |p: i32| p == pid;
        match self.gesture.clone() {
            Gesture::Idle => {
                self.last_pointer = Some((pid, sx, sy));
                if buttons == 0 {
                    self.update_hover(sx, sy);
                }
                false
            }
            Gesture::Pending { pid: p, sx: x0, sy: y0, wx, wy, target, drag, additive, .. } if mine(p) => {
                self.last_pointer = Some((pid, sx, sy));
                if ((sx - x0).powi(2) + (sy - y0).powi(2)).sqrt() < self.opts.drag_px {
                    return true;
                }
                match target {
                    Some(t) if drag => {
                        let ids = self.drag_ids(t);
                        if ids.is_empty() {
                            self.gesture = Gesture::Dead { pid };
                            return true;
                        }
                        let orig: Vec<Rect> = ids.iter().map(|h| self.scene.get(*h).unwrap().rect).collect();
                        let fixed: Vec<bool> = ids.iter().map(|h| !self.scene.get(*h).unwrap().has(F_MOVABLE)).collect();
                        let bounds = |only_free: bool| {
                            ids.iter()
                                .zip(fixed.iter())
                                .filter(|(_, f)| !(only_free && **f))
                                .map(|(h, _)| {
                                    let it = self.scene.get(*h).unwrap();
                                    it.rect.rotated_bounds(it.rot)
                                })
                                .reduce(|a, b| a.union(&b))
                        };
                        let bbox = bounds(false).unwrap();
                        let free_bbox = bounds(true);
                        let targets = self.snap_targets(&ids);
                        self.gesture = Gesture::Moving { pid, wx, wy, ids, orig, fixed, bbox, free_bbox, targets, dx: 0.0, dy: 0.0, copy: false };
                        self.cursor = CUR_MOVE;
                        self.set_hover(None);
                        self.emit(Event::Gesture { kind: "move", phase: "start", mods: self.mods });
                        self.update_move(sx, sy);
                    }
                    Some(_) => self.gesture = Gesture::Dead { pid },
                    None => {
                        let base = if additive { self.selection.clone() } else { Vec::new() };
                        let before = self.selection.clone();
                        self.gesture = Gesture::Marquee { pid, wx, wy, cur: (wx, wy), base, before, preview: Vec::new() };
                        self.cursor = CUR_CROSSHAIR;
                        self.set_hover(None);
                        self.emit(Event::Gesture { kind: "marquee", phase: "start", mods: self.mods });
                        self.update_marquee(sx, sy);
                    }
                }
                true
            }
            Gesture::Moving { pid: p, .. } if mine(p) => {
                self.last_pointer = Some((pid, sx, sy));
                self.update_move(sx, sy);
                true
            }
            Gesture::Resizing { pid: p, .. } if mine(p) => {
                self.last_pointer = Some((pid, sx, sy));
                self.update_resize(sx, sy);
                true
            }
            Gesture::Marquee { pid: p, .. } if mine(p) => {
                self.last_pointer = Some((pid, sx, sy));
                self.update_marquee(sx, sy);
                true
            }
            Gesture::Panning { pid: p, sx: x0, sy: y0 } if mine(p) => {
                self.cam.pan_by_screen(x0 - sx, y0 - sy);
                self.gesture = Gesture::Panning { pid, sx, sy };
                self.camera_changed();
                true
            }
            Gesture::Pinch { a, b, dist, mid } if pid == a || pid == b => {
                let pa = self.pointers.iter().find(|p| p.0 == a).map(|p| (p.1, p.2));
                let pb = self.pointers.iter().find(|p| p.0 == b).map(|p| (p.1, p.2));
                if let (Some(pa), Some(pb)) = (pa, pb) {
                    let d = ((pa.0 - pb.0).powi(2) + (pa.1 - pb.1).powi(2)).sqrt().max(1.0);
                    let m = ((pa.0 + pb.0) * 0.5, (pa.1 + pb.1) * 0.5);
                    self.cam.pan_by_screen(mid.0 - m.0, mid.1 - m.1);
                    self.cam.zoom_at(d / dist, m.0, m.1);
                    self.gesture = Gesture::Pinch { a, b, dist: d, mid: m };
                    self.camera_changed();
                }
                true
            }
            Gesture::Dead { pid: p } => mine(p),
            _ => false,
        }
    }

    fn update_hover(&mut self, sx: f64, sy: f64) {
        if self.tool != TOOL_SELECT {
            self.set_hover(None);
            return;
        }
        if self.space {
            self.cursor = CUR_GRAB;
            return;
        }
        if let Some((h, handle)) = self.hit_handle(sx, sy) {
            let rot = self.scene.get(h).map_or(0.0, |i| i.rot);
            self.cursor = Self::handle_cursor(handle, rot);
            self.set_hover(None);
            return;
        }
        self.cursor = CUR_DEFAULT;
        let h = self.hit_selectable(sx, sy);
        self.set_hover(h);
    }

    fn update_move(&mut self, sx: f64, sy: f64) {
        let copy = self.copying();
        let Gesture::Moving { wx, wy, ids, orig, fixed, bbox, free_bbox, targets, .. } = &self.gesture else { return };
        // A move snaps what moves; a copy, the copies (fixed items included).
        let bbox = if copy { Some(*bbox) } else { *free_bbox };
        let (cx, cy) = self.world(sx, sy);
        let (mut dx, mut dy) = (cx - wx, cy - wy);
        let lock = self.mods & SHIFT != 0;
        if lock {
            if dx.abs() >= dy.abs() {
                dy = 0.0;
            } else {
                dx = 0.0;
            }
        }
        let mut guides = Vec::new();
        if let Some(bbox) = bbox
            && self.opts.snap
            && self.mods & (CTRL | META) == 0 {
            let th = self.opts.snap_px / self.cam.zoom;
            let moved = bbox.translate(dx, dy);
            let (ax, ay, g) = snap::snap_box(targets, &moved, th, !(lock && dx == 0.0), !(lock && dy == 0.0));
            dx += ax;
            dy += ay;
            guides = g;
        }
        let ids = ids.clone();
        let orig = orig.clone();
        let fixed = fixed.clone();
        self.place_moved(&ids, &orig, &fixed, dx, dy, copy);
        if let Gesture::Moving { dx: gx, dy: gy, copy: gc, .. } = &mut self.gesture {
            *gx = dx;
            *gy = dy;
            *gc = copy;
        }
        self.guides = guides;
        self.rd.overlay_dirty = true;
        self.needs_render = true;
        if self.opts.drag_events {
            self.emit(Event::Dragging { ids, dx, dy, mods: self.mods });
        }
    }

    /// Puts the dragged items where a move by (dx, dy) leaves them: a copy leaves all of them
    /// in place (its ghosts show the copies), a move leaves the fixed ones.
    fn place_moved(&mut self, ids: &[u32], orig: &[Rect], fixed: &[bool], dx: f64, dy: f64, copy: bool) {
        for ((h, r), f) in ids.iter().zip(orig.iter()).zip(fixed.iter()) {
            let at = if copy || *f { *r } else { r.translate(dx, dy) };
            if let Some(it) = self.scene.get_mut(*h)
                && it.rect != at {
                it.rect = at;
                self.scene.dirty.push(*h);
            }
        }
    }

    fn update_resize(&mut self, sx: f64, sy: f64) {
        let Gesture::Resizing { id, handle, orig, rot, grab, targets, .. } = &self.gesture else { return };
        let (id, handle, orig, rot, grab) = (*id, *handle, *orig, *rot, *grab);
        let (wx, wy) = self.world(sx, sy);
        let (qx0, qy0) = to_local(&orig, rot, wx, wy);
        let (hw, hh) = (orig.w * 0.5, orig.h * 0.5);
        // Keep the grab offset so the edge does not jump to the pointer.
        let ax = if handle & H_L != 0 { -hw } else if handle & H_R != 0 { hw } else { 0.0 };
        let ay = if handle & H_T != 0 { -hh } else if handle & H_B != 0 { hh } else { 0.0 };
        let (qx, qy) = (qx0 - (grab.0 - ax), qy0 - (grab.1 - ay));
        let min = 1.0 / self.cam.zoom;
        let (mut l, mut t, mut r, mut b) = (-hw, -hh, hw, hh);
        if handle & H_L != 0 {
            l = qx.min(r - min);
        }
        if handle & H_R != 0 {
            r = qx.max(l + min);
        }
        if handle & H_T != 0 {
            t = qy.min(b - min);
        }
        if handle & H_B != 0 {
            b = qy.max(t + min);
        }
        let flags = self.scene.get(id).map_or(0, |i| i.flags);
        let lock = (self.mods & SHIFT != 0 || flags & F_LOCK_ASPECT != 0) && orig.w > 0.0 && orig.h > 0.0;
        let horiz = handle & (H_L | H_R) != 0;
        let vert = handle & (H_T | H_B) != 0;
        let corner = horiz && vert;
        let (ocx, ocy) = (orig.cx(), orig.cy());
        let snapping = rot == 0.0 && self.opts.snap && self.mods & (CTRL | META) == 0;
        let th = self.opts.snap_px / self.cam.zoom;
        let mut snapped = false;
        // Dragged edges snap one by one, except a corner keeping its aspect (below).
        if snapping && !(lock && corner) {
            if horiz {
                let (v, dir) = if handle & H_L != 0 { (ocx + l, -1.0) } else { (ocx + r, 1.0) };
                if let Some(d) = snap::snap_edge(&targets.xs, v, th, dir, r - l) {
                    snapped = true;
                    if handle & H_L != 0 {
                        l = (l + d).min(r - min);
                    } else {
                        r = (r + d).max(l + min);
                    }
                }
            }
            if vert {
                let (v, dir) = if handle & H_T != 0 { (ocy + t, -1.0) } else { (ocy + b, 1.0) };
                if let Some(d) = snap::snap_edge(&targets.ys, v, th, dir, b - t) {
                    snapped = true;
                    if handle & H_T != 0 {
                        t = (t + d).min(b - min);
                    } else {
                        b = (b + d).max(t + min);
                    }
                }
            }
        }
        if lock {
            let aspect = orig.w / orig.h;
            if corner {
                // The pointer projected onto the diagonal: the larger of the two scales.
                let s = ((r - l) / orig.w).max((b - t) / orig.h);
                let (nw, nh) = (orig.w * s, orig.h * s);
                if handle & H_L != 0 {
                    l = r - nw;
                } else {
                    r = l + nw;
                }
                if handle & H_T != 0 {
                    t = b - nh;
                } else {
                    b = t + nh;
                }
                if snapping
                    && let Some(edges) = diagonal_snap(targets, (ocx, ocy), handle, (l, t, r, b), aspect, th) {
                    (l, t, r, b) = edges;
                    snapped = true;
                }
            } else if horiz {
                let nh = (r - l) / aspect;
                t = -nh * 0.5;
                b = nh * 0.5;
            } else if vert {
                let nw = (b - t) * aspect;
                l = -nw * 0.5;
                r = nw * 0.5;
            }
        }
        let mut guides = Vec::new();
        if snapping && (snapped || !lock) {
            let nr = Rect::new(ocx + l, ocy + t, r - l, b - t);
            // Only the dragged edges: those an edge drag keeps centred show none.
            let xs: Vec<f64> = [(H_L, nr.x), (H_R, nr.right())].iter().filter(|(e, _)| handle & e != 0).map(|(_, v)| *v).collect();
            let ys: Vec<f64> = [(H_T, nr.y), (H_B, nr.bottom())].iter().filter(|(e, _)| handle & e != 0).map(|(_, v)| *v).collect();
            // Sliding along the diagonal lands one edge on its line; the other shows its own when within half a unit.
            guides = if lock && corner { snap::guides_near(targets, &nr, &xs, &ys, snap::MIN_EXTENT) } else { snap::guides_for(targets, &nr, &xs, &ys) };
        }
        let (w, h) = (r - l, b - t);
        let (cx, cy) = rotate((l + r) * 0.5, (t + b) * 0.5, rot);
        let rect = Rect::new(ocx + cx - w * 0.5, ocy + cy - h * 0.5, w, h);
        if let Some(it) = self.scene.get_mut(id) {
            it.rect = rect;
        }
        self.scene.dirty.push(id);
        if let Gesture::Resizing { rect: gr, .. } = &mut self.gesture {
            *gr = rect;
        }
        self.guides = guides;
        self.rd.overlay_dirty = true;
        self.needs_render = true;
        if self.opts.drag_events {
            self.emit(Event::Resizing { id, rect, mods: self.mods });
        }
    }

    fn update_marquee(&mut self, sx: f64, sy: f64) {
        let Gesture::Marquee { wx, wy, base, .. } = &self.gesture else { return };
        let cur = self.world(sx, sy);
        let rect = Rect::from_points((*wx, *wy), cur);
        let mut sel = base.clone();
        let mut hits: Vec<u32> = self
            .scene
            .query(&rect)
            .into_iter()
            .filter(|h| {
                self.scene.get(*h).is_some_and(|it| {
                    it.visible() && it.has(F_SELECTABLE) && if self.opts.marquee_contain { rect.contains_rect(&it.aabb) } else { true }
                })
            })
            .collect();
        hits.sort_by_key(|h| self.scene.get(*h).map_or(0, |i| i.rank));
        for h in hits {
            dedup_push(&mut sel, h);
        }
        if !self.opts.controlled {
            self.selection = sel.clone();
        }
        if let Gesture::Marquee { cur: c, preview, .. } = &mut self.gesture {
            *c = cur;
            *preview = sel;
        }
        self.rd.overlay_dirty = true;
        self.needs_render = true;
    }

    pub fn pointer_up(&mut self, pid: i32, sx: f64, sy: f64, _button: u32, mods: u32) -> bool {
        self.mods = mods;
        self.pointers.retain(|p| p.0 != pid);
        let handled = match std::mem::replace(&mut self.gesture, Gesture::Idle) {
            Gesture::Idle => {
                self.gesture = Gesture::Idle;
                false
            }
            Gesture::Pending { pid: p, target, deselect_to, additive, .. } if p == pid => {
                if target.is_none() && !additive && !self.selection.is_empty() {
                    self.propose_selection(Vec::new());
                }
                if let Some(h) = deselect_to {
                    self.propose_selection(vec![h]);
                }
                true
            }
            Gesture::Dead { pid: p } if p == pid => true,
            Gesture::Moving { pid: p, ids, orig, fixed, dx, dy, .. } if p == pid => {
                // Copy or move is decided by the keys held at release.
                let copy = self.copying();
                self.place_moved(&ids, &orig, &fixed, dx, dy, copy);
                for h in &ids {
                    self.scene.reindex(*h);
                }
                self.guides.clear();
                if dx != 0.0 || dy != 0.0 {
                    if copy {
                        self.emit(Event::Commit(Commit::Copy { ids, dx, dy }, self.mods));
                    } else {
                        let free: Vec<u32> = ids.iter().zip(fixed.iter()).filter(|(_, f)| !**f).map(|(h, _)| *h).collect();
                        if !free.is_empty() {
                            self.emit(Event::Commit(Commit::Move { ids: free, dx, dy }, self.mods));
                        }
                    }
                }
                self.emit(Event::Gesture { kind: "move", phase: "end", mods: self.mods });
                true
            }
            Gesture::Resizing { pid: p, id, orig, rect, .. } if p == pid => {
                self.scene.reindex(id);
                self.guides.clear();
                if rect != orig {
                    self.emit(Event::Commit(Commit::Resize { id, rect }, self.mods));
                }
                self.emit(Event::Gesture { kind: "resize", phase: "end", mods: self.mods });
                true
            }
            Gesture::Marquee { pid: p, before, preview, .. } if p == pid => {
                if self.opts.controlled {
                    self.emit(Event::Commit(Commit::Select { ids: preview }, self.mods));
                } else if preview != before {
                    self.emit(Event::Selection(preview, self.mods));
                }
                self.emit(Event::Gesture { kind: "marquee", phase: "end", mods: self.mods });
                true
            }
            Gesture::Panning { pid: p, .. } if p == pid => {
                self.emit(Event::Gesture { kind: "pan", phase: "end", mods: self.mods });
                true
            }
            Gesture::Pinch { a, b, .. } if pid == a || pid == b => {
                self.emit(Event::Gesture { kind: "pinch", phase: "end", mods: self.mods });
                true
            }
            other => {
                // Another pointer's release: the gesture goes on.
                self.gesture = other;
                false
            }
        };
        if matches!(self.gesture, Gesture::Idle) {
            self.cursor = if self.space || self.tool == TOOL_PAN { CUR_GRAB } else { CUR_DEFAULT };
            self.rd.overlay_dirty = true;
            self.needs_render = true;
            if handled {
                self.update_hover(sx, sy);
            }
        }
        handled
    }

    pub fn pointer_cancel(&mut self, pid: i32) {
        self.pointers.retain(|p| p.0 != pid);
        self.cancel_gesture();
    }

    pub fn pointer_leave(&mut self) {
        if matches!(self.gesture, Gesture::Idle) {
            self.set_hover(None);
        }
    }

    /// Abandons the gesture in progress, restoring what it changed (no commit).
    pub fn cancel_gesture(&mut self) {
        let g = std::mem::replace(&mut self.gesture, Gesture::Idle);
        let kind = match g {
            Gesture::Moving { ids, orig, .. } => {
                for (h, r) in ids.iter().zip(orig.iter()) {
                    if let Some(it) = self.scene.get_mut(*h) {
                        it.rect = *r;
                    }
                    self.scene.dirty.push(*h);
                }
                "move"
            }
            Gesture::Resizing { id, orig, .. } => {
                if let Some(it) = self.scene.get_mut(id) {
                    it.rect = orig;
                }
                self.scene.dirty.push(id);
                "resize"
            }
            Gesture::Marquee { before, .. } => {
                if !self.opts.controlled {
                    self.selection = before;
                }
                "marquee"
            }
            Gesture::Panning { .. } => "pan",
            Gesture::Pinch { .. } => "pinch",
            _ => "",
        };
        self.guides.clear();
        self.cursor = if self.space || self.tool == TOOL_PAN { CUR_GRAB } else { CUR_DEFAULT };
        self.rd.overlay_dirty = true;
        self.needs_render = true;
        if !kind.is_empty() {
            self.emit(Event::Gesture { kind, phase: "cancel", mods: self.mods });
        }
    }

    // ------------------------------------------------------------------ frame

    /// Advances animations, emits throttled events and brings the render data up to
    /// date. Returns FRAME_* bits.
    pub fn frame(&mut self, now: f64) -> u32 {
        self.now = now;
        self.tex.frame += 1;
        if let Some(mut g) = self.glide {
            if !g.started {
                g.started = true;
                g.start = now;
            }
            match g.at(now, self.cam.vw, self.cam.vh) {
                Some((x, y, z)) => {
                    self.cam.set(x, y, z);
                    self.glide = Some(g);
                }
                None => {
                    self.cam.set(g.to.0, g.to.1, g.to.2);
                    self.glide = None;
                }
            }
            self.camera_changed();
        }
        if self.cam_dirty && self.last_cam_emit == f64::NEG_INFINITY {
            // The first frame reports where the camera starts; it is not a move.
            self.cam_dirty = false;
            self.emit_camera(true);
        } else if self.cam_dirty {
            self.cam_dirty = false;
            self.last_cam_change = now;
            if !self.moving {
                self.moving = true;
                self.emit(Event::Moving(true));
            }
            if now - self.last_cam_emit >= self.opts.camera_ms {
                self.emit_camera(false);
            } else {
                self.cam_emit_pending = true;
            }
        } else if self.moving && now - self.last_cam_change >= self.opts.settle_ms {
            self.moving = false;
            self.emit(Event::Moving(false));
            self.emit_camera(true);
            self.retessellate_visible();
        } else if self.cam_emit_pending && now - self.last_cam_emit >= self.opts.camera_ms {
            self.emit_camera(false);
        }

        // Path geometry that changed in place; a layout if it no longer fits.
        if !self.scene.structure_dirty && !self.scene.geom_dirty.is_empty() {
            self.write_geometry();
        }
        if self.scene.structure_dirty {
            self.layout();
            self.visible_dirty = true;
        }
        let mut holes = false;
        if self.visible_dirty {
            self.visible_dirty = false;
            self.update_visible();
            self.drain_evictions();
            holes = true;
        }
        if !self.scene.dirty.is_empty() {
            self.write_dirty();
        }
        if !self.fading.is_empty() {
            let fading = std::mem::take(&mut self.fading);
            for h in &fading {
                self.write_item(*h);
            }
            let (now, ms) = (self.now, self.opts.fade_ms);
            self.fading = fading.into_iter().filter(|h| self.scene.get(*h).is_some_and(|i| render::fade(now, i.fade_start, ms) < 1.0)).collect();
            self.needs_render = true;
        }
        if self.holes_dirty {
            self.holes_dirty = false;
            self.compute_holes();
            holes = true;
        }
        if self.rd.overlay_dirty {
            self.build_overlay();
            self.needs_render = true;
        }
        let mut out = 0;
        if self.needs_render {
            out |= FRAME_RENDER;
            self.needs_render = false;
        }
        if holes {
            out |= FRAME_HOLES;
        }
        if self.glide.is_some() || self.moving || !self.fading.is_empty() || self.cam_emit_pending {
            out |= FRAME_MORE;
        }
        out
    }

    /// The finest grid level drawn at the current zoom (world spacing) and how far it has faded
    /// in (0–1, smoothstep): levels grow by `grid_major` until their screen spacing reaches
    /// the start of `grid_fade`, and fade in until its end.
    pub fn grid_level(&self) -> (f64, f32) {
        let o = &self.opts;
        let z = self.cam.zoom;
        let (start, end) = o.grid_fade;
        let mut sp = o.grid_spacing;
        while sp * z < start {
            sp *= o.grid_major;
        }
        let t = if end > start { ((sp * z - start) / (end - start)).clamp(0.0, 1.0) } else { 1.0 };
        (sp, (t * t * (3.0 - 2.0 * t)) as f32)
    }

    fn emit_camera(&mut self, settled: bool) {
        self.last_cam_emit = self.now;
        self.cam_emit_pending = false;
        let (x, y, zoom) = self.cam.state();
        self.emit(Event::Camera { x, y, zoom, settled });
    }

    /// After the camera settles, paths drawn much larger than they were flattened for are re-flattened.
    fn retessellate_visible(&mut self) {
        let level = self.tess_level();
        let vis = self.scene.query(&self.cam.viewport());
        for h in vis {
            let Some(it) = self.scene.get_mut(h) else { continue };
            let (w, hgt) = (it.rect.w, it.rect.h);
            if let Some(p) = it.path.as_mut()
                && p.tess_level < level {
                p.rebuild(w, hgt, level);
                self.scene.geom_dirty.push(h);
                self.needs_render = true;
            }
        }
    }

    /// Rebuilds the draw order, instance buffer, path arena and batches.
    pub fn layout(&mut self) {
        let order = self.scene.draw_order();
        let n = order.len() as u32;
        let page = self.tex.page;
        let now = self.now;
        let fade_ms = self.opts.fade_ms;
        let rd = &mut self.rd;
        rd.quads.clear();
        rd.holes.clear();
        rd.verts.clear();
        rd.indices.clear();
        rd.slots.clear();
        rd.batches.clear();
        rd.ranked = n;
        let mut slot: u32 = 0;
        for it in self.scene.items.iter_mut().flatten() {
            it.inst = u32::MAX;
            it.inst_n = 0;
            it.slot = u32::MAX;
        }
        for (rank, h) in order.iter().enumerate() {
            let it = self.scene.items[*h as usize].as_mut().unwrap();
            it.rank = rank as u32;
            let depth = render::depth(rank as u32, n);
            match it.kind {
                Kind::Box => {
                    let start = rd.quads.len() as u32;
                    render::box_quads(it, depth, page, render::fade(now, it.fade_start, fade_ms), &mut rd.quads);
                    it.inst = start;
                    it.inst_n = rd.quads.len() as u32 - start;
                    let multiply = it.has(F_MULTIPLY);
                    match rd.batches.last_mut() {
                        Some(Batch::Quads { count, multiply: m, .. }) if *m == multiply => *count += it.inst_n,
                        _ => rd.batches.push(Batch::Quads { first: start, count: it.inst_n, multiply }),
                    }
                }
                Kind::Hole => {
                    it.inst = rd.holes.len() as u32;
                    it.inst_n = 1;
                    rd.holes.push(render::hole_quad(it, depth));
                }
                Kind::Path => {
                    let Some(p) = &it.path else { continue };
                    it.slot = slot;
                    slot += 1;
                    rd.slots.extend_from_slice(&render::path_slot(it, depth));
                    let g = &p.geom;
                    let nv = g.verts.len() as u32;
                    let ni = g.indices.len() as u32;
                    it.vstart = rd.verts.len() as u32;
                    it.vcap = nv + nv / 4 + 8;
                    it.istart = rd.indices.len() as u32;
                    it.icap = ni + (ni / 12) * 3 + 12;
                    let s = it.slot as u16;
                    for (v, k) in g.verts.iter().zip(g.kinds.iter()) {
                        rd.verts.push(PathVertex { x: v[0], y: v[1], slot: s, kind: *k as u16 });
                    }
                    rd.verts.resize(rd.verts.len() + (it.vcap - nv) as usize, PathVertex { x: 0.0, y: 0.0, slot: s, kind: 0 });
                    let vs = it.vstart;
                    rd.indices.extend(g.indices.iter().map(|i| i + vs));
                    rd.indices.resize(rd.indices.len() + (it.icap - ni) as usize, vs);
                    let multiply = it.has(F_MULTIPLY);
                    match rd.batches.last_mut() {
                        Some(Batch::Paths { count, multiply: m, .. }) if *m == multiply => *count += it.icap,
                        _ => rd.batches.push(Batch::Paths { first: it.istart, count: it.icap, multiply }),
                    }
                }
            }
        }
        rd.generation += 1;
        rd.quads_dirty = Default::default();
        rd.verts_dirty = Default::default();
        rd.indices_dirty = Default::default();
        rd.slots_dirty = Default::default();
        rd.holes_dirty = true;
        rd.overlay_dirty = true;
        self.scene.structure_dirty = false;
        self.scene.dirty.clear();
        self.scene.geom_dirty.clear();
        self.holes_dirty = true;
        self.needs_render = true;
    }

    /// Writes changed path geometry into its arena range; falls back to a layout when it does not fit.
    fn write_geometry(&mut self) {
        let list = std::mem::take(&mut self.scene.geom_dirty);
        for h in &list {
            let Some(it) = self.scene.get(*h) else { continue };
            let Some(p) = &it.path else { continue };
            if it.slot == u32::MAX || p.geom.verts.len() as u32 > it.vcap || p.geom.indices.len() as u32 > it.icap {
                self.scene.structure_dirty = true;
                return;
            }
        }
        let rd = &mut self.rd;
        for h in list {
            let it = self.scene.get(h).unwrap();
            let g = &it.path.as_ref().unwrap().geom;
            let s = it.slot as u16;
            let (vs, is) = (it.vstart as usize, it.istart as usize);
            for k in 0..it.vcap as usize {
                rd.verts[vs + k] = match g.verts.get(k) {
                    Some(v) => PathVertex { x: v[0], y: v[1], slot: s, kind: g.kinds[k] as u16 },
                    None => PathVertex { x: 0.0, y: 0.0, slot: s, kind: 0 },
                };
            }
            for k in 0..it.icap as usize {
                rd.indices[is + k] = g.indices.get(k).map_or(it.vstart, |i| i + it.vstart);
            }
            rd.verts_dirty.add(vs, vs + it.vcap as usize);
            rd.indices_dirty.add(is, is + it.icap as usize);
            self.scene.dirty.push(h);
        }
        self.needs_render = true;
    }

    fn write_item(&mut self, h: u32) {
        let Some(it) = self.scene.get(h) else { return };
        if !it.visible() || it.inst_n == 0 && it.slot == u32::MAX {
            return;
        }
        let depth = render::depth(it.rank, self.rd.ranked);
        match it.kind {
            Kind::Box => {
                let mut q: Vec<Quad> = Vec::with_capacity(2);
                render::box_quads(it, depth, self.tex.page, render::fade(self.now, it.fade_start, self.opts.fade_ms), &mut q);
                if q.len() as u32 != it.inst_n {
                    self.scene.structure_dirty = true;
                    return;
                }
                let s = it.inst as usize;
                self.rd.quads[s..s + q.len()].copy_from_slice(&q);
                self.rd.quads_dirty.add(s, s + q.len());
            }
            Kind::Hole => {
                self.rd.holes[it.inst as usize] = render::hole_quad(it, depth);
                self.rd.holes_dirty = true;
                self.holes_dirty = true;
            }
            Kind::Path => {
                let s = it.slot as usize * SLOT_FLOATS;
                let data = render::path_slot(it, depth);
                self.rd.slots[s..s + SLOT_FLOATS].copy_from_slice(&data);
                self.rd.slots_dirty.add(s, s + SLOT_FLOATS);
            }
        }
        self.needs_render = true;
    }

    fn write_dirty(&mut self) {
        let mut list = std::mem::take(&mut self.scene.dirty);
        list.sort_unstable();
        list.dedup();
        for h in list {
            self.write_item(h);
        }
        if self.scene.structure_dirty {
            self.layout();
        }
        // Selection outlines follow moved items.
        self.rd.overlay_dirty = true;
    }

    /// Texture resolution choice and requests for what is on screen.
    fn update_visible(&mut self) {
        let vp = self.cam.viewport();
        let vis = self.scene.query(&vp);
        self.visible_count = vis.len() as u32;
        let scale = self.cam.zoom * self.cam.dpr;
        let mut needed = Vec::new();
        let recent = self.opts.fade_ms + 1000.0;
        for h in vis {
            let Some(it) = self.scene.get(h) else { continue };
            if !it.visible() {
                continue;
            }
            let Some(key) = it.style.texture else { continue };
            let want = it.rect.w * scale;
            // A texture that replaced one on screen shows at once: only one that replaces the placeholder fades in.
            let had = it.tex.is_some() || it.tex_replaced;
            let place = self.tex.choose(key, want);
            if place.is_none() && self.tex.request(key) {
                needed.push(key);
            }
            if place != it.tex || it.tex_replaced {
                let arrived = self.tex.arrived(key);
                let now = self.now;
                let it = self.scene.get_mut(h).unwrap();
                it.tex = place;
                it.tex_replaced = false;
                if !had && place.is_some() && now - arrived < recent && self.opts.fade_ms > 0.0 {
                    it.fade_start = now;
                    self.fading.push(h);
                } else if !had {
                    it.fade_start = f64::NEG_INFINITY;
                }
                self.scene.dirty.push(h);
            }
        }
        if !needed.is_empty() {
            needed.sort_unstable();
            needed.dedup();
            self.emit(Event::TextureNeeded(needed));
        }
    }

    /// Screen rects of the visible holes: [handle, x, y, w, h, rotation, zoom] each.
    fn compute_holes(&mut self) {
        self.holes_out.clear();
        let vp = self.cam.viewport();
        let z = self.cam.zoom;
        let mut n = 0;
        for h in self.scene.query(&vp) {
            let Some(it) = self.scene.get(h) else { continue };
            if it.kind != Kind::Hole || !it.visible() {
                continue;
            }
            n += 1;
            let (sx, sy) = self.cam.world_to_screen(it.rect.x, it.rect.y);
            self.holes_out.extend_from_slice(&[h as f32, sx as f32, sy as f32, (it.rect.w * z) as f32, (it.rect.h * z) as f32, it.rot as f32, z as f32]);
        }
        self.rd.hole_count_visible = n;
    }

    fn outline(&self, r: Rect, rot: f64, color: u32, px: f32, out: &mut Vec<Quad>) {
        let (s, c) = rot.sin_cos();
        out.push(Quad {
            rect: [r.x as f32, r.y as f32, r.w as f32, r.h as f32],
            rot: [c as f32, s as f32],
            fill: [0; 4],
            stroke: render::rgba(color),
            params: [0.0, px, 1.0, MODE_BOX],
            uv: [0.0; 4],
            tex: [-1.0, 0.0, 0.0, QF_STROKE_SCREEN],
            dash: [0.0, 0.0, 1.0, 0.0],
        });
    }

    fn solid(&self, r: Rect, rot: f64, fill: u32, stroke: u32, px: f32, radius: f32, mode: f32, out: &mut Vec<Quad>) {
        let (s, c) = rot.sin_cos();
        out.push(Quad {
            rect: [r.x as f32, r.y as f32, r.w as f32, r.h as f32],
            rot: [c as f32, s as f32],
            fill: render::rgba(fill),
            stroke: render::rgba(stroke),
            params: [radius, px, 1.0, mode],
            uv: [0.0; 4],
            tex: [-1.0, 0.0, 0.0, QF_STROKE_SCREEN],
            dash: [0.0, 0.0, 1.0, 0.0],
        });
    }

    /// Selection, handles, hover, marquee, guides and peers, in world units for the current zoom.
    fn build_overlay(&mut self) {
        self.rd.overlay_dirty = false;
        let mut out: Vec<Quad> = Vec::new();
        let z = self.cam.zoom;
        let th = &self.opts.theme;
        // Peers first (under the local selection).
        for p in &self.peers {
            for h in &p.selection {
                if let Some(it) = self.scene.get(*h).filter(|i| i.visible()) {
                    self.outline(it.rect, it.rot, p.color, 2.0, &mut out);
                }
            }
        }
        if let Some(h) = self.hover.filter(|h| !self.selection.contains(h))
            && let Some(it) = self.scene.get(h).filter(|i| i.visible() && !i.has(F_NO_HOVER)) {
            self.outline(it.rect, it.rot, th.hover, 1.5, &mut out);
        }
        let shown: &[u32] = match &self.gesture {
            Gesture::Marquee { preview, .. } if self.opts.controlled => preview,
            _ => &self.selection,
        };
        let mut group: Option<Rect> = None;
        for h in shown {
            if let Some(it) = self.scene.get(*h).filter(|i| i.visible()) {
                if !it.has(F_NO_OUTLINE) {
                    self.outline(it.rect, it.rot, th.selection, 1.5, &mut out);
                }
                let b = it.rect.rotated_bounds(it.rot);
                group = Some(group.map_or(b, |g| g.union(&b)));
            }
        }
        if shown.len() > 1
            && let Some(g) = group {
            self.outline(g, 0.0, th.selection, 1.0, &mut out);
        }
        let gesture_hides_handles = matches!(self.gesture, Gesture::Moving { .. } | Gesture::Marquee { .. });
        if !gesture_hides_handles
            && let Some((_, r, rot, flags)) = self.handle_target() {
            let size = self.opts.handle_px / z;
            for &(code, ux, uy) in HANDLES.iter() {
                if !self.shows_handle(&r, flags, code) {
                    continue;
                }
                let (dx, dy) = rotate(ux * r.w * 0.5, uy * r.h * 0.5, rot);
                let c = (r.cx() + dx, r.cy() + dy);
                let hr = Rect::new(c.0 - size * 0.5, c.1 - size * 0.5, size, size);
                self.solid(hr, rot, th.handle, th.selection, 1.0, (1.5 / z) as f32, MODE_BOX, &mut out);
            }
        }
        if let Gesture::Marquee { wx, wy, cur, .. } = &self.gesture {
            let r = Rect::from_points((*wx, *wy), *cur);
            self.solid(r, 0.0, th.marquee, th.selection, 1.0, 0.0, MODE_BOX, &mut out);
        }
        if let Gesture::Moving { ids, orig, dx, dy, copy: true, .. } = &self.gesture {
            // Where the copies will land.
            let fill = (th.selection & 0xffff_ff00) | 0x29;
            for (h, r) in ids.iter().zip(orig.iter()) {
                let rot = self.scene.get(*h).map_or(0.0, |i| i.rot);
                self.solid(r.translate(*dx, *dy), rot, fill, th.selection, 1.0, 0.0, MODE_BOX, &mut out);
            }
        }
        for g in self.guides.iter().chain(self.host_guides.iter()) {
            let w = 1.0 / z;
            let r = if g.vertical { Rect::new(g.at - w * 0.5, g.lo, w, g.hi - g.lo) } else { Rect::new(g.lo, g.at - w * 0.5, g.hi - g.lo, w) };
            self.solid(r, 0.0, th.guide, 0, 0.0, 0.0, MODE_BOX, &mut out);
        }
        for p in &self.peers {
            if let Some((x, y)) = p.cursor {
                let r = Rect::new(x, y, 14.0 / z, 20.0 / z);
                self.solid(r, 0.0, p.color, 0xffffffff, 1.5, 0.0, MODE_CURSOR, &mut out);
            }
        }
        self.rd.overlay = out;
    }
}

/// Slides a box resized from a corner with its aspect kept along its diagonal onto the
/// nearest line in front of the fixed corner. Each line's distance is scaled by how far the
/// other axis moves with it (at least 1), so the nearest jump wins. Local edges
/// (l, t, r, b) around `centre`; returns the new ones.
fn diagonal_snap(targets: &Targets, centre: (f64, f64), handle: u8, (l, t, r, b): (f64, f64, f64, f64), aspect: f64, th: f64) -> Option<(f64, f64, f64, f64)> {
    let left = handle & H_L != 0;
    let top = handle & H_T != 0;
    let (fx, fy) = (if left { r } else { l }, if top { b } else { t });
    let (mx, my) = (if left { l } else { r }, if top { t } else { b });
    let (dir_x, dir_y) = (if left { -1.0 } else { 1.0 }, if top { -1.0 } else { 1.0 });
    // Moving x by d moves y by d / aspect, and the other way round.
    let (kx, ky) = ((1.0 / aspect).max(1.0), aspect.max(1.0));
    let mut best: Option<(bool, f64, f64)> = None;
    for d in snap::edge_moves(&targets.xs, centre.0 + mx, th, dir_x, r - l) {
        let cost = d.abs() * kx;
        if cost <= th && best.is_none_or(|b| cost < b.2) {
            best = Some((true, d, cost));
        }
    }
    for d in snap::edge_moves(&targets.ys, centre.1 + my, th, dir_y, b - t) {
        let cost = d.abs() * ky;
        if cost <= th && best.is_none_or(|b| cost < b.2) {
            best = Some((false, d, cost));
        }
    }
    let (on_x, d, _) = best?;
    let (w, h) = if on_x {
        let w = (mx + d - fx).abs();
        (w, w / aspect)
    } else {
        let h = (my + d - fy).abs();
        (h * aspect, h)
    };
    let (l, r) = if left { (fx - w, r) } else { (l, fx + w) };
    let (t, b) = if top { (fy - h, b) } else { (t, fy + h) };
    Some((l, t, r, b))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{record, F_HITTABLE, F_VISIBLE, REC};

    const ALL: u32 = F_VISIBLE | F_HITTABLE | F_SELECTABLE | F_MOVABLE | F_RESIZABLE | F_SNAP;

    fn engine(items: &[(u32, Rect)]) -> Engine {
        let mut e = Engine::new(2048, 5, 1e9);
        e.resize(1000.0, 800.0, 1.0);
        let mut ops = Vec::new();
        for (h, r) in items {
            ops.extend(record(*h, 0, *r, ALL));
        }
        e.apply(&ops, &[]);
        e.frame(0.0);
        e.take_events();
        e
    }

    fn commits(e: &mut Engine) -> Vec<Commit> {
        e.take_events().into_iter().filter_map(|ev| if let Event::Commit(c, _) = ev { Some(c) } else { None }).collect()
    }

    fn drag(e: &mut Engine, from: (f64, f64), to: (f64, f64), mods: u32) {
        e.pointer_down(1, from.0, from.1, 0, mods, PTR_MOUSE);
        for k in 1..=10 {
            let t = k as f64 / 10.0;
            e.pointer_move(1, from.0 + (to.0 - from.0) * t, from.1 + (to.1 - from.1) * t, 1, mods);
        }
        e.pointer_up(1, to.0, to.1, 0, mods);
    }

    #[test]
    fn click_selects_and_empty_click_clears() {
        let mut e = engine(&[(0, Rect::new(100.0, 100.0, 100.0, 100.0))]);
        e.pointer_down(1, 150.0, 150.0, 0, 0, PTR_MOUSE);
        e.pointer_up(1, 150.0, 150.0, 0, 0);
        assert_eq!(e.selection, vec![0]);
        assert!(e.take_events().iter().any(|x| matches!(x, Event::Selection(v, _) if *v == vec![0])));
        e.pointer_down(1, 500.0, 500.0, 0, 0, PTR_MOUSE);
        e.pointer_up(1, 500.0, 500.0, 0, 0);
        assert!(e.selection.is_empty());
        assert!(e.take_events().iter().any(|x| matches!(x, Event::Selection(v, _) if *v == vec![])));
    }

    #[test]
    fn shift_click_toggles() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 50.0, 50.0)), (1, Rect::new(100.0, 0.0, 50.0, 50.0))]);
        for (x, mods) in [(25.0, 0), (125.0, SHIFT)] {
            e.pointer_down(1, x, 25.0, 0, mods, PTR_MOUSE);
            e.pointer_up(1, x, 25.0, 0, mods);
        }
        assert_eq!(e.selection, vec![0, 1]);
        e.pointer_down(1, 25.0, 25.0, 0, SHIFT, PTR_MOUSE);
        e.pointer_up(1, 25.0, 25.0, 0, SHIFT);
        assert_eq!(e.selection, vec![1]);
    }

    #[test]
    fn drag_emits_exactly_one_move_commit() {
        let mut e = engine(&[(0, Rect::new(100.0, 100.0, 100.0, 100.0))]);
        e.set_option(3, 0.0); // no snapping
        e.set_camera(0.0, 0.0, 2.0);
        e.frame(1.0);
        e.take_events();
        // Item at screen (200..400). Drag 60 px right, 30 px down at zoom 2 = 30, 15 world.
        drag(&mut e, (300.0, 300.0), (360.0, 330.0), 0);
        let c = commits(&mut e);
        assert_eq!(c, vec![Commit::Move { ids: vec![0], dx: 30.0, dy: 15.0 }]);
        assert_eq!(e.scene.get(0).unwrap().rect, Rect::new(130.0, 115.0, 100.0, 100.0), "mirror keeps the moved position");
        assert_eq!(e.hit_test(2.0 * 225.0, 2.0 * 210.0), Some(0), "re-indexed at the new position");
    }

    #[test]
    fn drag_moves_whole_selection_and_click_on_member_keeps_it_until_release() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 50.0, 50.0)), (1, Rect::new(100.0, 0.0, 50.0, 50.0))]);
        e.set_option(3, 0.0);
        e.set_selection(&[0, 1]);
        drag(&mut e, (25.0, 25.0), (45.0, 25.0), 0);
        assert_eq!(commits(&mut e), vec![Commit::Move { ids: vec![0, 1], dx: 20.0, dy: 0.0 }]);
        assert_eq!(e.selection, vec![0, 1]);
        // A click without a drag on a member narrows the selection to it.
        e.pointer_down(1, 45.0, 25.0, 0, 0, PTR_MOUSE);
        e.pointer_up(1, 45.0, 25.0, 0, 0);
        assert_eq!(e.selection, vec![0]);
    }

    #[test]
    fn small_moves_are_clicks_not_drags() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 50.0, 50.0))]);
        drag(&mut e, (25.0, 25.0), (26.0, 26.0), 0);
        assert!(commits(&mut e).is_empty());
    }

    #[test]
    fn drag_snaps_to_neighbour_edge_and_shows_guide() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 100.0, 100.0)), (1, Rect::new(300.0, 300.0, 50.0, 50.0))]);
        // Move item 1 so its left edge lands 3 px right of item 0's right edge (x = 103).
        e.pointer_down(1, 325.0, 325.0, 0, 0, PTR_MOUSE);
        e.pointer_move(1, 200.0, 325.0, 1, 0);
        e.pointer_move(1, 128.0, 325.0, 1, 0);
        assert!(e.guides.iter().any(|g| g.vertical && g.at == 100.0), "guides: {:?}", e.guides);
        e.pointer_up(1, 128.0, 325.0, 0, 0);
        assert_eq!(commits(&mut e), vec![Commit::Move { ids: vec![1], dx: -200.0, dy: 0.0 }]);
        assert!(e.guides.is_empty());
        // Ctrl disables snapping.
        drag(&mut e, (125.0, 325.0), (128.0 + 125.0 - 125.0 + 0.0, 330.0), CTRL);
        let c = commits(&mut e);
        assert_eq!(c, vec![Commit::Move { ids: vec![1], dx: 3.0, dy: 5.0 }]);
    }

    #[test]
    fn shift_drag_locks_axis() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 50.0, 50.0))]);
        e.set_option(3, 0.0);
        drag(&mut e, (25.0, 25.0), (125.0, 40.0), SHIFT);
        assert_eq!(commits(&mut e), vec![Commit::Move { ids: vec![0], dx: 100.0, dy: 0.0 }]);
    }

    #[test]
    fn unmovable_items_do_not_drag() {
        let mut e = engine(&[]);
        e.apply(&record(0, 0, Rect::new(0.0, 0.0, 50.0, 50.0), F_VISIBLE | F_HITTABLE | F_SELECTABLE), &[]);
        drag(&mut e, (25.0, 25.0), (125.0, 25.0), 0);
        assert!(commits(&mut e).is_empty());
        assert_eq!(e.selection, vec![0]);
    }

    #[test]
    fn resize_from_corner_handle() {
        let mut e = engine(&[(0, Rect::new(100.0, 100.0, 100.0, 50.0))]);
        e.set_option(3, 0.0);
        e.set_selection(&[0]);
        // Bottom-right handle at (200, 150).
        assert_eq!(e.hit_handle(200.0, 150.0), Some((0, H_R | H_B)));
        drag(&mut e, (200.0, 150.0), (250.0, 170.0), 0);
        assert_eq!(commits(&mut e), vec![Commit::Resize { id: 0, rect: Rect::new(100.0, 100.0, 150.0, 70.0) }]);
    }

    #[test]
    fn resize_with_aspect_lock_and_left_edge() {
        let mut e = engine(&[(0, Rect::new(100.0, 100.0, 100.0, 50.0))]);
        e.set_option(3, 0.0);
        e.set_selection(&[0]);
        drag(&mut e, (200.0, 150.0), (300.0, 160.0), SHIFT);
        assert_eq!(commits(&mut e), vec![Commit::Resize { id: 0, rect: Rect::new(100.0, 100.0, 200.0, 100.0) }]);
        // Left edge (midpoint at (100, 150)) dragged left: the right edge stays.
        drag(&mut e, (100.0, 150.0), (80.0, 150.0), 0);
        assert_eq!(commits(&mut e), vec![Commit::Resize { id: 0, rect: Rect::new(80.0, 100.0, 220.0, 100.0) }]);
    }

    #[test]
    fn resize_rotated_item_keeps_opposite_corner() {
        let mut e = engine(&[]);
        let mut r = record(0, 0, Rect::new(100.0, 100.0, 100.0, 100.0), ALL);
        r[9] = std::f64::consts::FRAC_PI_2;
        e.apply(&r, &[]);
        e.frame(1.0);
        e.set_selection(&[0]);
        e.set_option(3, 0.0);
        let before = Rect::new(100.0, 100.0, 100.0, 100.0).corners(std::f64::consts::FRAC_PI_2);
        // Local bottom-right corner, rotated 90 degrees, is at world (100, 200).
        let (h, code) = e.hit_handle(100.0, 200.0).unwrap();
        assert_eq!((h, code), (0, H_R | H_B));
        drag(&mut e, (100.0, 200.0), (80.0, 220.0), 0);
        let c = commits(&mut e);
        let Commit::Resize { rect, .. } = c[0] else { panic!("{c:?}") };
        let after = rect.corners(std::f64::consts::FRAC_PI_2);
        // Top-left (local) corner did not move.
        assert!((after[0].0 - before[0].0).abs() < 1e-9 && (after[0].1 - before[0].1).abs() < 1e-9, "{before:?} {after:?}");
        assert!((rect.w - 120.0).abs() < 1e-9 && (rect.h - 120.0).abs() < 1e-9, "{rect:?}");
    }

    #[test]
    fn marquee_selects_intersecting_and_shift_adds() {
        let mut e = engine(&[
            (0, Rect::new(0.0, 0.0, 50.0, 50.0)),
            (1, Rect::new(100.0, 0.0, 50.0, 50.0)),
            (2, Rect::new(300.0, 300.0, 50.0, 50.0)),
        ]);
        drag(&mut e, (-10.0, -10.0), (110.0, 20.0), 0);
        assert_eq!(e.selection, vec![0, 1]);
        let ev = e.take_events();
        assert!(ev.iter().any(|x| matches!(x, Event::Selection(v, _) if *v == vec![0, 1])), "{ev:?}");
        assert!(!ev.iter().any(|x| matches!(x, Event::Commit(..))));
        drag(&mut e, (290.0, 290.0), (310.0, 310.0), SHIFT);
        assert_eq!(e.selection, vec![0, 1, 2]);
        // Contain mode: only items fully inside.
        e.set_option(12, 1.0);
        drag(&mut e, (-10.0, -10.0), (120.0, 60.0), 0);
        assert_eq!(e.selection, vec![0]);
    }

    #[test]
    fn controlled_selection_emits_intents_only() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 50.0, 50.0))]);
        e.set_option(11, 1.0);
        e.pointer_down(1, 25.0, 25.0, 0, 0, PTR_MOUSE);
        e.pointer_up(1, 25.0, 25.0, 0, 0);
        assert!(e.selection.is_empty());
        assert_eq!(commits(&mut e), vec![Commit::Select { ids: vec![0] }]);
        drag(&mut e, (-10.0, -10.0), (60.0, 60.0), 0);
        assert_eq!(commits(&mut e), vec![Commit::Select { ids: vec![0] }]);
    }

    #[test]
    fn escape_cancels_and_restores() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 50.0, 50.0))]);
        e.set_option(3, 0.0);
        e.pointer_down(1, 25.0, 25.0, 0, 0, PTR_MOUSE);
        e.pointer_move(1, 125.0, 25.0, 1, 0);
        assert_eq!(e.scene.get(0).unwrap().rect.x, 100.0);
        assert!(e.key(KEY_ESCAPE, true, 0));
        assert_eq!(e.scene.get(0).unwrap().rect.x, 0.0);
        e.pointer_up(1, 125.0, 25.0, 0, 0);
        assert!(commits(&mut e).is_empty());
    }

    #[test]
    fn wheel_pans_and_ctrl_wheel_zooms_about_cursor() {
        let mut e = engine(&[]);
        e.wheel(0.0, 0.0, 30.0, 40.0, 0);
        assert_eq!((e.cam.x, e.cam.y), (30.0, 40.0));
        let before = e.cam.screen_to_world(500.0, 400.0);
        e.wheel(500.0, 400.0, 0.0, -20.0, CTRL);
        assert!(e.cam.zoom > 1.0);
        let after = e.cam.screen_to_world(500.0, 400.0);
        assert!((before.0 - after.0).abs() < 1e-9 && (before.1 - after.1).abs() < 1e-9);
        // Shift + vertical wheel pans horizontally.
        let x = e.cam.x;
        e.wheel(0.0, 0.0, 0.0, 10.0, SHIFT);
        assert!(e.cam.x > x);
    }

    #[test]
    fn wheel_zoom_per_event_follows_speed_and_limit() {
        let mut e = engine(&[]);
        e.set_option(1, 0.001);
        e.set_option(2, 1000.0);
        // One mouse notch (100 px) at 0.0025 per px, unlimited: e^0.25.
        e.set_option(18, 0.0025);
        e.set_option(19, f64::INFINITY);
        e.wheel(0.0, 0.0, 0.0, -100.0, CTRL);
        assert!((e.cam.zoom - 0.25f64.exp()).abs() < 1e-9);
        // A large delta is no longer clipped at 30 px.
        e.set_camera(0.0, 0.0, 1.0);
        e.set_option(18, 0.01);
        e.wheel(0.0, 0.0, 0.0, -100.0, CTRL);
        assert!((e.cam.zoom - 1f64.exp()).abs() < 1e-9);
        // Limited to 1.25 per event either way.
        e.set_option(19, 1.25);
        e.set_camera(0.0, 0.0, 1.0);
        e.wheel(0.0, 0.0, 0.0, -100.0, CTRL);
        assert!((e.cam.zoom - 1.25).abs() < 1e-9);
        e.wheel(0.0, 0.0, 0.0, 100.0, CTRL);
        e.wheel(0.0, 0.0, 0.0, 100.0, CTRL);
        assert!((e.cam.zoom - 0.8).abs() < 1e-9);
    }

    #[test]
    fn space_and_middle_button_pan() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 500.0, 500.0))]);
        e.key(KEY_SPACE, true, 0);
        drag(&mut e, (100.0, 100.0), (150.0, 120.0), 0);
        assert_eq!((e.cam.x, e.cam.y), (-50.0, -20.0));
        assert!(commits(&mut e).is_empty(), "panning does not move items");
        e.key(KEY_SPACE, false, 0);
        e.pointer_down(2, 0.0, 0.0, 1, 0, PTR_MOUSE);
        e.pointer_move(2, -10.0, 0.0, 4, 0);
        e.pointer_up(2, -10.0, 0.0, 1, 0);
        assert_eq!(e.cam.x, -40.0);
    }

    #[test]
    fn tool_none_leaves_pointer_to_typescript() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 50.0, 50.0))]);
        e.set_tool(TOOL_NONE);
        assert!(!e.pointer_down(1, 25.0, 25.0, 0, 0, PTR_MOUSE));
        assert!(e.selection.is_empty());
        assert!(e.wheel(0.0, 0.0, 0.0, 10.0, 0), "wheel still pans");
    }

    #[test]
    fn pinch_zooms() {
        let mut e = engine(&[]);
        e.pointer_down(1, 400.0, 400.0, 0, 0, PTR_TOUCH);
        e.pointer_down(2, 600.0, 400.0, 0, 0, PTR_TOUCH);
        e.pointer_move(2, 800.0, 400.0, 1, 0);
        assert!((e.cam.zoom - 2.0).abs() < 1e-9, "zoom {}", e.cam.zoom);
        e.pointer_up(2, 800.0, 400.0, 0, 0);
        assert!(matches!(e.gesture, Gesture::Idle));
    }

    #[test]
    fn hover_events() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 50.0, 50.0))]);
        e.pointer_move(1, 25.0, 25.0, 0, 0);
        e.pointer_move(1, 26.0, 25.0, 0, 0);
        e.pointer_move(1, 300.0, 300.0, 0, 0);
        let hovers: Vec<Event> = e.take_events().into_iter().filter(|x| matches!(x, Event::Hover(_))).collect();
        assert_eq!(hovers, vec![Event::Hover(Some(0)), Event::Hover(None)]);
    }

    #[test]
    fn camera_events_throttled_and_settle() {
        let mut e = engine(&[]);
        e.frame(1000.0);
        e.take_events();
        let mut cams = 0;
        let mut t = 1000.0;
        for _ in 0..30 {
            t += 16.0;
            e.wheel(10.0, 10.0, 0.0, 5.0, 0);
            e.frame(t);
            cams += e.take_events().iter().filter(|x| matches!(x, Event::Camera { .. })).count();
        }
        // 30 frames over 480 ms: at most one camera event per 100 ms.
        assert!((4..=6).contains(&cams), "{cams} camera events");
        assert!(e.moving);
        e.frame(t + 200.0);
        let ev = e.take_events();
        assert!(ev.contains(&Event::Moving(false)));
        assert!(ev.iter().any(|x| matches!(x, Event::Camera { settled: true, .. })));
    }

    #[test]
    fn glide_reaches_target() {
        let mut e = engine(&[]);
        e.glide_to(Rect::new(1000.0, 1000.0, 500.0, 400.0), 200.0, 0.0, 0.0);
        let mut t = 0.0;
        let mut more = true;
        while more && t < 1000.0 {
            more = e.frame(t) & FRAME_MORE != 0 && e.glide.is_some();
            t += 16.0;
        }
        assert!(e.glide.is_none());
        assert!((e.cam.zoom - 2.0).abs() < 1e-9);
        assert!((e.cam.x + 250.0 - 1250.0).abs() < 1e-6);
    }

    #[test]
    fn layout_batches_quads_and_paths_in_order() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 10.0, 10.0)), (1, Rect::new(20.0, 0.0, 10.0, 10.0))]);
        let cmds = [0.0, 0.0, 0.0, 1.0, 10.0, 10.0];
        let mut p = record(2, 2, Rect::new(0.0, 0.0, 10.0, 10.0), ALL);
        p[13] = 255.0;
        p[14] = 2.0;
        p[24] = cmds.len() as f64;
        e.apply(&p, &cmds);
        e.apply(&record(3, 0, Rect::new(40.0, 0.0, 10.0, 10.0), ALL), &[]);
        e.apply(&record(4, 1, Rect::new(60.0, 0.0, 10.0, 10.0), ALL), &[]);
        e.frame(1.0);
        let b = &e.rd.batches;
        assert_eq!(b.len(), 3, "{b:?}");
        assert!(matches!(b[0], Batch::Quads { first: 0, count: 2, .. }));
        assert!(matches!(b[1], Batch::Paths { first: 0, .. }));
        assert!(matches!(b[2], Batch::Quads { first: 2, count: 1, .. }));
        assert_eq!(e.rd.holes.len(), 1);
        // A moved path rewrites only its slot, not the layout.
        let generation0 = e.rd.generation;
        p[5] = 5.0;
        e.apply(&p, &cmds);
        e.frame(2.0);
        assert_eq!(e.rd.generation, generation0);
        assert!((e.rd.slots[4] - 5.0).abs() < 1e-6, "translation x in the slot");
        // Geometry that fits its slack is written in place too.
        let cmds2 = [0.0, 0.0, 0.0, 1.0, 10.0, 9.0];
        e.apply(&p, &cmds2);
        e.frame(3.0);
        assert_eq!(e.rd.generation, generation0);
    }

    #[test]
    fn textures_requested_once_chosen_by_size_and_evicted_lru() {
        let mut e = Engine::new(512, 1, 512.0 * 512.0 * 4.0); // one 512 layer
        e.resize(1000.0, 800.0, 1.0);
        let mut ops = Vec::new();
        for i in 0..3u32 {
            let mut r = record(i, 0, Rect::new(i as f64 * 2000.0, 0.0, 100.0, 100.0), ALL);
            r[22] = i as f64; // texture key = handle
            ops.extend(r);
        }
        e.apply(&ops, &[]);
        e.frame(0.0);
        assert_eq!(e.take_events().into_iter().find(|x| matches!(x, Event::TextureNeeded(_))), Some(Event::TextureNeeded(vec![0])));
        e.frame(16.0);
        assert!(!e.take_events().iter().any(|x| matches!(x, Event::TextureNeeded(_))), "asked once");
        e.set_texture(0, &[(64, 64), (256, 256)]);
        e.frame(32.0);
        assert_eq!(e.scene.get(0).unwrap().tex.unwrap().w, 256, "100 px on screen: the 256 one");
        assert!(e.fading.contains(&0));
        e.set_camera(0.0, 0.0, 0.5);
        e.frame(48.0);
        assert_eq!(e.scene.get(0).unwrap().tex.unwrap().w, 64, "50 px on screen: the 64 one");
        // Pan to item 1; it asks; its texture evicts key 0 (not used this frame).
        e.set_camera(2000.0, 0.0, 1.0);
        e.frame(64.0);
        assert!(e.take_events().contains(&Event::TextureNeeded(vec![1])));
        e.set_texture(1, &[(512, 512)]);
        e.frame(80.0);
        assert!(!e.tex.has_any(0), "key 0 evicted");
        assert!(e.scene.get(0).unwrap().tex.is_none(), "its item falls back to the placeholder");
        e.set_camera(0.0, 0.0, 1.0);
        e.frame(96.0);
        assert!(e.take_events().contains(&Event::TextureNeeded(vec![0])), "asked again once visible");
    }

    #[test]
    fn holes_report_screen_rects() {
        let mut e = engine(&[]);
        e.apply(&record(7, 1, Rect::new(100.0, 50.0, 200.0, 100.0), ALL), &[]);
        e.set_camera(50.0, 0.0, 2.0);
        let f = e.frame(1.0);
        assert!(f & FRAME_HOLES != 0);
        assert_eq!(e.holes_out, vec![7.0, 100.0, 100.0, 400.0, 200.0, 0.0, 2.0]);
        e.set_camera(5000.0, 0.0, 2.0);
        e.frame(2.0);
        assert!(e.holes_out.is_empty());
    }

    #[test]
    fn removing_selected_item_reports_selection() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 50.0, 50.0))]);
        e.set_selection(&[0]);
        let mut rm = vec![0.0; REC];
        rm[0] = 2.0;
        e.apply(&rm, &[]);
        assert!(e.selection.is_empty());
        assert!(e.take_events().iter().any(|x| matches!(x, Event::Selection(v, _) if *v == vec![])));
    }

    #[test]
    fn overlay_has_handles_for_single_selection() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 100.0, 100.0)), (1, Rect::new(200.0, 0.0, 100.0, 100.0))]);
        e.set_selection(&[0]);
        e.frame(1.0);
        assert_eq!(e.rd.overlay.len(), 1 + 8);
        e.set_selection(&[0, 1]);
        e.frame(2.0);
        assert_eq!(e.rd.overlay.len(), 2 + 1, "two outlines and the group box, no handles");
        e.set_peers(&[0xff0000ffu32 as f64, 1.0, 10.0, 10.0, 1.0, 1.0]);
        e.frame(3.0);
        assert_eq!(e.rd.overlay.len(), 3 + 2, "peer selection outline and cursor");
    }

    #[test]
    fn events_carry_modifiers() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 50.0, 50.0)), (1, Rect::new(100.0, 0.0, 50.0, 50.0))]);
        e.set_option(3, 0.0);
        e.pointer_down(1, 125.0, 25.0, 0, SHIFT | META, PTR_MOUSE);
        e.pointer_up(1, 125.0, 25.0, 0, SHIFT | META);
        assert!(e.take_events().contains(&Event::Selection(vec![1], SHIFT | META)));
        e.set_option(11, 1.0); // controlled
        e.pointer_down(1, 25.0, 25.0, 0, ALT, PTR_MOUSE);
        assert!(e.take_events().contains(&Event::Commit(Commit::Select { ids: vec![0] }, ALT)));
        e.pointer_up(1, 25.0, 25.0, 0, ALT);
        drag(&mut e, (125.0, 25.0), (145.0, 25.0), CTRL);
        let ev = e.take_events();
        assert!(ev.contains(&Event::Gesture { kind: "move", phase: "start", mods: CTRL }), "{ev:?}");
        assert!(ev.contains(&Event::Commit(Commit::Move { ids: vec![1], dx: 20.0, dy: 0.0 }, CTRL)), "{ev:?}");
    }

    #[test]
    fn double_click_and_context_menu_report_item_and_point() {
        let mut e = engine(&[(3, Rect::new(100.0, 100.0, 100.0, 100.0))]);
        e.set_camera(50.0, 50.0, 2.0);
        e.take_events();
        e.pointer_event("dblclick", 150.0, 150.0, SHIFT);
        e.pointer_event("contextmenu", 10.0, 20.0, 0);
        assert_eq!(
            e.take_events(),
            vec![
                Event::Pointer { kind: "dblclick", id: Some(3), world: (125.0, 125.0), screen: (150.0, 150.0), mods: SHIFT },
                Event::Pointer { kind: "contextmenu", id: None, world: (55.0, 60.0), screen: (10.0, 20.0), mods: 0 },
            ]
        );
    }

    #[test]
    fn hit_handle_follows_the_item_handle_set() {
        let mut e = engine(&[(0, Rect::new(100.0, 100.0, 200.0, 100.0))]);
        e.set_selection(&[0]);
        assert_eq!(e.hit_handle(100.0, 100.0), Some((0, H_L | H_T)));
        assert_eq!(e.hit_handle(200.0, 100.0), Some((0, H_T)));
        assert_eq!(e.hit_handle(300.0, 150.0), Some((0, H_R)));
        assert_eq!(e.hit_handle(200.0, 150.0), None);
        // Corners only: no edges.
        let mut r = record(0, 0, Rect::new(100.0, 100.0, 200.0, 100.0), ALL | crate::scene::F_HANDLES_CORNERS);
        e.apply(&r, &[]);
        assert_eq!(e.hit_handle(300.0, 200.0), Some((0, H_R | H_B)));
        assert_eq!(e.hit_handle(200.0, 100.0), None);
        assert_eq!(e.hit_handle(300.0, 150.0), None);
        e.frame(1.0);
        assert_eq!(e.rd.overlay.len(), 1 + 4, "outline and four corners");
        // Width only: left and right.
        r[10] = (ALL | crate::scene::F_HANDLES_WIDTH) as f64;
        e.apply(&r, &[]);
        assert_eq!(e.hit_handle(200.0, 100.0), None);
        assert_eq!(e.hit_handle(100.0, 150.0), Some((0, H_L)));
        assert_eq!(e.hit_handle(250.0, 200.0), None);
        e.frame(2.0);
        assert_eq!(e.rd.overlay.len(), 1 + 2);
    }

    #[test]
    fn texture_replacement_does_not_fade_again() {
        let mut e = engine(&[]);
        let mut r = record(0, 0, Rect::new(0.0, 0.0, 100.0, 100.0), ALL);
        r[22] = 0.0;
        e.apply(&r, &[]);
        e.frame(0.0);
        e.set_texture(0, &[(128, 128)]);
        e.frame(10.0);
        assert!(e.fading.contains(&0), "first appearance fades in");
        e.frame(500.0);
        assert!(e.fading.is_empty());
        // A new picture under the same key, and one under a new key, replace it at once.
        e.set_texture(0, &[(256, 256)]);
        e.frame(510.0);
        assert!(e.fading.is_empty() && e.scene.get(0).unwrap().tex.is_some());
        e.set_texture(1, &[(256, 256)]);
        r[22] = 1.0;
        e.apply(&r, &[]);
        e.frame(520.0);
        assert!(e.fading.is_empty() && e.scene.get(0).unwrap().tex.is_some());
        // After the placeholder showed, a texture fades in again.
        r[22] = 2.0;
        e.apply(&r, &[]);
        e.frame(530.0);
        assert!(e.scene.get(0).unwrap().tex.is_none());
        e.set_texture(2, &[(256, 256)]);
        e.frame(540.0);
        assert!(e.fading.contains(&0));
    }

    #[test]
    fn resize_reports_progress_with_drag_events() {
        let mut e = engine(&[(0, Rect::new(100.0, 100.0, 100.0, 100.0))]);
        e.set_option(3, 0.0);
        e.set_option(14, 1.0);
        e.set_selection(&[0]);
        e.pointer_down(1, 200.0, 200.0, 0, 0, PTR_MOUSE);
        e.pointer_move(1, 220.0, 230.0, 1, SHIFT);
        let ev = e.take_events();
        let rect = Rect::new(100.0, 100.0, 130.0, 130.0);
        assert!(ev.contains(&Event::Resizing { id: 0, rect, mods: SHIFT }), "{ev:?}");
        assert_eq!(e.item_rect(0), Some((rect, 0.0)), "item_rect follows the gesture");
        e.pointer_up(1, 220.0, 230.0, 0, SHIFT);
        assert_eq!(commits(&mut e), vec![Commit::Resize { id: 0, rect }]);
    }

    #[test]
    fn per_item_hover_and_outline_flags() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 100.0, 100.0)), (1, Rect::new(200.0, 0.0, 100.0, 100.0))]);
        e.pointer_move(1, 250.0, 50.0, 0, 0);
        e.frame(1.0);
        assert_eq!(e.rd.overlay.len(), 1, "hover outline");
        e.apply(&record(1, 0, Rect::new(200.0, 0.0, 100.0, 100.0), ALL | crate::scene::F_NO_HOVER), &[]);
        e.frame(2.0);
        assert_eq!(e.hover, Some(1), "still reported");
        assert!(e.rd.overlay.is_empty(), "not drawn");
        e.apply(&record(0, 0, Rect::new(0.0, 0.0, 100.0, 100.0), ALL | F_NO_OUTLINE), &[]);
        e.set_selection(&[0]);
        e.frame(3.0);
        assert!(e.rd.overlay.is_empty(), "no outline, no handles");
        assert_eq!(e.hit_handle(0.0, 0.0), None);
        e.set_selection(&[0, 1]);
        e.frame(4.0);
        assert_eq!(e.rd.overlay.len(), 2, "item 1's outline and the group box");
    }

    #[test]
    fn start_move_from_code_drags_and_shift_locks_the_axis() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 100.0, 100.0)), (1, Rect::new(300.0, 300.0, 100.0, 100.0))]);
        e.set_option(3, 0.0);
        // A press outside the item (its DOM title, say) moves it.
        assert!(e.start_move(7, 50.0, -20.0, 0, 0));
        assert!(!e.start_move(8, 0.0, 0.0, 1, 0), "one gesture at a time");
        e.pointer_move(7, 60.0, -20.0, 1, 0);
        e.pointer_move(7, 90.0, -15.0, 1, SHIFT);
        assert_eq!(e.item_rect(0).unwrap().0, Rect::new(40.0, 0.0, 100.0, 100.0), "Shift keeps the drag horizontal");
        e.pointer_up(7, 90.0, -15.0, 0, SHIFT);
        assert_eq!(commits(&mut e), vec![Commit::Move { ids: vec![0], dx: 40.0, dy: 0.0 }]);
        // A press that never passes the threshold is a click: nothing moves or changes selection.
        assert!(e.start_move(7, 50.0, -20.0, 0, 0));
        e.pointer_up(7, 51.0, -20.0, 0, 0);
        assert!(e.take_events().is_empty());
        // Unmovable items do not start.
        e.apply(&record(1, 0, Rect::new(300.0, 300.0, 100.0, 100.0), ALL & !F_MOVABLE), &[]);
        assert!(!e.start_move(7, 0.0, 0.0, 1, 0));
    }

    #[test]
    fn multiply_items_batch_apart_and_paths_carry_cuts() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 10.0, 10.0))]);
        let cmds = [0.0, 0.0, 0.0, 1.0, 10.0, 10.0, /* cut */ 2.0, 3.0, 4.0, 5.0];
        let mut p = record(1, 2, Rect::new(0.0, 0.0, 10.0, 10.0), ALL | F_MULTIPLY);
        p[13] = 255.0;
        p[14] = 2.0;
        p[24] = 6.0;
        p[31] = 1.0;
        e.apply(&p, &cmds);
        e.apply(&record(2, 0, Rect::new(20.0, 0.0, 10.0, 10.0), ALL | F_MULTIPLY), &[]);
        e.apply(&record(3, 0, Rect::new(40.0, 0.0, 10.0, 10.0), ALL | F_MULTIPLY), &[]);
        e.frame(1.0);
        let b = &e.rd.batches;
        assert_eq!(b.len(), 3, "{b:?}");
        assert!(matches!(b[0], Batch::Quads { count: 1, multiply: false, .. }));
        assert!(matches!(b[1], Batch::Paths { multiply: true, .. }));
        assert!(matches!(b[2], Batch::Quads { count: 2, multiply: true, .. }));
        let slot = e.scene.get(1).unwrap().slot as usize * SLOT_FLOATS;
        assert_eq!(&e.rd.slots[slot + 16..slot + 24], &[2.0, 3.0, 4.0, 5.0, 0.0, 0.0, 0.0, 0.0]);
        // Turning multiply off merges the quads again.
        e.apply(&record(2, 0, Rect::new(20.0, 0.0, 10.0, 10.0), ALL), &[]);
        e.apply(&record(3, 0, Rect::new(40.0, 0.0, 10.0, 10.0), ALL), &[]);
        e.frame(2.0);
        assert_eq!(e.rd.batches.len(), 3);
        assert!(matches!(e.rd.batches[2], Batch::Quads { count: 2, multiply: false, .. }));
    }

    #[test]
    fn grid_levels_follow_major_step_and_fade() {
        let mut e = engine(&[]);
        // Defaults: ×5 levels, fading in between 8 and 16 px.
        e.set_camera(0.0, 0.0, 1.0);
        assert_eq!(e.grid_level(), (20.0, 1.0));
        e.set_camera(0.0, 0.0, 0.3);
        assert_eq!(e.grid_level().0, 100.0);
        // The whiteboard's grid: 48 units doubling, fading in between 30 and 44 px.
        e.set_option(16, 48.0);
        e.set_option(20, 2.0);
        e.set_option(21, 30.0);
        e.set_option(22, 44.0);
        e.set_camera(0.0, 0.0, 0.5);
        assert_eq!(e.grid_level(), (96.0, 1.0));
        e.set_camera(0.0, 0.0, 37.0 / 96.0);
        let (sp, fine) = e.grid_level();
        assert_eq!(sp, 96.0);
        assert!((fine - 0.5).abs() < 1e-6);
    }

    fn press_move(e: &mut Engine, from: (f64, f64), to: (f64, f64), mods: u32) {
        e.pointer_down(1, from.0, from.1, 0, mods, PTR_MOUSE);
        for k in 1..=10 {
            let t = k as f64 / 10.0;
            e.pointer_move(1, from.0 + (to.0 - from.0) * t, from.1 + (to.1 - from.1) * t, 1, mods);
        }
    }

    #[test]
    fn alt_drag_copies_with_alt_copy_and_leaves_items_in_place() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 50.0, 50.0))]);
        e.set_option(3, 0.0);
        // Off by default: Alt is an ordinary move.
        drag(&mut e, (25.0, 25.0), (125.0, 25.0), ALT);
        assert_eq!(commits(&mut e), vec![Commit::Move { ids: vec![0], dx: 100.0, dy: 0.0 }]);
        e.set_option(23, 1.0);
        press_move(&mut e, (125.0, 25.0), (225.0, 75.0), ALT);
        assert_eq!(e.scene.get(0).unwrap().rect, Rect::new(100.0, 0.0, 50.0, 50.0), "the original stays");
        e.frame(1.0);
        let fill = (e.opts.theme.selection & 0xffff_ff00) | 0x29;
        assert!(e.rd.overlay.iter().any(|q| q.fill == render::rgba(fill) && q.rect == [200.0, 50.0, 50.0, 50.0]), "a ghost where the copy lands");
        e.pointer_up(1, 225.0, 75.0, 0, ALT);
        assert_eq!(commits(&mut e), vec![Commit::Copy { ids: vec![0], dx: 100.0, dy: 50.0 }]);
        assert_eq!(e.scene.get(0).unwrap().rect, Rect::new(100.0, 0.0, 50.0, 50.0));
    }

    #[test]
    fn alt_toggles_between_copy_and_move_mid_drag() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 50.0, 50.0))]);
        e.set_option(3, 0.0);
        e.set_option(23, 1.0);
        press_move(&mut e, (25.0, 25.0), (125.0, 25.0), 0);
        assert_eq!(e.scene.get(0).unwrap().rect.x, 100.0, "moving");
        e.key(KEY_MODIFIER, true, ALT);
        assert_eq!(e.scene.get(0).unwrap().rect.x, 0.0, "pressing Alt puts it back and shows a copy");
        e.key(KEY_MODIFIER, false, 0);
        assert_eq!(e.scene.get(0).unwrap().rect.x, 100.0);
        e.pointer_up(1, 125.0, 25.0, 0, 0);
        assert_eq!(commits(&mut e), vec![Commit::Move { ids: vec![0], dx: 100.0, dy: 0.0 }]);
        // Escape during a copy leaves everything as it was.
        press_move(&mut e, (125.0, 25.0), (225.0, 25.0), ALT);
        e.key(KEY_ESCAPE, true, ALT);
        e.pointer_up(1, 225.0, 25.0, 0, ALT);
        assert!(commits(&mut e).is_empty());
        assert_eq!(e.scene.get(0).unwrap().rect.x, 100.0);
    }

    #[test]
    fn items_that_cannot_move_still_copy() {
        let mut e = engine(&[(1, Rect::new(200.0, 0.0, 50.0, 50.0))]);
        e.apply(&record(0, 0, Rect::new(0.0, 0.0, 50.0, 50.0), F_VISIBLE | F_HITTABLE | F_SELECTABLE | F_SNAP), &[]);
        e.set_option(3, 0.0);
        e.set_option(23, 1.0);
        e.set_selection(&[0, 1]);
        drag(&mut e, (25.0, 25.0), (25.0, 125.0), 0);
        assert_eq!(commits(&mut e), vec![Commit::Move { ids: vec![1], dx: 0.0, dy: 100.0 }], "a move leaves it behind");
        assert_eq!(e.scene.get(0).unwrap().rect.y, 0.0);
        drag(&mut e, (25.0, 25.0), (25.0, 225.0), ALT);
        assert_eq!(commits(&mut e), vec![Commit::Copy { ids: vec![0, 1], dx: 0.0, dy: 200.0 }]);
        e.set_selection(&[0]);
        drag(&mut e, (25.0, 25.0), (125.0, 25.0), 0);
        assert!(commits(&mut e).is_empty(), "alone, it does not move");
        assert_eq!(e.scene.get(0).unwrap().rect.x, 0.0);
    }

    #[test]
    fn host_guides_draw_beside_the_engines() {
        let mut e = engine(&[]);
        e.frame(1.0);
        assert!(e.rd.overlay.is_empty());
        e.set_guides(&[1.0, 10.0, 0.0, 100.0, 0.0, 20.0, 5.0, 50.0]);
        e.frame(2.0);
        assert_eq!(e.rd.overlay.len(), 2);
        assert_eq!(e.rd.overlay[1].rect, [5.0, 19.5, 45.0, 1.0]);
        e.set_guides(&[]);
        e.frame(3.0);
        assert!(e.rd.overlay.is_empty());
    }

    #[test]
    fn corner_resize_keeping_aspect_slides_onto_the_nearest_line() {
        // 100 x 50 (aspect 2) and a neighbour whose left edge is at x = 300.
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 100.0, 50.0)), (1, Rect::new(300.0, 400.0, 50.0, 50.0))]);
        e.set_selection(&[0]);
        drag(&mut e, (100.0, 50.0), (296.0, 98.0), SHIFT);
        assert_eq!(commits(&mut e), vec![Commit::Resize { id: 0, rect: Rect::new(0.0, 0.0, 300.0, 150.0) }]);
        // ⌘ / Ctrl turns it off: the pointer projected onto the diagonal.
        drag(&mut e, (300.0, 150.0), (296.0, 140.0), SHIFT | META);
        assert_eq!(commits(&mut e), vec![Commit::Resize { id: 0, rect: Rect::new(0.0, 0.0, 296.0, 148.0) }]);
    }

    #[test]
    fn corner_resize_keeping_aspect_weighs_lines_by_the_slope() {
        // 50 x 100 (aspect 0.5): an x line 2.5 away moves y by 5, a y line 4 away moves x by 2.
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 50.0, 100.0)), (1, Rect::new(102.5, 500.0, 10.0, 10.0)), (2, Rect::new(500.0, 204.0, 10.0, 10.0))]);
        e.set_selection(&[0]);
        e.pointer_down(1, 50.0, 100.0, 0, SHIFT, PTR_MOUSE);
        e.pointer_move(1, 100.0, 200.0, 1, SHIFT);
        assert_eq!(e.scene.get(0).unwrap().rect, Rect::new(0.0, 0.0, 102.0, 204.0), "the y line wins");
        assert!(e.guides.iter().any(|g| !g.vertical && g.at == 204.0), "{:?}", e.guides);
        assert!(!e.guides.iter().any(|g| g.vertical), "x is 0.5 off its line: {:?}", e.guides);
        e.pointer_up(1, 100.0, 200.0, 0, SHIFT);
        commits(&mut e);
        // Lined up on both axes, both guides show.
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 50.0, 100.0)), (1, Rect::new(102.2, 500.0, 10.0, 10.0)), (2, Rect::new(500.0, 204.0, 10.0, 10.0))]);
        e.set_selection(&[0]);
        e.pointer_down(1, 50.0, 100.0, 0, SHIFT, PTR_MOUSE);
        e.pointer_move(1, 100.0, 200.0, 1, SHIFT);
        assert!(e.guides.iter().any(|g| g.vertical && (g.at - 102.2).abs() < 1e-9), "{:?}", e.guides);
        assert!(e.guides.iter().any(|g| !g.vertical && g.at == 204.0), "{:?}", e.guides);
    }

    #[test]
    fn edge_resize_keeping_aspect_snaps_the_dragged_axis() {
        let mut e = engine(&[(0, Rect::new(0.0, 0.0, 100.0, 50.0)), (1, Rect::new(300.0, 400.0, 50.0, 50.0))]);
        e.set_selection(&[0]);
        e.pointer_down(1, 100.0, 25.0, 0, SHIFT, PTR_MOUSE);
        e.pointer_move(1, 297.0, 25.0, 1, SHIFT);
        assert!(e.guides.iter().all(|g| g.vertical) && e.guides.len() == 1, "{:?}", e.guides);
        e.pointer_up(1, 297.0, 25.0, 0, SHIFT);
        assert_eq!(commits(&mut e), vec![Commit::Resize { id: 0, rect: Rect::new(0.0, -50.0, 300.0, 150.0) }]);
    }

    #[test]
    fn resize_ignores_lines_behind_the_opposite_edge() {
        // The neighbour's right edge is at x = 100, where the resized box's left edge is.
        let mut e = engine(&[(0, Rect::new(100.0, 100.0, 100.0, 50.0)), (1, Rect::new(50.0, 300.0, 50.0, 50.0))]);
        e.set_selection(&[0]);
        e.pointer_down(1, 200.0, 125.0, 0, 0, PTR_MOUSE);
        e.pointer_move(1, 150.0, 125.0, 1, 0);
        e.pointer_move(1, 103.0, 125.0, 1, 0);
        assert!(e.guides.is_empty(), "{:?}", e.guides);
        e.pointer_up(1, 103.0, 125.0, 0, 0);
        assert_eq!(commits(&mut e), vec![Commit::Resize { id: 0, rect: Rect::new(100.0, 100.0, 3.0, 50.0) }]);
    }
}
