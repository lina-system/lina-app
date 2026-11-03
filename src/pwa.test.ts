import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("the manifest and icons can install on a phone Home Screen", () => {
  const html = readFileSync("index.html", "utf8");
  expect(html).toContain('rel="manifest"');
  expect(html).toContain('rel="apple-touch-icon"');
  expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
  expect(html).toContain('name="mobile-web-app-capable" content="yes"');

  const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8")) as {
    display: string;
    start_url: string;
    name: string;
    icons: { src: string; sizes: string; purpose: string; type: string }[];
  };
  expect(manifest.display).toBe("standalone");
  // Relative to the manifest, so the app installs at /app/ where the core serves it (lina-system/lina#168).
  expect(manifest.start_url).toBe("./");
  expect(manifest.name).toBe("LINA");
  expect(manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual([
    "192x192 any",
    "512x512 any",
    "512x512 maskable",
  ]);

  const worker = readFileSync("public/sw.js", "utf8");
  expect(worker).toContain('addEventListener("fetch"');

  expect(pngSize(readFileSync("public/icons/icon-192.png"))).toEqual({ width: 192, height: 192 });
  expect(pngSize(readFileSync("public/icons/icon-512.png"))).toEqual({ width: 512, height: 512 });
  expect(pngSize(readFileSync("public/icons/icon-maskable-512.png"))).toEqual({ width: 512, height: 512 });
  expect(pngSize(readFileSync("public/icons/apple-touch-icon.png"))).toEqual({ width: 180, height: 180 });
});
