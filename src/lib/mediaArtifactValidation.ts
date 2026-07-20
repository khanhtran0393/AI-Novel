import fs from 'fs';

export type VisualArtifactKind = 'image' | 'video';

export type VisualArtifactProbe = {
  ok: boolean;
  codec?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  sizeBytes?: number;
  error?: string;
};

type Dimensions = { codec: string; width: number; height: number };
type Mp4Box = {
  type: string;
  start: number;
  dataStart: number;
  end: number;
  size: number;
};

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = CRC32_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(buffer: Buffer): Dimensions | null {
  if (
    buffer.length < 45 ||
    !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return null;
  }
  let cursor = 8;
  let width = 0;
  let height = 0;
  let hasImageData = false;
  let chunkIndex = 0;
  while (cursor + 12 <= buffer.length) {
    const dataLength = buffer.readUInt32BE(cursor);
    const typeStart = cursor + 4;
    const dataStart = cursor + 8;
    const dataEnd = dataStart + dataLength;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length) return null;
    const type = buffer.toString('ascii', typeStart, dataStart);
    if (buffer.readUInt32BE(dataEnd) !== crc32(buffer, typeStart, dataEnd)) {
      return null;
    }
    if (chunkIndex === 0) {
      if (type !== 'IHDR' || dataLength !== 13) return null;
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
    }
    if (type === 'IDAT' && dataLength > 0) hasImageData = true;
    if (type === 'IEND') {
      if (dataLength !== 0 || chunkEnd !== buffer.length || !hasImageData) return null;
      return { codec: 'png', width, height };
    }
    cursor = chunkEnd;
    chunkIndex += 1;
  }
  return null;
}

