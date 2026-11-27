//! The wasm-bindgen surface. TypeScript (`@open-artifact/canvas-engine`) wraps it;
//! nothing else should call it directly.

use crate::engine::Engine;
use crate::events::to_json;
use crate::geom::Rect;
use crate::gl::Renderer;
use wasm_bindgen::prelude::*;
use web_sys::WebGl2RenderingContext as GL;

const DEFAULT_BUDGET: f64 = 192.0 * 1024.0 * 1024.0;
const LEVELS: u32 = 5;

#[wasm_bindgen]
pub struct CanvasCore {
    e: Engine,
    r: Option<Renderer>,
}

#[wasm_bindgen]
impl CanvasCore {
    /// `gl` None runs headless: everything but drawing (for tests and tools).
    #[wasm_bindgen(constructor)]
    pub fn new(gl: Option<GL>, width: f64, height: f64, dpr: f64) -> Result<CanvasCore, JsValue> {
        let r = match gl {
            Some(gl) => Some(Renderer::new(gl).map_err(|m| JsValue::from_str(&format!("open-artifact-canvas: {m}")))?),
            None => None,
        };
        let page = r.as_ref().map_or(2048, |r| r.page);
        let mut e = Engine::new(page, LEVELS, DEFAULT_BUDGET);
        e.resize(width, height, dpr);
        Ok(CanvasCore { e, r })
    }

    pub fn resize(&mut self, width: f64, height: f64, dpr: f64) {
        self.e.resize(width, height, dpr);
    }

    /// Applies a patch: REC f64s per record plus the path command stream.
    pub fn apply(&mut self, ops: &[f64], paths: &[f32]) {
        self.e.apply(ops, paths);
    }

    /// Stores texture `key`: one source per (w, h) pair in `sizes`. Returns a bit per
    /// resolution that found room in the atlas.
    pub fn set_texture(&mut self, key: u32, sources: &js_sys::Array, sizes: &[u32]) -> Result<u32, JsValue> {
        let pairs: Vec<(u32, u32)> = sizes.chunks_exact(2).map(|c| (c[0], c[1])).collect();
        let placed = self.e.set_texture(key, &pairs);
        let mut bits = 0u32;
        let max = self.e.tex.max_layers;
        for (i, p) in placed.iter().enumerate() {
            let Some(p) = p else { continue };
            if let Some(r) = self.r.as_mut() {
                if let Err(err) = r.upload(*p, &sources.get(i as u32), max) {
                    self.e.remove_texture(key);
                    return Err(err);
                }
            }
            bits |= 1 << i.min(31);
        }
        Ok(bits)
    }

    pub fn remove_texture(&mut self, key: u32) {
        self.e.remove_texture(key);
    }

    pub fn set_option(&mut self, key: u32, value: f64) {
        self.e.set_option(key, value);
    }

    pub fn set_tool(&mut self, tool: u32) {
        self.e.set_tool(tool);
    }

    pub fn tool(&self) -> u32 {
        self.e.tool
    }

    pub fn set_selection(&mut self, ids: &[u32]) {
        self.e.set_selection(ids);
    }

    pub fn selection(&self) -> Vec<u32> {
        self.e.selection.clone()
    }

    /// Peers: [color, hasCursor, x, y, n, ...n ids] per peer.
    pub fn set_peers(&mut self, data: &[f64]) {
        self.e.set_peers(data);
    }

    /// Guides the host draws: [vertical 0/1, at, lo, hi] per guide.
    pub fn set_guides(&mut self, data: &[f64]) {
        self.e.set_guides(data);
    }

    pub fn pointer_down(&mut self, pid: i32, x: f64, y: f64, button: u32, mods: u32, ptype: u32) -> bool {
        self.e.pointer_down(pid, x, y, button, mods, ptype)
    }

    pub fn pointer_move(&mut self, pid: i32, x: f64, y: f64, buttons: u32, mods: u32) -> bool {
        self.e.pointer_move(pid, x, y, buttons, mods)
    }

    pub fn pointer_up(&mut self, pid: i32, x: f64, y: f64, button: u32, mods: u32) -> bool {
        self.e.pointer_up(pid, x, y, button, mods)
    }

    pub fn pointer_cancel(&mut self, pid: i32) {
        self.e.pointer_cancel(pid);
    }

    pub fn pointer_leave(&mut self) {
        self.e.pointer_leave();
    }

    /// A double click (`kind` 0) or context menu (1) at a screen point: reported as an event with the item under it.
    pub fn pointer_event(&mut self, kind: u32, x: f64, y: f64, mods: u32) {
        self.e.pointer_event(if kind == 0 { "dblclick" } else { "contextmenu" }, x, y, mods);
    }

    /// Starts moving item `id` from a press the host received; pointer `pid` drives it from here.
    pub fn start_move(&mut self, pid: i32, x: f64, y: f64, id: u32, mods: u32) -> bool {
        self.e.start_move(pid, x, y, id, mods)
    }

