const TYPE_BYTE = 1;
const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;
const TYPE_SRATIONAL = 10;
const TYPE_SIZES = {
  [TYPE_BYTE]: 1,
  [TYPE_ASCII]: 1,
  [TYPE_SHORT]: 2,
  [TYPE_LONG]: 4,
  [TYPE_RATIONAL]: 8,
  [TYPE_SRATIONAL]: 8,
};

const EXIF_PREFIX = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
const TIFF_HEADER = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
const DEFAULT_TEMPLATE_GPS = "31.2304,121.4737";
const DEFAULT_TEMPLATE_ISO = 500;
const DEFAULT_EXPOSURE_BIAS = [0, 1];
const DEFAULT_SHUTTER_SPEED = [1, 60];
const LENS_MODEL_APERTURE_MARK = "\u{1D453}";

const textEncoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
const latin1Decoder = new TextDecoder("iso-8859-1", { fatal: false });

const IPHONE_MAIN_CAMERA_SPECS = [
  ["iphone14", "iPhone 14", 26, [3, 2]],
  ["iphone14plus", "iPhone 14 Plus", 26, [3, 2]],
  ["iphone14pro", "iPhone 14 Pro", 24, [89, 50]],
  ["iphone14promax", "iPhone 14 Pro Max", 24, [89, 50]],
  ["iphone15", "iPhone 15", 26, [8, 5]],
  ["iphone15plus", "iPhone 15 Plus", 26, [8, 5]],
  ["iphone15pro", "iPhone 15 Pro", 24, [89, 50]],
  ["iphone15promax", "iPhone 15 Pro Max", 24, [89, 50]],
  ["iphone16e", "iPhone 16e", 26, [8, 5]],
  ["iphone16", "iPhone 16", 26, [8, 5]],
  ["iphone16plus", "iPhone 16 Plus", 26, [8, 5]],
  ["iphone16pro", "iPhone 16 Pro", 24, [89, 50]],
  ["iphone16promax", "iPhone 16 Pro Max", 24, [89, 50]],
  ["iphone17e", "iPhone 17e", 26, [8, 5]],
  ["iphone17", "iPhone 17", 26, [8, 5]],
  ["iphoneair", "iPhone Air", 26, [8, 5]],
  ["iphone17pro", "iPhone 17 Pro", 24, [89, 50]],
  ["iphone17promax", "iPhone 17 Pro Max", 24, [89, 50]],
];

export const TEMPLATES = Object.fromEntries(
  IPHONE_MAIN_CAMERA_SPECS.map(([key, cameraModel, focalLengthMm, aperture]) => [
    key,
    makeAppleCameraTemplate(cameraModel, focalLengthMm, aperture),
  ]),
);

let sourceFile = null;
let sourceJpegBytes = null;
let originalMetadata = {};
let resultBlob = null;
let resultFile = null;
let resultUrl = "";

function makeAppleCameraTemplate(cameraModel, focalLengthMm, aperture, lensLabel = "主相机") {
  const apertureText = rationalToDecimalText(aperture);
  return {
    cameraMake: "Apple",
    cameraModel,
    lensModel: `${lensLabel} \u2014 ${focalLengthMm}\u00a0mm ${LENS_MODEL_APERTURE_MARK}${apertureText}`,
    gps: DEFAULT_TEMPLATE_GPS,
    iso: DEFAULT_TEMPLATE_ISO,
    focalLength: [focalLengthMm, 1],
    exposureBias: DEFAULT_EXPOSURE_BIAS,
    aperture,
    shutterSpeed: DEFAULT_SHUTTER_SPEED,
  };
}

TEMPLATES.ipadpro = makeAppleCameraTemplate("iPad Pro", 28, [9, 5], "广角相机");

export function rationalToDecimalText(value) {
  if (!value) return "";
  const [numerator, denominator] = value;
  if (!denominator) return "";
  if (denominator === 1) return String(numerator);
  return (numerator / denominator).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function rationalToFractionText(value) {
  if (!value) return "";
  const [numerator, denominator] = value;
  return denominator === 1 ? String(numerator) : `${numerator}/${denominator}`;
}

function bytesFromUint16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function bytesFromUint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function bytesFromInt32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return bytes;
}

function concatBytes(...arrays) {
  const length = arrays.reduce((total, item) => total + item.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const item of arrays) {
    output.set(item, offset);
    offset += item.length;
  }
  return output;
}

