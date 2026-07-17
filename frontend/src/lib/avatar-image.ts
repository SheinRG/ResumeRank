const AVATAR_SIZE = 256;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

/** Carries a message that is safe to show the user verbatim. */
export class AvatarImageError extends Error {}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    // `from-image` applies the EXIF rotation phone cameras record, which a raw
    // canvas draw would otherwise ignore and leave the photo on its side.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new AvatarImageError("That image couldn't be read. Try a JPEG or PNG.");
  }
}

/**
 * Centre-crops a picked file to a square and re-encodes it small enough to
 * live in the user row as a data URL, so uploading a photo needs no storage
 * bucket and no second round trip.
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new AvatarImageError("That file isn't an image.");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new AvatarImageError("That image is over 10MB. Choose a smaller one.");
  }

  const bitmap = await decode(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new AvatarImageError("This browser can't resize images.");
    }

    // Both encoders below drop the alpha channel, so flatten onto white rather
    // than letting a transparent logo turn black.
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);

    const side = Math.min(bitmap.width, bitmap.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    );

    // toDataURL silently falls back to PNG when the type is unsupported, and a
    // PNG of a photo blows past the column budget — so check what came back.
    const webp = canvas.toDataURL("image/webp", 0.82);
    return webp.startsWith("data:image/webp")
      ? webp
      : canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}
