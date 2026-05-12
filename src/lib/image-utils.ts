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
export const generateSpriteSheet = async (
  imageUrls: string[], 
  columns: number = 0, 
  backgroundColor: string = "transparent"
) => {
  if (imageUrls.length === 0) return null;

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
  const frameWidth = firstImg.width;
  const frameHeight = firstImg.height;
  const totalFrames = images.length;

  // Calculate grid
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
  if (backgroundColor !== "transparent") {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Draw frames
  images.forEach((img, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    ctx.drawImage(img, col * frameWidth, row * frameHeight);
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