function asciiBytes(value) {
  const raw = textEncoder.encode(String(value ?? ""));
  const output = new Uint8Array(raw.length + 1);
  output.set(raw);
  return output;
}

function exifEntry(tag, type, count, data) {
  return { tag, type, count, data };
}

function asciiEntry(tag, value) {
  const data = asciiBytes(value);
  return exifEntry(tag, TYPE_ASCII, data.length, data);
}

function longEntry(tag, value) {
  return exifEntry(tag, TYPE_LONG, 1, bytesFromUint32(Number(value)));
}

function shortEntry(tag, value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 65535) {
    throw new Error(`SHORT EXIF value out of range for tag 0x${tag.toString(16)}`);
  }
  return exifEntry(tag, TYPE_SHORT, 1, bytesFromUint16(numeric));
}

function byteEntry(tag, value) {
  return exifEntry(tag, TYPE_BYTE, 1, new Uint8Array([Number(value) & 0xff]));
}

function rationalEntry(tag, values) {
  const parts = values.flatMap(([num, den]) => [bytesFromUint32(num), bytesFromUint32(den)]);
  return exifEntry(tag, TYPE_RATIONAL, values.length, concatBytes(...parts));
}

function srationalEntry(tag, values) {
  const parts = values.flatMap(([num, den]) => [bytesFromInt32(num), bytesFromInt32(den)]);
  return exifEntry(tag, TYPE_SRATIONAL, values.length, concatBytes(...parts));
}

function buildIfd(entries, startOffset) {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  const headerSize = 2 + 12 * sorted.length + 4;
  const entryArea = [];
  const dataArea = [];

  entryArea.push(bytesFromUint16(sorted.length));
  for (const entry of sorted) {
    const expectedSize = TYPE_SIZES[entry.type] * entry.count;
    if (entry.data.length !== expectedSize) {
      throw new Error(`Bad EXIF entry size for tag 0x${entry.tag.toString(16)}`);
    }

    let valueOrOffset;
    if (entry.data.length <= 4) {
      valueOrOffset = new Uint8Array(4);
      valueOrOffset.set(entry.data);
    } else {
      let absoluteOffset = startOffset + headerSize + dataArea.reduce((n, item) => n + item.length, 0);
      if (absoluteOffset % 2) {
        dataArea.push(new Uint8Array([0]));
        absoluteOffset += 1;
      }
      valueOrOffset = bytesFromUint32(absoluteOffset);
      dataArea.push(entry.data);
    }

    entryArea.push(bytesFromUint16(entry.tag), bytesFromUint16(entry.type), bytesFromUint32(entry.count));
    entryArea.push(valueOrOffset);
  }
  entryArea.push(bytesFromUint32(0));
  return concatBytes(...entryArea, ...dataArea);
}

function decimalToDmsRationals(value) {
  const degrees = Math.trunc(value);
  const minutesFloat = (value - degrees) * 60;
  const minutes = Math.trunc(minutesFloat);
  const seconds = (minutesFloat - minutes) * 60;
  return [
    [degrees, 1],
    [minutes, 1],
    [Math.round(seconds * 1_000_000), 1_000_000],
  ];
}

function rationalFromFloat(value, denominator = 1000) {
  return [Math.round(Math.abs(value) * denominator), denominator];
}

export function parseGpsText(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) return null;
  const parts = text
    .replace(/，/g, ",")
    .replace(/;/g, ",")
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    throw new Error("GPS 需要使用“纬度,经度”的格式。");
  }

  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  const altitude = parts.length >= 3 ? Number(parts[2]) : null;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("GPS 纬度必须在 -90 到 90 之间。");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("GPS 经度必须在 -180 到 180 之间。");
  }
  if (altitude !== null && !Number.isFinite(altitude)) {
    throw new Error("GPS 高度必须是数字。");
  }

  return {
    latitude: Math.abs(latitude),
    latitudeRef: latitude >= 0 ? "N" : "S",
    longitude: Math.abs(longitude),
    longitudeRef: longitude >= 0 ? "E" : "W",
    altitude,
  };
}