function inspectJpeg(buffer: Buffer): Dimensions | null {
  if (buffer.length < 16 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let cursor = 2;
  let width = 0;
  let height = 0;
  while (cursor + 3 < buffer.length) {
    if (buffer[cursor] !== 0xff) return null;
    while (cursor < buffer.length && buffer[cursor] === 0xff) cursor += 1;
    if (cursor >= buffer.length) return null;
    const marker = buffer[cursor++];
    if (marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (cursor + 2 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(cursor);
    if (segmentLength < 2 || cursor + segmentLength > buffer.length) return null;
    if (startOfFrame.has(marker) && segmentLength >= 7) {
      height = buffer.readUInt16BE(cursor + 3);
      width = buffer.readUInt16BE(cursor + 5);
    }
    if (marker === 0xda) {
      const scanStart = cursor + segmentLength;
      const eoi = buffer.length - 2;
      if (
        width <= 0 ||
        height <= 0 ||
        eoi <= scanStart ||
        buffer[eoi] !== 0xff ||
        buffer[eoi + 1] !== 0xd9
      ) {
        return null;
      }
      return { codec: 'jpeg', width, height };
    }
    cursor += segmentLength;
  }
  return null;
}

function skipGifSubBlocks(buffer: Buffer, start: number): { end: number; bytes: number } | null {
  let cursor = start;
  let bytes = 0;
  while (cursor < buffer.length) {
    const length = buffer[cursor++];
    if (length === 0) return { end: cursor, bytes };
    if (cursor + length > buffer.length) return null;
    bytes += length;
    cursor += length;
  }
  return null;
}

function inspectGif(buffer: Buffer): Dimensions | null {
  if (
    buffer.length < 15 ||
    !['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))
  ) {
    return null;
  }
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  const packed = buffer[10];
  let cursor = 13;
  if ((packed & 0x80) !== 0) {
    cursor += 3 * 2 ** ((packed & 0x07) + 1);
  }
  let hasImageData = false;
  while (cursor < buffer.length) {
    const marker = buffer[cursor++];
    if (marker === 0x3b) {
      return hasImageData && cursor === buffer.length
        ? { codec: 'gif', width, height }
        : null;
    }
    if (marker === 0x21) {
      if (cursor >= buffer.length) return null;
      cursor += 1;
      const extension = skipGifSubBlocks(buffer, cursor);
      if (!extension) return null;
      cursor = extension.end;
      continue;
    }
    if (marker !== 0x2c || cursor + 9 > buffer.length) return null;
    const imageWidth = buffer.readUInt16LE(cursor + 4);
    const imageHeight = buffer.readUInt16LE(cursor + 6);
    const imagePacked = buffer[cursor + 8];
    cursor += 9;
    if (imageWidth <= 0 || imageHeight <= 0) return null;
    if ((imagePacked & 0x80) !== 0) {
      cursor += 3 * 2 ** ((imagePacked & 0x07) + 1);
    }
    if (cursor >= buffer.length) return null;
    cursor += 1;
    const imageData = skipGifSubBlocks(buffer, cursor);
    if (!imageData || imageData.bytes <= 0) return null;
    hasImageData = true;
    cursor = imageData.end;
  }
  return null;
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function inspectWebp(buffer: Buffer): Dimensions | null {
  if (
    buffer.length < 30 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP' ||
    buffer.readUInt32LE(4) + 8 !== buffer.length
  ) {
    return null;
  }
  let cursor = 12;
  let dimensions: Dimensions | null = null;
  let hasImagePayload = false;
  while (cursor + 8 <= buffer.length) {
    const type = buffer.toString('ascii', cursor, cursor + 4);
    const length = buffer.readUInt32LE(cursor + 4);
    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) return null;
    if (type === 'VP8X' && length >= 10) {
      dimensions = {
        codec: 'webp',
        width: readUInt24LE(buffer, dataStart + 4) + 1,
        height: readUInt24LE(buffer, dataStart + 7) + 1,
      };
    } else if (
      type === 'VP8 ' &&
      length >= 10 &&
      buffer[dataStart + 3] === 0x9d &&
      buffer[dataStart + 4] === 0x01 &&
      buffer[dataStart + 5] === 0x2a
    ) {
      dimensions ||= {
        codec: 'webp',
        width: buffer.readUInt16LE(dataStart + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataStart + 8) & 0x3fff,
      };
      hasImagePayload = true;
    } else if (type === 'VP8L' && length >= 5 && buffer[dataStart] === 0x2f) {
      const b1 = buffer[dataStart + 1];
      const b2 = buffer[dataStart + 2];
      const b3 = buffer[dataStart + 3];
      const b4 = buffer[dataStart + 4];
      dimensions ||= {
        codec: 'webp',
        width: 1 + ((b1 | (b2 << 8)) & 0x3fff),
        height: 1 + (((b2 >> 6) | (b3 << 2) | (b4 << 10)) & 0x3fff),
      };
      hasImagePayload = true;
    }
    cursor = dataEnd + (length % 2);
  }
  return cursor === buffer.length && hasImagePayload ? dimensions : null;
}

function inspectImage(buffer: Buffer): Dimensions | null {
  return inspectPng(buffer) || inspectJpeg(buffer) || inspectGif(buffer) || inspectWebp(buffer);
}

function boxAt(buffer: Buffer, start: number, limit = buffer.length): Mp4Box | null {
  if (start < 0 || start + 8 > limit) return null;
  const size32 = buffer.readUInt32BE(start);
  const type = buffer.toString('ascii', start + 4, start + 8);
  let size = size32;
  let headerSize = 8;
  if (size32 === 1) {
    if (start + 16 > limit) return null;
    const large = buffer.readBigUInt64BE(start + 8);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(large);
    headerSize = 16;
  } else if (size32 === 0) {
    size = limit - start;
  }
  if (size < headerSize || start + size > limit) return null;
  return {
    type,
    start,
    dataStart: start + headerSize,
    end: start + size,
    size,
  };
}

function childBoxes(buffer: Buffer, start: number, end: number): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let cursor = start;
  while (cursor + 8 <= end) {
    const box = boxAt(buffer, cursor, end);
    if (!box) break;
    boxes.push(box);
    cursor = box.end;
  }
  return boxes;
}

function findChild(
  buffer: Buffer,
  parent: Mp4Box,
  type: string,
): Mp4Box | undefined {
  return childBoxes(buffer, parent.dataStart, parent.end).find(
    (box) => box.type === type,
  );
}

function readTopLevelBox(fd: number, offset: number, fileSize: number): Mp4Box | null {
  const header = Buffer.alloc(16);
  const bytes = fs.readSync(fd, header, 0, 16, offset);
  if (bytes < 8) return null;
  const size32 = header.readUInt32BE(0);
  const type = header.toString('ascii', 4, 8);
  let size = size32;
  let headerSize = 8;
  if (size32 === 1) {
    if (bytes < 16) return null;
    const large = header.readBigUInt64BE(8);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(large);
    headerSize = 16;
  } else if (size32 === 0) {
    size = fileSize - offset;
  }
  if (size < headerSize || offset + size > fileSize) return null;
  return {
    type,
    start: offset,
    dataStart: offset + headerSize,
    end: offset + size,
    size,
  };
}

function inspectMp4(filePath: string, fileSize: number): VisualArtifactProbe {
  const fd = fs.openSync(filePath, 'r');
  try {
    let cursor = 0;
    let hasFtyp = false;
    let hasMediaPayload = false;
    let moov: Mp4Box | undefined;
    while (cursor + 8 <= fileSize) {
      const box = readTopLevelBox(fd, cursor, fileSize);
      if (!box) {
        return { ok: false, sizeBytes: fileSize, error: 'Invalid MP4 box table' };
      }
      if (box.type === 'ftyp') hasFtyp = true;
      if (box.type === 'mdat' && box.size > box.dataStart - box.start) {
        hasMediaPayload = true;
      }
      if (box.type === 'moov') moov = box;
      cursor = box.end;
    }
    if (!hasFtyp || !hasMediaPayload || !moov) {
      return {
        ok: false,
        sizeBytes: fileSize,
        error: 'MP4 is missing ftyp, moov, or non-empty mdat',
      };
    }
    const maxMoovBytes = 64 * 1024 * 1024;
    if (moov.size > maxMoovBytes) {
      return {
        ok: false,
        sizeBytes: fileSize,
        error: `MP4 moov box exceeds ${maxMoovBytes} bytes`,
      };
    }
    const moovBuffer = Buffer.alloc(moov.size);
    if (fs.readSync(fd, moovBuffer, 0, moov.size, moov.start) !== moov.size) {
      return { ok: false, sizeBytes: fileSize, error: 'Cannot read complete MP4 moov box' };
    }
    const moovRoot = boxAt(moovBuffer, 0);
    if (!moovRoot || moovRoot.type !== 'moov') {
      return { ok: false, sizeBytes: fileSize, error: 'Invalid MP4 moov box' };
    }
    const mvhd = findChild(moovBuffer, moovRoot, 'mvhd');
    if (!mvhd || mvhd.dataStart + 20 > mvhd.end) {
      return { ok: false, sizeBytes: fileSize, error: 'MP4 is missing mvhd timing' };
    }
    const version = moovBuffer[mvhd.dataStart];
    const timescaleOffset = mvhd.dataStart + (version === 1 ? 20 : 12);
    const durationOffset = mvhd.dataStart + (version === 1 ? 24 : 16);
    if (durationOffset + (version === 1 ? 8 : 4) > mvhd.end) {
      return { ok: false, sizeBytes: fileSize, error: 'MP4 mvhd timing is truncated' };
    }
    const timescale = moovBuffer.readUInt32BE(timescaleOffset);
    const rawDuration = version === 1
      ? Number(moovBuffer.readBigUInt64BE(durationOffset))
      : moovBuffer.readUInt32BE(durationOffset);
    const durationSec = timescale > 0 ? rawDuration / timescale : 0;

    let width = 0;
    let height = 0;
    let codec = 'mp4';
    for (const trak of childBoxes(moovBuffer, moovRoot.dataStart, moovRoot.end).filter(
      (box) => box.type === 'trak',
    )) {
      let isVideoTrack = false;
      const tkhd = findChild(moovBuffer, trak, 'tkhd');
      if (tkhd) {
        const tkhdVersion = moovBuffer[tkhd.dataStart];
        const dimensionOffset = tkhd.dataStart + (tkhdVersion === 1 ? 88 : 76);
        if (dimensionOffset + 8 <= tkhd.end) {
          const candidateWidth = moovBuffer.readUInt32BE(dimensionOffset) / 65536;
          const candidateHeight = moovBuffer.readUInt32BE(dimensionOffset + 4) / 65536;
          if (candidateWidth >= 16 && candidateHeight >= 16) {
            isVideoTrack = true;
            if (candidateWidth > width && candidateHeight > height) {
              width = Math.round(candidateWidth);
              height = Math.round(candidateHeight);
            }
          }
        }
      }
      const mdia = findChild(moovBuffer, trak, 'mdia');
      const minf = mdia ? findChild(moovBuffer, mdia, 'minf') : undefined;
      const stbl = minf ? findChild(moovBuffer, minf, 'stbl') : undefined;
      const stsd = stbl ? findChild(moovBuffer, stbl, 'stsd') : undefined;
      if (isVideoTrack && stsd && stsd.dataStart + 16 <= stsd.end) {
        const entryCount = moovBuffer.readUInt32BE(stsd.dataStart + 4);
        if (entryCount > 0) codec = moovBuffer.toString('ascii', stsd.dataStart + 12, stsd.dataStart + 16);
      }
    }
    if (width < 16 || height < 16) {
      return { ok: false, sizeBytes: fileSize, error: 'MP4 has no production-size video track' };
    }
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      return { ok: false, sizeBytes: fileSize, error: 'MP4 has no positive duration' };
    }
    return { ok: true, codec, width, height, durationSec, sizeBytes: fileSize };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Validate generated media using parsers shipped in this application. Images
 * are inspected from their format headers; videos must be finalized MP4 files
 * with a valid box table, dimensions, positive duration, and media payload.
 * No optional system media binary is required.
 */
export function probeVisualArtifact(
  filePath: string,
  kind: VisualArtifactKind,
): VisualArtifactProbe {
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `Artifact does not exist: ${filePath}` };
  }
  const sizeBytes = fs.statSync(filePath).size;
  if (sizeBytes <= 0) {
    return { ok: false, sizeBytes, error: `Artifact is empty: ${filePath}` };
  }
  try {
    if (kind === 'image') {
      const maxImageBytes = 128 * 1024 * 1024;
      if (sizeBytes > maxImageBytes) {
        return {
          ok: false,
          sizeBytes,
          error: `Image artifact exceeds ${maxImageBytes} bytes`,
        };
      }
      const image = inspectImage(fs.readFileSync(filePath));
      if (!image || image.width < 64 || image.height < 64) {
        return {
          ok: false,
          sizeBytes,
          error: `Unsupported or undersized image artifact: ${filePath}`,
        };
      }
      return { ok: true, ...image, sizeBytes };
    }
    return inspectMp4(filePath, sizeBytes);
  } catch (error) {
    return {
      ok: false,
      sizeBytes,
      error: `Cannot inspect ${kind} artifact: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