    pub fn wheel(&mut self, x: f64, y: f64, dx: f64, dy: f64, mods: u32) -> bool {
        self.e.wheel(x, y, dx, dy, mods)
    }

    pub fn key(&mut self, code: u32, down: bool, mods: u32) -> bool {
        self.e.key(code, down, mods)
    }

    pub fn cancel_gesture(&mut self) {
        self.e.cancel_gesture();
    }

    pub fn zoom_at(&mut self, factor: f64, x: f64, y: f64) {
        self.e.zoom_at(factor, x, y);
    }

    pub fn pan_by(&mut self, dx: f64, dy: f64) {
        self.e.pan_by(dx, dy);
    }

    /// [x, y, zoom, width, height, dpr, minZoom, maxZoom, moving]
    pub fn camera(&self) -> Vec<f64> {
        let c = &self.e.cam;
        vec![c.x, c.y, c.zoom, c.vw, c.vh, c.dpr, c.min_zoom, c.max_zoom, if self.e.moving { 1.0 } else { 0.0 }]
    }

    pub fn set_camera(&mut self, x: f64, y: f64, zoom: f64) {
        self.e.set_camera(x, y, zoom);
    }

    pub fn glide_to(&mut self, x: f64, y: f64, w: f64, h: f64, duration: f64, padding: f64, max_zoom: f64) {
        self.e.glide_to(Rect::new(x, y, w, h), duration, padding, max_zoom);
    }

    /// Topmost hittable item at a screen point, or -1.
    pub fn hit_test(&self, x: f64, y: f64) -> i32 {
        self.e.hit_test(x, y).map_or(-1, |h| h as i32)
    }

    /// The resize handle at a screen point: [item, handle edges (1 left, 2 right, 4 top, 8 bottom)], or empty.
    pub fn hit_handle(&self, x: f64, y: f64) -> Vec<u32> {
        self.e.hit_handle(x, y).map_or(Vec::new(), |(h, edges)| vec![h, edges as u32])
    }

    /// [x, y, w, h, rotation] of an item as the engine has it now, or empty.
    pub fn item_rect(&self, id: u32) -> Vec<f64> {
        self.e.item_rect(id).map_or(Vec::new(), |(r, rot)| vec![r.x, r.y, r.w, r.h, rot])
    }

    /// Items whose bounds meet a world rect.
    pub fn query_rect(&self, x: f64, y: f64, w: f64, h: f64) -> Vec<u32> {
        self.e.scene.query(&Rect::new(x, y, w, h))
    }

    /// Advances and draws one frame. Returns FRAME_* bits (1 drew, 2 wants another, 4 holes changed).
    pub fn frame(&mut self, now: f64) -> u32 {
        let bits = self.e.frame(now);
        if bits & crate::engine::FRAME_RENDER != 0 {
            if let Some(r) = self.r.as_mut() {
                r.render(&mut self.e);
            }
        }
        bits
    }

    /// Visible holes: [handle, x, y, w, h, rotation, zoom] each, in CSS pixels.
    pub fn holes(&self) -> Vec<f32> {
        self.e.holes_out.clone()
    }

    pub fn has_events(&self) -> bool {
        !self.e.events.is_empty()
    }

    /// Pending events as a JSON array (then cleared).
    pub fn take_events(&mut self) -> String {
        let ev = self.e.take_events();
        to_json(&ev)
    }

    pub fn cursor(&self) -> u32 {
        self.e.cursor
    }

    /// [items, visible, drawCalls, textures, textureBytes, atlasLayers, quads, pathVertices, pathIndices, batches, holesVisible, maxAtlasLayers]
    pub fn stats(&self) -> Vec<f64> {
        let e = &self.e;
        vec![
            e.scene.count as f64,
            e.visible_count as f64,
            e.draw_calls as f64,
            e.tex.entry_count() as f64,
            e.tex.used_bytes(),
            e.tex.layer_count() as f64,
            (e.rd.quads.len() + e.rd.overlay.len()) as f64,
            e.rd.verts.len() as f64,
            e.rd.indices.len() as f64,
            e.rd.batches.len() as f64,
            e.rd.hole_count_visible as f64,
            e.tex.max_layers as f64,
        ]
    }

    /// Largest texture side the atlas accepts (sources above it must be scaled down).
    pub fn max_texture_side(&self) -> u32 {
        self.e.tex.page
    }

    pub fn context_lost(&mut self) {
        self.r = None;
    }

    pub fn context_restored(&mut self, gl: GL) -> Result<(), JsValue> {
        let r = Renderer::new(gl).map_err(|m| JsValue::from_str(&format!("open-artifact-canvas: {m}")))?;
        self.e.reset_gpu(r.page);
        self.r = Some(r);
        Ok(())
    }
}
