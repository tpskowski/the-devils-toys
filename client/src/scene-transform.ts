export interface ScenePlane {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ScenePoint {
  x: number;
  y: number;
}

/** The untransformed rectangle occupied by an object-fit: contain image. */
export function fitScenePlane(
  viewportWidth: number,
  viewportHeight: number,
  naturalWidth: number,
  naturalHeight: number
): ScenePlane {
  if (viewportWidth <= 0 || viewportHeight <= 0 || naturalWidth <= 0 || naturalHeight <= 0)
    return { left: 0, top: 0, width: 0, height: 0 };
  const fit = Math.min(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
  const width = naturalWidth * fit;
  const height = naturalHeight * fit;
  return {
    left: (viewportWidth - width) / 2,
    top: (viewportHeight - height) / 2,
    width,
    height
  };
}

/** Keeps the point beneath the cursor fixed while the scene changes scale. */
export function zoomOffsetAtPoint(
  offset: ScenePoint,
  currentScale: number,
  nextScale: number,
  point: ScenePoint,
  viewportCenter: ScenePoint
): ScenePoint {
  if (nextScale <= 1) return { x: 0, y: 0 };
  const ratio = nextScale / Math.max(0.01, currentScale);
  return {
    x: point.x - viewportCenter.x - (point.x - viewportCenter.x - offset.x) * ratio,
    y: point.y - viewportCenter.y - (point.y - viewportCenter.y - offset.y) * ratio
  };
}