function buildGpsEntries(gps) {
  if (!gps) return [];
  const entries = [
    asciiEntry(0x0001, gps.latitudeRef),
    rationalEntry(0x0002, decimalToDmsRationals(gps.latitude)),
    asciiEntry(0x0003, gps.longitudeRef),
    rationalEntry(0x0004, decimalToDmsRationals(gps.longitude)),
    asciiEntry(0x0012, "WGS-84"),
  ];
  if (gps.altitude !== null && gps.altitude !== undefined) {
    entries.push(byteEntry(0x0005, gps.altitude < 0 ? 1 : 0));
    entries.push(rationalEntry(0x0006, [rationalFromFloat(gps.altitude)]));
  }
  return entries;
}

export function buildExifPayload(metadata) {
  const gpsEntries = buildGpsEntries(metadata.gps);
  const focalLength35mm = Math.round(metadata.focalLength[0] / metadata.focalLength[1]);
  const exifEntries = [
    rationalEntry(0x829a, [metadata.shutterSpeed]),
    rationalEntry(0x829d, [metadata.aperture]),
    shortEntry(0x8827, metadata.iso),
    asciiEntry(0x9003, metadata.captureTime),
    asciiEntry(0x9004, metadata.captureTime),
    srationalEntry(0x9204, [metadata.exposureBias]),
    rationalEntry(0x920a, [metadata.focalLength]),
    rationalEntry(0xa432, [metadata.focalLength, metadata.focalLength, metadata.aperture, metadata.aperture]),
    asciiEntry(0xa433, metadata.cameraMake),
    asciiEntry(0xa434, metadata.lensModel),
    shortEntry(0xa405, focalLength35mm),
  ];

  const ifd0BaseEntries = [
    asciiEntry(0x010f, metadata.cameraMake),
    asciiEntry(0x0110, metadata.cameraModel),
    asciiEntry(0x0131, "photo-metadata-web"),
    asciiEntry(0x0132, metadata.captureTime),
    longEntry(0x8769, 0),
  ];
  if (gpsEntries.length) ifd0BaseEntries.push(longEntry(0x8825, 0));

  const ifd0Probe = buildIfd(ifd0BaseEntries, 8);
  const exifOffset = 8 + ifd0Probe.length;
  const exifIfd = buildIfd(exifEntries, exifOffset);
  const gpsOffset = exifOffset + exifIfd.length;
  const gpsIfd = gpsEntries.length ? buildIfd(gpsEntries, gpsOffset) : new Uint8Array();

  const ifd0Entries = [
    asciiEntry(0x010f, metadata.cameraMake),
    asciiEntry(0x0110, metadata.cameraModel),
    asciiEntry(0x0131, "photo-metadata-web"),
    asciiEntry(0x0132, metadata.captureTime),
    longEntry(0x8769, exifOffset),
  ];
  if (gpsEntries.length) ifd0Entries.push(longEntry(0x8825, gpsOffset));

  const ifd0 = buildIfd(ifd0Entries, 8);
  return concatBytes(EXIF_PREFIX, TIFF_HEADER, ifd0, exifIfd, gpsIfd);
}

export function removeExistingExifApp1(jpegBytes) {
  if (jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) {
    throw new Error("当前纯前端写入器只支持 JPEG 输出。");
  }

  const chunks = [jpegBytes.slice(0, 2)];
  let index = 2;
  while (index < jpegBytes.length) {
    const segmentStart = index;
    if (jpegBytes[index] !== 0xff) {
      chunks.push(jpegBytes.slice(index));
      break;
    }
    while (index < jpegBytes.length && jpegBytes[index] === 0xff) index += 1;
    if (index >= jpegBytes.length) break;
    const marker = jpegBytes[index];
    index += 1;

    if (marker === 0xda) {
      chunks.push(jpegBytes.slice(segmentStart));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      chunks.push(jpegBytes.slice(segmentStart, index));
      continue;
    }
    if (index + 2 > jpegBytes.length) {
      throw new Error("JPEG segment length 无效。");
    }
    const segmentLength = (jpegBytes[index] << 8) | jpegBytes[index + 1];
    const segmentEnd = index + segmentLength;
    if (segmentLength < 2 || segmentEnd > jpegBytes.length) {
      throw new Error("JPEG segment boundary 无效。");
    }
    const payload = jpegBytes.slice(index + 2, segmentEnd);
    const isExifApp1 =
      marker === 0xe1 &&
      payload.length >= EXIF_PREFIX.length &&
      EXIF_PREFIX.every((byte, i) => payload[i] === byte);
    if (!isExifApp1) {
      chunks.push(jpegBytes.slice(segmentStart, segmentEnd));
    }
    index = segmentEnd;
  }
  return concatBytes(...chunks);
}

