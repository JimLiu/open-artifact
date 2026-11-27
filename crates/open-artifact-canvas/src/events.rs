//! Events the engine reports to TypeScript, serialized as a JSON array (ids are handles).

use crate::geom::Rect;
use std::fmt::Write;

#[derive(Clone, Debug, PartialEq)]
pub enum Commit {
    Move { ids: Vec<u32>, dx: f64, dy: f64 },
    /// A move that ended with Alt held (with the `alt_copy` option): the items stay put and
    /// the owner copies them by (dx, dy). Reported as a `move` with `copy: true`.
    Copy { ids: Vec<u32>, dx: f64, dy: f64 },
    Resize { id: u32, rect: Rect },
    Select { ids: Vec<u32> },
}

/// Events that come from input carry the modifier bits held at the time (`mods`, SHIFT | ALT | CTRL | META).
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    Selection(Vec<u32>, u32),
    Camera { x: f64, y: f64, zoom: f64, settled: bool },
    Moving(bool),
    Commit(Commit, u32),
    TextureNeeded(Vec<u32>),
    Hover(Option<u32>),
    Gesture { kind: &'static str, phase: &'static str, mods: u32 },
    Dragging { ids: Vec<u32>, dx: f64, dy: f64, mods: u32 },
    /// The rect of the item being resized, during a resize (with `drag_events`).
    Resizing { id: u32, rect: Rect, mods: u32 },
    /// A double click or context menu at a world / screen point, over item `id` (if any).
    Pointer { kind: &'static str, id: Option<u32>, world: (f64, f64), screen: (f64, f64), mods: u32 },
    ContextRestored,
}

fn ids(out: &mut String, v: &[u32]) {
    out.push('[');
    for (i, id) in v.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let _ = write!(out, "{id}");
    }
    out.push(']');
}

fn num(out: &mut String, v: f64) {
    if v.is_finite() {
        let _ = write!(out, "{v}");
    } else {
        out.push('0');
    }
}

fn rect(out: &mut String, r: &Rect) {
    out.push('[');
    for (k, v) in [r.x, r.y, r.w, r.h].iter().enumerate() {
        if k > 0 {
            out.push(',');
        }
        num(out, *v);
    }
    out.push(']');
}

fn point(out: &mut String, (x, y): (f64, f64)) {
    out.push('[');
    num(out, x);
    out.push(',');
    num(out, y);
    out.push(']');
}

