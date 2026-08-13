/**
 * @typedef {{ size: number; opacity: number; angle: number; x: number; y: number }} WatermarkSettings
 */

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** @param {number} width @param {number} height @param {number} angle */
export function rotatedBoundingBox(width, height, angle) {
  const radians = (angle * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return {
    width: width * cosine + height * sine,
    height: width * sine + height * cosine,
  };
}

/**
 * Keeps a rotated watermark fully inside the source image whenever its minimum
 * supported size can fit inside that image.
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {number} watermarkWidth
 * @param {number} watermarkHeight
 * @param {WatermarkSettings} settings
 * @returns {WatermarkSettings}
 */
export function constrainSettingsToImage(
  imageWidth,
  imageHeight,
  watermarkWidth,
  watermarkHeight,
  settings,
) {
  let renderedWidth = imageWidth * (settings.size / 100);
  let renderedHeight = renderedWidth * (watermarkHeight / watermarkWidth);
  let bounds = rotatedBoundingBox(renderedWidth, renderedHeight, settings.angle);
  const fitScale = Math.min(1, imageWidth / bounds.width, imageHeight / bounds.height);
  const constrainedSize = Math.max(8, settings.size * fitScale);
  renderedWidth = imageWidth * (constrainedSize / 100);
  renderedHeight = renderedWidth * (watermarkHeight / watermarkWidth);
  bounds = rotatedBoundingBox(renderedWidth, renderedHeight, settings.angle);
  const halfWidth = Math.min(50, (bounds.width / imageWidth) * 50);
  const halfHeight = Math.min(50, (bounds.height / imageHeight) * 50);
  return {
    ...settings,
    size: constrainedSize,
    x: clamp(settings.x, halfWidth, 100 - halfWidth),
    y: clamp(settings.y, halfHeight, 100 - halfHeight),
  };
}