export function writeExifToJpeg(jpegBytes, metadata) {
  const exifPayload = buildExifPayload(metadata);
  const segmentLength = exifPayload.length + 2;
  if (segmentLength > 65535) {
    throw new Error("EXIF payload 超过 JPEG APP1 segment 限制。");
  }
  const app1Segment = concatBytes(
    new Uint8Array([0xff, 0xe1]),
    new Uint8Array([(segmentLength >> 8) & 0xff, segmentLength & 0xff]),
    exifPayload,
  );
  const cleaned = removeExistingExifApp1(jpegBytes);
  return concatBytes(cleaned.slice(0, 2), app1Segment, cleaned.slice(2));
}

function findExifPayload(jpegBytes) {
  if (jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) return null;
  let index = 2;
  while (index < jpegBytes.length) {
    if (jpegBytes[index] !== 0xff) return null;
    while (index < jpegBytes.length && jpegBytes[index] === 0xff) index += 1;
    if (index >= jpegBytes.length) return null;
    const marker = jpegBytes[index];
    index += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (index + 2 > jpegBytes.length) return null;
    const segmentLength = (jpegBytes[index] << 8) | jpegBytes[index + 1];
    const segmentEnd = index + segmentLength;
    if (segmentLength < 2 || segmentEnd > jpegBytes.length) return null;
    const payload = jpegBytes.slice(index + 2, segmentEnd);
    const isExif =
      marker === 0xe1 &&
      payload.length >= EXIF_PREFIX.length &&
      EXIF_PREFIX.every((byte, i) => payload[i] === byte);
    if (isExif) return payload;
    index = segmentEnd;
  }
  return null;
}

class TiffReader {
  constructor(exifPayload) {
    this.tiff = exifPayload.slice(EXIF_PREFIX.length);
    this.view = new DataView(this.tiff.buffer, this.tiff.byteOffset, this.tiff.byteLength);
    const order = String.fromCharCode(this.tiff[0], this.tiff[1]);
    if (order === "II") this.little = true;
    else if (order === "MM") this.little = false;
    else throw new Error("Unsupported TIFF byte order.");
    if (this.uint16(2) !== 42) throw new Error("Invalid TIFF marker.");
  }

  uint16(offset) {
    return this.view.getUint16(offset, this.little);
  }

  uint32(offset) {
    return this.view.getUint32(offset, this.little);
  }

  int32(offset) {
    return this.view.getInt32(offset, this.little);
  }

  firstIfdOffset() {
    return this.uint32(4);
  }

  readIfd(offset) {
    if (!offset || offset + 2 > this.tiff.length) return new Map();
    const count = this.uint16(offset);
    const entries = new Map();
    let cursor = offset + 2;
    for (let i = 0; i < count; i += 1) {
      if (cursor + 12 > this.tiff.length) break;
      const tag = this.uint16(cursor);
      const type = this.uint16(cursor + 2);
      const valueCount = this.uint32(cursor + 4);
      const value = this.tiff.slice(cursor + 8, cursor + 12);
      entries.set(tag, { type, count: valueCount, value });
      cursor += 12;
    }
    return entries;
  }

  entryData(entry) {
    if (!entry) return new Uint8Array();
    const typeSize = TYPE_SIZES[entry.type];
    if (!typeSize) return new Uint8Array();
    const size = typeSize * entry.count;
    if (size <= 4) return entry.value.slice(0, size);
    const offsetView = new DataView(entry.value.buffer, entry.value.byteOffset, 4);
    const offset = offsetView.getUint32(0, this.little);
    if (offset < 0 || offset + size > this.tiff.length) return new Uint8Array();
    return this.tiff.slice(offset, offset + size);
  }

  readText(entries, tag) {
    const raw = this.entryData(entries.get(tag));
    if (!raw.length) return "";
    const nullIndex = raw.indexOf(0);
    const trimmed = nullIndex >= 0 ? raw.slice(0, nullIndex) : raw;
    if (!trimmed.length) return "";
    const text = utf8Decoder.decode(trimmed).trim();
    return text || latin1Decoder.decode(trimmed).trim();
  }

  readShort(entries, tag) {
    const data = this.entryData(entries.get(tag));
    if (data.length < 2) return null;
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(0, this.little);
  }

