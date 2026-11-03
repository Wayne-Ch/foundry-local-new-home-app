import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const width = 1020;
const height = 1080;
const outputDirectory = new URL("../tests/fixtures/floor-plan/", import.meta.url);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, payload) {
  const typeBytes = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + payload.length);
  result.writeUInt32BE(payload.length, 0);
  typeBytes.copy(result, 4);
  payload.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 8 + payload.length);
  return result;
}

function setPixel(raw, stride, x, y, red, green, blue) {
  const offset = y * stride + 1 + x * 4;
  raw[offset] = red;
  raw[offset + 1] = green;
  raw[offset + 2] = blue;
  raw[offset + 3] = 255;
}

function createPng(draw) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height, 255);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
  }
  draw(raw, stride);

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function drawRectangleOnly(raw, stride) {
  const left = 170;
  const right = 850;
  const top = 180;
  const bottom = 900;
  const thickness = 8;

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (x < left + thickness || x > right - thickness || y < top + thickness || y > bottom - thickness) {
        setPixel(raw, stride, x, y, 0, 0, 0);
      }
    }
  }
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  new URL("white-control.png", outputDirectory),
  createPng(() => {}),
);
await writeFile(new URL("rectangle-only-control.png", outputDirectory), createPng(drawRectangleOnly));