pub fn to_json(events: &[Event]) -> String {
    let mut o = String::with_capacity(64 * events.len() + 2);
    o.push('[');
    for (i, e) in events.iter().enumerate() {
        if i > 0 {
            o.push(',');
        }
        match e {
            Event::Selection(v, mods) => {
                o.push_str("{\"type\":\"selection\",\"ids\":");
                ids(&mut o, v);
                let _ = write!(o, ",\"mods\":{mods}");
            }
            Event::Camera { x, y, zoom, settled } => {
                o.push_str("{\"type\":\"camera\",\"x\":");
                num(&mut o, *x);
                o.push_str(",\"y\":");
                num(&mut o, *y);
                o.push_str(",\"zoom\":");
                num(&mut o, *zoom);
                let _ = write!(o, ",\"settled\":{settled}");
            }
            Event::Moving(m) => {
                let _ = write!(o, "{{\"type\":\"moving\",\"moving\":{m}");
            }
            Event::Commit(c, mods) => {
                let _ = write!(o, "{{\"type\":\"commit\",\"mods\":{mods},\"op\":");
                match c {
                    Commit::Move { ids: v, dx, dy } | Commit::Copy { ids: v, dx, dy } => {
                        o.push_str("\"move\",\"ids\":");
                        ids(&mut o, v);
                        o.push_str(",\"dx\":");
                        num(&mut o, *dx);
                        o.push_str(",\"dy\":");
                        num(&mut o, *dy);
                        if matches!(c, Commit::Copy { .. }) {
                            o.push_str(",\"copy\":true");
                        }
                    }
                    Commit::Resize { id, rect: r } => {
                        let _ = write!(o, "\"resize\",\"id\":{id},\"rect\":");
                        rect(&mut o, r);
                    }
                    Commit::Select { ids: v } => {
                        o.push_str("\"select\",\"ids\":");
                        ids(&mut o, v);
                    }
                }
            }
            Event::TextureNeeded(v) => {
                o.push_str("{\"type\":\"textureNeeded\",\"keys\":");
                ids(&mut o, v);
            }
            Event::Hover(h) => match h {
                Some(id) => {
                    let _ = write!(o, "{{\"type\":\"hover\",\"id\":{id}");
                }
                None => o.push_str("{\"type\":\"hover\",\"id\":null"),
            },
            Event::Gesture { kind, phase, mods } => {
                let _ = write!(o, "{{\"type\":\"gesture\",\"kind\":\"{kind}\",\"phase\":\"{phase}\",\"mods\":{mods}");
            }
            Event::Dragging { ids: v, dx, dy, mods } => {
                o.push_str("{\"type\":\"dragging\",\"ids\":");
                ids(&mut o, v);
                o.push_str(",\"dx\":");
                num(&mut o, *dx);
                o.push_str(",\"dy\":");
                num(&mut o, *dy);
                let _ = write!(o, ",\"mods\":{mods}");
            }
            Event::Resizing { id, rect: r, mods } => {
                let _ = write!(o, "{{\"type\":\"resizing\",\"id\":{id},\"mods\":{mods},\"rect\":");
                rect(&mut o, r);
            }
            Event::Pointer { kind, id, world, screen, mods } => {
                let _ = write!(o, "{{\"type\":\"pointer\",\"kind\":\"{kind}\",\"mods\":{mods},\"id\":");
                match id {
                    Some(id) => {
                        let _ = write!(o, "{id}");
                    }
                    None => o.push_str("null"),
                }
                o.push_str(",\"world\":");
                point(&mut o, *world);
                o.push_str(",\"screen\":");
                point(&mut o, *screen);
            }
            Event::ContextRestored => o.push_str("{\"type\":\"contextrestored\""),
        }
        o.push('}');
    }
    o.push(']');
    o
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes() {
        let s = to_json(&[
            Event::Selection(vec![1, 2], 1),
            Event::Commit(Commit::Move { ids: vec![3], dx: 1.5, dy: -2.0 }, 0),
            Event::Hover(None),
            Event::Commit(Commit::Resize { id: 4, rect: Rect::new(0.0, 1.0, 2.0, 3.0) }, 8),
        ]);
        assert_eq!(
            s,
            r#"[{"type":"selection","ids":[1,2],"mods":1},{"type":"commit","mods":0,"op":"move","ids":[3],"dx":1.5,"dy":-2},{"type":"hover","id":null},{"type":"commit","mods":8,"op":"resize","id":4,"rect":[0,1,2,3]}]"#
        );
        let s = to_json(&[
            Event::Resizing { id: 2, rect: Rect::new(1.0, 2.0, 3.0, 4.0), mods: 0 },
            Event::Pointer { kind: "dblclick", id: Some(5), world: (1.5, 2.0), screen: (3.0, 4.0), mods: 4 },
            Event::Pointer { kind: "contextmenu", id: None, world: (0.0, 0.0), screen: (0.0, 0.0), mods: 0 },
        ]);
        assert_eq!(
            s,
            r#"[{"type":"resizing","id":2,"mods":0,"rect":[1,2,3,4]},{"type":"pointer","kind":"dblclick","mods":4,"id":5,"world":[1.5,2],"screen":[3,4]},{"type":"pointer","kind":"contextmenu","mods":0,"id":null,"world":[0,0],"screen":[0,0]}]"#
        );
    }

    #[test]
    fn copies_serialize_as_moves_marked_copy() {
        let s = to_json(&[Event::Commit(Commit::Copy { ids: vec![3, 4], dx: 10.0, dy: 0.0 }, 2)]);
        assert_eq!(s, r#"[{"type":"commit","mods":2,"op":"move","ids":[3,4],"dx":10,"dy":0,"copy":true}]"#);
    }
}