  readLong(entries, tag) {
    const data = this.entryData(entries.get(tag));
    if (data.length < 4) return null;
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, this.little);
  }

  readRational(entries, tag) {
    const data = this.entryData(entries.get(tag));
    if (data.length < 8) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const numerator = view.getUint32(0, this.little);
    const denominator = view.getUint32(4, this.little);
    return denominator ? [numerator, denominator] : null;
  }

  readSRational(entries, tag) {
    const data = this.entryData(entries.get(tag));
    if (data.length < 8) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const numerator = view.getInt32(0, this.little);
    const denominator = view.getInt32(4, this.little);
    return denominator ? [numerator, denominator] : null;
  }

  readRationalList(entries, tag) {
    const data = this.entryData(entries.get(tag));
    if (!data.length) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const values = [];
    for (let offset = 0; offset + 8 <= data.length; offset += 8) {
      const numerator = view.getUint32(offset, this.little);
      const denominator = view.getUint32(offset + 4, this.little);
      if (!denominator) return null;
      values.push([numerator, denominator]);
    }
    return values.length ? values : null;
  }
}

function gpsDecimalFromDms(values, ref) {
  const [degrees, minutes, seconds] = values.map(([num, den]) => num / den);
  const decimal = degrees + minutes / 60 + seconds / 3600;
  return ref === "S" || ref === "W" ? -decimal : decimal;
}

export function extractPhotoMetadata(jpegBytes) {
  const payload = findExifPayload(jpegBytes);
  if (!payload) return {};
  try {
    const reader = new TiffReader(payload);
    const ifd0 = reader.readIfd(reader.firstIfdOffset());
    const exifIfd = reader.readIfd(reader.readLong(ifd0, 0x8769) || 0);
    const gpsIfd = reader.readIfd(reader.readLong(ifd0, 0x8825) || 0);
    const metadata = {
      cameraMake: reader.readText(ifd0, 0x010f),
      cameraModel: reader.readText(ifd0, 0x0110),
      lensModel: reader.readText(exifIfd, 0xa434),
      captureTime:
        reader.readText(exifIfd, 0x9003) || reader.readText(exifIfd, 0x9004) || reader.readText(ifd0, 0x0132),
      iso: reader.readShort(exifIfd, 0x8827),
      focalLength: reader.readRational(exifIfd, 0x920a),
      exposureBias: reader.readSRational(exifIfd, 0x9204),
      aperture: reader.readRational(exifIfd, 0x829d),
      shutterSpeed: reader.readRational(exifIfd, 0x829a),
      lensSpecification: reader.readRationalList(exifIfd, 0xa432),
    };
    const focalLength35mm = reader.readShort(exifIfd, 0xa405);
    if (focalLength35mm) metadata.focalLength = [focalLength35mm, 1];

    const latitudeRef = reader.readText(gpsIfd, 0x0001);
    const latitudeValues = reader.readRationalList(gpsIfd, 0x0002);
    const longitudeRef = reader.readText(gpsIfd, 0x0003);
    const longitudeValues = reader.readRationalList(gpsIfd, 0x0004);
    if (latitudeRef && latitudeValues && longitudeRef && longitudeValues) {
      metadata.gpsText = `${gpsDecimalFromDms(latitudeValues, latitudeRef).toFixed(6)},${gpsDecimalFromDms(
        longitudeValues,
        longitudeRef,
      ).toFixed(6)}`;
    }
    return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== null && value !== ""));
  } catch {
    return {};
  }
}

export function metadataFromTemplate(templateKey, captureTime, gpsText) {
  const template = TEMPLATES[templateKey] || TEMPLATES.iphone16pro;
  return {
    cameraMake: template.cameraMake,
    cameraModel: template.cameraModel,
    lensModel: template.lensModel,
    captureTime,
    gps: parseGpsText(gpsText || template.gps),
    iso: template.iso,
    focalLength: template.focalLength,
    exposureBias: template.exposureBias,
    aperture: template.aperture,
    shutterSpeed: template.shutterSpeed,
  };
}

