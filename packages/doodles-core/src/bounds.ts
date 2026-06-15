export interface Coordinate {
    y: number;
    x: number;
}

export const zeroCoordinate: Coordinate = {x: 0, y: 0};

export interface Bounds extends Coordinate {
    width: number;
    height: number;
}

export const zeroBounds: Bounds = {x: 0, y: 0, width: 0, height: 0};

export const inflate = (bounds: Bounds, dx: number, dy: number): Bounds => ({
    x: bounds.x - dx,
    y: bounds.y - dy,
    width: bounds.width + dx * 2,
    height: bounds.height + dy * 2
});

export const rightOf = (bounds: Bounds, width: number): Bounds => ({
    x: bounds.x + bounds.width,
    y: bounds.y,
    width: width,
    height: bounds.height
});

export const withinBounds = (bounds: Bounds, pos: Coordinate, tolerance: number): boolean =>
    bounds.x - tolerance <= pos.x &&
    bounds.x + bounds.width + tolerance >= pos.x &&
    bounds.y - tolerance <= pos.y &&
    bounds.y + bounds.height + tolerance >= pos.y;

export const withinYBounds = (bounds: Bounds, y: number, tolerance: number): boolean =>
    bounds.y - tolerance <= y &&
    bounds.y + bounds.height + tolerance >= y;

export const withinXBounds = (bounds: Bounds, x: number, tolerance: number): boolean =>
    bounds.x - tolerance <= x &&
    bounds.x + bounds.width + tolerance >= x;

export const minus = (coordinate: Coordinate, delta: Coordinate): Coordinate => ({
    x: coordinate.x - delta.x,
    y: coordinate.y - delta.y
});

export const center = (bounds: Bounds): Coordinate => ({
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
});

/** Shrink `bounds` by `inset` on every side. A negative result width/height
 *  signals the box was smaller than the inset — callers should treat such a
 *  box as having no interior. */
export const insetBounds = (bounds: Bounds, inset: number): Bounds => ({
    x: bounds.x + inset,
    y: bounds.y + inset,
    width: bounds.width - inset * 2,
    height: bounds.height - inset * 2,
});

/** True when the axis-aligned segment p1→p2 passes through the interior of
 *  `rect` (Liang–Barsky clip). Touching the boundary collinearly does not
 *  count; the crossing must have positive length inside the box. */
export const segmentEntersRect = (p1: Coordinate, p2: Coordinate, rect: Bounds): boolean => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const p = [-dx, dx, -dy, dy];
    const q = [
        p1.x - rect.x,
        rect.x + rect.width - p1.x,
        p1.y - rect.y,
        rect.y + rect.height - p1.y,
    ];
    let t0 = 0;
    let t1 = 1;
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i]! < 0) return false;
            continue;
        }
        const r = q[i]! / p[i]!;
        if (p[i]! < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
        if (t0 > t1) return false;
    }
    return t1 > t0;
};
