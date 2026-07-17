import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";

/**
 * Picking an avatar from disk: the file never reaches a storage bucket — the
 * browser centre-crops and re-encodes it, and the data URL is saved on the user
 * row. Covers the parts that only exist at runtime: the canvas resize, the
 * round trip through the server action, and persistence across a reload.
 *
 * Prerequisites: the app served on the configured port and a seeded database
 * (`npm run db:seed`) so `demo@resumerank.app` exists and is pre-verified.
 */

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A deliberately wide RGB PNG, so a square result proves the crop ran. */
function widePng(width: number, height: number): Buffer {
  const raw = Buffer.concat(
    Array.from({ length: height }, (_, y) => {
      const row = Buffer.alloc(1 + width * 3);
      for (let x = 0; x < width; x += 1) {
        row[1 + x * 3] = (x * 255) / width;
        row[2 + x * 3] = (y * 255) / height;
        row[3 + x * 3] = 0x4e;
      }
      return row;
    }),
  );
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("a recruiter uploads an avatar from disk and it survives a reload", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("demo@resumerank.app");
  await page.getByLabel("Password", { exact: true }).fill("demo1234");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/settings");
  const avatar = page.getByRole("main").locator('[data-slot="avatar-image"]');
  // The label depends on whether this account already has a photo; the test
  // makes no assumption about that, and clears it at the end either way.
  await expect(
    page.getByRole("button", { name: /Upload photo|Change photo/ }),
  ).toBeVisible();

  await page.getByLabel("Upload a profile photo").setInputFiles({
    name: "headshot.png",
    mimeType: "image/png",
    buffer: widePng(1200, 800),
  });

  // The preview is the encoder's own output, so asserting on it checks the
  // resize rather than the file that was picked.
  await expect(avatar).toHaveAttribute("src", /^data:image\/webp;base64,/);
  const encoded = await avatar.getAttribute("src");
  expect(encoded).not.toBeNull();
  expect(encoded!.length).toBeLessThan(150_000);

  await expect
    .poll(async () =>
      avatar.evaluate((img: HTMLImageElement) => [
        img.naturalWidth,
        img.naturalHeight,
      ]),
    )
    .toEqual([256, 256]);

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile updated.")).toBeVisible();

  await page.reload();
  await expect(avatar).toHaveAttribute("src", encoded!);
  // The sidebar reads the same stored avatar, not the session cookie.
  await expect(
    page.locator('aside [data-slot="avatar-image"]').first(),
  ).toHaveAttribute("src", encoded!);

  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile updated.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Upload photo" })).toBeVisible();
});