function formatMetadata(metadata, field) {
  switch (field) {
    case "camera":
      return [metadata.cameraMake, metadata.cameraModel].filter(Boolean).join(" ") || "—";
    case "lens":
      return metadata.lensModel || "—";
    case "time":
      return metadata.captureTime || "—";
    case "gps":
      return metadata.gpsText || (metadata.gps ? `${metadata.gps.latitude},${metadata.gps.longitude}` : "—");
    case "iso":
      return metadata.iso ? `ISO${metadata.iso}` : "—";
    case "focal":
      return metadata.focalLength ? `${rationalToDecimalText(metadata.focalLength)} mm` : "—";
    case "ev":
      return metadata.exposureBias ? `${rationalToDecimalText(metadata.exposureBias)} ev` : "—";
    case "aperture":
      return metadata.aperture ? `ƒ${rationalToDecimalText(metadata.aperture)}` : "—";
    case "shutter":
      return metadata.shutterSpeed ? `${rationalToFractionText(metadata.shutterSpeed)} s` : "—";
    default:
      return "—";
  }
}

function displayRows(newMetadata = null) {
  const rows = [
    ["相机", "camera"],
    ["镜头", "lens"],
    ["时间", "time"],
    ["GPS", "gps"],
    ["ISO", "iso"],
    ["焦距", "focal"],
    ["曝光", "ev"],
    ["光圈", "aperture"],
    ["快门", "shutter"],
  ];
  const tbody = document.querySelector("#metadataRows");
  tbody.innerHTML = rows
    .map(
      ([label, field]) => `<tr><td>${label}</td><td>${formatMetadata(originalMetadata, field)}</td><td>${formatMetadata(
        newMetadata || {},
        field,
      )}</td></tr>`,
    )
    .join("");
}

function setStatus(message, type = "") {
  const statusLine = document.querySelector("#statusLine");
  statusLine.textContent = message;
  statusLine.className = `status-line ${type}`.trim();
}

function datetimeLocalValue(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

function datetimeLocalToExif(value) {
  const source = value ? new Date(value) : new Date();
  const date = Number.isNaN(source.getTime()) ? new Date() : source;
  const pad = (item) => String(item).padStart(2, "0");
  return `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}

function filenameTimestamp(value) {
  return value.replace(/:/g, "").replace(" ", "_");
}

function slugForTemplate(key) {
  return key.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

function currentTemplateKey() {
  return document.querySelector("#modelSelect").value || "iphone16pro";
}

function updateTemplateDetails() {
  const template = TEMPLATES[currentTemplateKey()];
  const detail = document.querySelector("#templateDetails");
  detail.innerHTML = [
    ["相机", template.cameraModel],
    ["镜头", template.lensModel],
    ["ISO", `ISO${template.iso}`],
    ["焦距", `${rationalToDecimalText(template.focalLength)} mm`],
    ["光圈", `ƒ${rationalToDecimalText(template.aperture)}`],
    ["快门", `${rationalToFractionText(template.shutterSpeed)} s`],
  ]
    .map(([label, value]) => `<div class="detail-item"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

async function convertImageFileToJpegBytes(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("无法把图片转成 JPEG。"))), "image/jpeg", 0.94);
    });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fileToWorkingJpegBytes(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const looksLikeJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (file.type === "image/jpeg" || looksLikeJpeg) return bytes;
  return convertImageFileToJpegBytes(file);
}

