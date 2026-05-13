import JSZip from "jszip";

/**
 * Downloads multiple image URLs as a ZIP file.
 */
export const downloadAsZip = async (imageUrls: string[], fileName: string = "frames.zip") => {
  const zip = new JSZip();
  
  const promises = imageUrls.map(async (url, index) => {
    const response = await fetch(url);
    const blob = await response.blob();
    const name = `frame_${String(index + 1).padStart(4, "0")}.png`;
    zip.file(name, blob);
  });

  await Promise.all(promises);
  const content = await zip.generateAsync({ type: "blob" });
  
  const link = document.createElement("a");
  link.href = URL.createObjectURL(content);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
};

/**
 * Generates a sprite sheet from image URLs.
 */
export type GenerateSpriteSheetOptions = {
  columns?: number;
  backgroundColor?: string;
  frameWidth?: number;
  frameHeight?: number;
};

export const generateSpriteSheet = async (
  imageUrls: string[],
  columnsOrOptions: number | GenerateSpriteSheetOptions = 0,
  backgroundColor: string = "transparent"
) => {
  if (imageUrls.length === 0) return null;

  const options: GenerateSpriteSheetOptions =
    typeof columnsOrOptions === "number"
      ? { columns: columnsOrOptions, backgroundColor }
      : columnsOrOptions;

  // Load all images
  const images = await Promise.all(
    imageUrls.map((url) => {
      return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
    })
  );

  const firstImg = images[0];
  const frameWidth = Math.max(1, Math.floor(options.frameWidth ?? firstImg.width));
  const frameHeight = Math.max(1, Math.floor(options.frameHeight ?? firstImg.height));
  const totalFrames = images.length;

  // Calculate grid
  let columns = options.columns ?? 0;
  if (columns <= 0) {
    columns = Math.ceil(Math.sqrt(totalFrames));
  }
  const rows = Math.ceil(totalFrames / columns);

  const canvas = document.createElement("canvas");
  canvas.width = columns * frameWidth;
  canvas.height = rows * frameHeight;
  const ctx = canvas.getContext("2d");

  if (!ctx) return null;

  // Fill background
  const fillColor = options.backgroundColor ?? "transparent";
  if (fillColor !== "transparent") {
    ctx.fillStyle = fillColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Draw frames
  images.forEach((img, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    ctx.drawImage(
      img,
      0,
      0,
      img.width,
      img.height,
      col * frameWidth,
      row * frameHeight,
      frameWidth,
      frameHeight
    );
  });

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
};

/**
 * Simple background removal based on color threshold.
 */
export const removeBackground = async (
  imageUrl: string,
  threshold: number = 30,
  targetColor: { r: number, g: number, b: number } = { r: 0, g: 0, b: 0 }
) => {
  const img = new Image();
  await new Promise((resolve) => {
    img.onload = resolve;
    img.src = imageUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return imageUrl;

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const diff = Math.sqrt(
      Math.pow(r - targetColor.r, 2) +
      Math.pow(g - targetColor.g, 2) +
      Math.pow(b - targetColor.b, 2)
    );

    if (diff < threshold) {
      data[i + 3] = 0; // Set alpha to 0
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
};

/**
 * Converts a hex color string to an RGB object.
 */
export const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
};

/**
 * Converts an RGB object to a hex color string.
 */
export const rgbToHex = (r: number, g: number, b: number) => {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};