async function handleFile(file) {
  if (!file) return;
  sourceFile = file;
  resultBlob = null;
  resultFile = null;
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = "";

  document.querySelector("#previewImage").hidden = false;
  document.querySelector("#emptyPreview").hidden = true;
  document.querySelector("#previewImage").src = URL.createObjectURL(file);
  document.querySelector("#fileName").textContent = file.name;
  document.querySelector("#fileMeta").textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB · ${file.type || "image"}`;

  setStatus("正在读取图片。");
  const rawBytes = new Uint8Array(await file.arrayBuffer());
  originalMetadata = rawBytes[0] === 0xff && rawBytes[1] === 0xd8 ? extractPhotoMetadata(rawBytes) : {};
  sourceJpegBytes = await fileToWorkingJpegBytes(file);
  displayRows();
  document.querySelector("#generateButton").disabled = false;
  document.querySelector("#shareButton").disabled = true;
  document.querySelector("#downloadLink").classList.add("disabled");
  document.querySelector("#resultBadge").textContent = "待生成";
  setStatus("图片已就绪。", "ok");
}

function renderTemplateOptions() {
  const select = document.querySelector("#modelSelect");
  select.innerHTML = Object.entries(TEMPLATES)
    .map(([key, template]) => `<option value="${key}">${template.cameraModel}</option>`)
    .join("");
  select.value = "iphone16pro";
  document.querySelector("#templateCount").textContent = `${Object.keys(TEMPLATES).length} 个模板`;
  updateTemplateDetails();
}

async function generatePhoto() {
  if (!sourceJpegBytes) return;
  try {
    if (document.querySelector("#useNowSwitch").checked) {
      document.querySelector("#captureTimeInput").value = datetimeLocalValue();
    }
    const captureTime = datetimeLocalToExif(document.querySelector("#captureTimeInput").value);
    const metadata = metadataFromTemplate(currentTemplateKey(), captureTime, document.querySelector("#gpsInput").value);
    const outputBytes = writeExifToJpeg(sourceJpegBytes, metadata);
    const filename = `IMG_${filenameTimestamp(captureTime)}_${slugForTemplate(currentTemplateKey())}.jpg`;

    resultBlob = new Blob([outputBytes], { type: "image/jpeg" });
    resultFile = new File([resultBlob], filename, { type: "image/jpeg" });
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(resultBlob);

    document.querySelector("#previewImage").src = resultUrl;
    const downloadLink = document.querySelector("#downloadLink");
    downloadLink.href = resultUrl;
    downloadLink.download = filename;
    downloadLink.classList.remove("disabled");
    document.querySelector("#shareButton").disabled = false;
    document.querySelector("#resultBadge").textContent = filename;
    displayRows({
      ...metadata,
      gpsText: document.querySelector("#gpsInput").value,
    });
    setStatus("已生成带新 EXIF 的 JPEG。iPhone 上优先用“分享保存”。", "ok");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
}

async function shareResult() {
  if (!resultFile) return;
  if (navigator.canShare && navigator.canShare({ files: [resultFile] })) {
    await navigator.share({
      files: [resultFile],
      title: "照片元数据网页写入器",
      text: "带新 EXIF 的照片",
    });
    setStatus("分享面板已打开；可在 iOS 里选择保存图像。", "ok");
    return;
  }
  setStatus("当前浏览器不支持文件分享，请使用“下载 JPEG”。", "warn");
}

async function useCurrentLocation() {
  if (!navigator.geolocation) {
    setStatus("当前浏览器不支持定位。", "warn");
    return;
  }
  setStatus("正在读取当前位置。");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      document.querySelector("#gpsInput").value = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
      setStatus("已填入当前位置。", "ok");
    },
    (error) => setStatus(error.message || "无法读取当前位置。", "warn"),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

function resetApp() {
  sourceFile = null;
  sourceJpegBytes = null;
  originalMetadata = {};
  resultBlob = null;
  resultFile = null;
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = "";
  document.querySelector("#fileInput").value = "";
  document.querySelector("#previewImage").hidden = true;
  document.querySelector("#previewImage").removeAttribute("src");
  document.querySelector("#emptyPreview").hidden = false;
  document.querySelector("#fileName").textContent = "选择或拖入一张图片";
  document.querySelector("#fileMeta").textContent = "JPEG 会直接写入 EXIF；其他格式会先在浏览器中转成 JPEG。";
  document.querySelector("#generateButton").disabled = true;
  document.querySelector("#shareButton").disabled = true;
  document.querySelector("#downloadLink").classList.add("disabled");
  document.querySelector("#resultBadge").textContent = "未生成";
  displayRows();
  setStatus("等待图片。");
}

function initApp() {
  renderTemplateOptions();
  document.querySelector("#captureTimeInput").value = datetimeLocalValue();
  displayRows();

  const fileInput = document.querySelector("#fileInput");
  const dropZone = document.querySelector("#dropZone");

  fileInput.addEventListener("change", () => handleFile(fileInput.files?.[0]).catch((error) => setStatus(error.message, "error")));
  document.querySelector("#modelSelect").addEventListener("change", updateTemplateDetails);
  document.querySelector("#generateButton").addEventListener("click", generatePhoto);
  document.querySelector("#shareButton").addEventListener("click", () => shareResult().catch((error) => setStatus(error.message, "error")));
  document.querySelector("#locationButton").addEventListener("click", useCurrentLocation);
  document.querySelector("#resetButton").addEventListener("click", resetApp);

  for (const eventName of ["dragenter", "dragover"]) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("dragging");
    });
  }
  dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    handleFile(file).catch((error) => setStatus(error.message, "error"));
  });
}

if (typeof document !== "undefined") {
  initApp();
}
