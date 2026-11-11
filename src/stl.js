/**
 * Parser de STL (ASCII e binário) e medidas geométricas no navegador/Node.
 * Volume pelo método dos tetraedros com sinal (soma de A·(B×C)/6).
 */

/**
 * @typedef {{x: number, y: number, z: number}} Vec3
 * @typedef {[Vec3, Vec3, Vec3]} Triangle
 */

/**
 * @typedef {Object} StlGeometry
 * @property {Triangle[]} triangles
 * @property {number} triangleCount
 * @property {number} signedVolumeMm3
 * @property {number} volumeMm3
 * @property {number} surfaceAreaMm2
 * @property {{min: Vec3, max: Vec3, size: Vec3}} boundingBox
 * @property {"ascii"|"binary"} format
 */

/**
 * @param {ArrayBuffer} buffer
 * @param {string} [fileName]
 * @returns {StlGeometry}
 */
export function parseStl(buffer, fileName = "") {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 15) {
    throw new Error("Arquivo STL inválido ou vazio.");
  }

  const format = isBinaryStl(bytes) ? "binary" : "ascii";
  const triangles = format === "binary" ? parseBinary(bytes) : parseAscii(bytes);

  if (triangles.length === 0) {
    throw new Error("Nenhum triângulo encontrado no STL. Verifique o arquivo.");
  }

  return buildGeometry(triangles, format);
}

/**
 * Heurística confiável: STLs binários podem começar com "solid" no cabeçalho.
 * Se 84 + n * 50 === tamanho do arquivo, é binário.
 * @param {Uint8Array} bytes
 */
export function isBinaryStl(bytes) {
  if (bytes.byteLength < 84) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = view.getUint32(80, true);
  const expected = 84 + triCount * 50;
  if (expected === bytes.byteLength && triCount > 0) return true;

  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 80)).trimStart();
  if (/^solid\b/i.test(head) && expected !== bytes.byteLength) return false;
  if (bytes.byteLength >= 84 && expected === bytes.byteLength) return true;
  return false;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Triangle[]}
 */
function parseBinary(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = view.getUint32(80, true);
  if (84 + triCount * 50 > bytes.byteLength) {
    throw new Error("STL binário incompleto ou corrompido.");
  }

  const triangles = [];
  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    offset += 12; // normal
    const a = readVec3(view, offset);
    const b = readVec3(view, offset + 12);
    const c = readVec3(view, offset + 24);
    triangles.push([a, b, c]);
    offset += 38; // 36 vertex bytes + 2 attribute
  }
  return triangles;
}

/**
 * @param {DataView} view
 * @param {number} offset
 * @returns {Vec3}
 */
function readVec3(view, offset) {
  return {
    x: view.getFloat32(offset, true),
    y: view.getFloat32(offset + 4, true),
    z: view.getFloat32(offset + 8, true),
  };
}

/**
 * @param {Uint8Array} bytes
 * @returns {Triangle[]}
 */
function parseAscii(bytes) {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!/facet\s+normal/i.test(text) && !/vertex\s+/i.test(text)) {
    throw new Error("Não foi possível ler o STL. Use um arquivo ASCII ou binário válido.");
  }

  const vertexRe =
    /vertex\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/gi;

  const vertices = [];
  let match;
  while ((match = vertexRe.exec(text)) !== null) {
    vertices.push({
      x: Number(match[1]),
      y: Number(match[2]),
      z: Number(match[3]),
    });
  }

  if (vertices.length === 0 || vertices.length % 3 !== 0) {
    throw new Error("STL ASCII inválido: número de vértices inconsistente.");
  }

  const triangles = [];
  for (let i = 0; i < vertices.length; i += 3) {
    triangles.push([vertices[i], vertices[i + 1], vertices[i + 2]]);
  }
  return triangles;
}

/**
 * @param {Triangle[]} triangles
 * @param {"ascii"|"binary"} format
 * @returns {StlGeometry}
 */
export function buildGeometry(triangles, format = "ascii") {
  let signedVolume = 0;
  let area = 0;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (const [a, b, c] of triangles) {
    signedVolume += signedTetraVolume(a, b, c);
    area += triangleArea(a, b, c);

    for (const p of [a, b, c]) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (p.z > maxZ) maxZ = p.z;
    }
  }

  const size = { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };

  return {
    triangles,
    triangleCount: triangles.length,
    signedVolumeMm3: signedVolume,
    volumeMm3: Math.abs(signedVolume),
    surfaceAreaMm2: area,
    boundingBox: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
      size,
    },
    format,
  };
}

/**
 * Volume com sinal do tetraedro origem-A-B-C: A·(B×C)/6.
 * @param {Vec3} a
 * @param {Vec3} b
 * @param {Vec3} c
 */
export function signedTetraVolume(a, b, c) {
  return (
    (a.x * (b.y * c.z - b.z * c.y) -
      a.y * (b.x * c.z - b.z * c.x) +
      a.z * (b.x * c.y - b.y * c.x)) /
    6
  );
}

/**
 * @param {Vec3} a
 * @param {Vec3} b
 * @param {Vec3} c
 */
export function triangleArea(a, b, c) {
  const abx = b.x - a.x,
    aby = b.y - a.y,
    abz = b.z - a.z;
  const acx = c.x - a.x,
    acy = c.y - a.y,
    acz = c.z - a.z;
  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  return 0.5 * Math.hypot(cx, cy, cz);
}

/**
 * Gera os 12 triângulos de um cubo sólido [origin, origin+size].
 * Ordem das faces com normal para fora (volume com sinal positivo).
 * @param {number} sizeMm
 * @param {Vec3} [origin]
 * @returns {Triangle[]}
 */
export function cubeTriangles(sizeMm, origin = { x: 0, y: 0, z: 0 }) {
  const o = origin;
  const s = sizeMm;
  const v = (x, y, z) => ({ x: o.x + x, y: o.y + y, z: o.z + z });
  const faces = [
    [v(s, 0, 0), v(s, s, 0), v(s, s, s), v(s, 0, s)], // +X
    [v(0, 0, 0), v(0, 0, s), v(0, s, s), v(0, s, 0)], // -X
    [v(0, s, 0), v(0, s, s), v(s, s, s), v(s, s, 0)], // +Y
    [v(0, 0, 0), v(s, 0, 0), v(s, 0, s), v(0, 0, s)], // -Y
    [v(0, 0, s), v(s, 0, s), v(s, s, s), v(0, s, s)], // +Z
    [v(0, 0, 0), v(0, s, 0), v(s, s, 0), v(s, 0, 0)], // -Z
  ];
  const triangles = [];
  for (const [a, b, c, d] of faces) {
    triangles.push([a, b, c], [a, c, d]);
  }
  return triangles;
}

/**
 * Serializa triângulos em STL ASCII.
 * @param {Triangle[]} triangles
 * @param {string} [name]
 */
export function trianglesToAsciiStl(triangles, name = "model") {
  const lines = [`solid ${name}`];
  const fmt = (p) => `${fmtNum(p.x)} ${fmtNum(p.y)} ${fmtNum(p.z)}`;
  for (const [a, b, c] of triangles) {
    const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const len = Math.hypot(nx, ny, nz) || 1;
    lines.push(`  facet normal ${fmtNum(nx / len)} ${fmtNum(ny / len)} ${fmtNum(nz / len)}`);
    lines.push("    outer loop");
    lines.push(`      vertex ${fmt(a)}`);
    lines.push(`      vertex ${fmt(b)}`);
    lines.push(`      vertex ${fmt(c)}`);
    lines.push("    endloop");
    lines.push("  endfacet");
  }
  lines.push(`endsolid ${name}`);
  return lines.join("\n") + "\n";
}

/**
 * Serializa triângulos em STL binário.
 * @param {Triangle[]} triangles
 * @param {string} [header]
 * @returns {ArrayBuffer}
 */
export function trianglesToBinaryStl(triangles, header = "Orça3D binary STL") {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const enc = new TextEncoder().encode(header);
  bytes.set(enc.subarray(0, 80), 0);
  view.setUint32(80, triangles.length, true);
  let offset = 84;
  for (const [a, b, c] of triangles) {
    const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const len = Math.hypot(nx, ny, nz) || 1;
    writeVec3(view, offset, { x: nx / len, y: ny / len, z: nz / len });
    writeVec3(view, offset + 12, a);
    writeVec3(view, offset + 24, b);
    writeVec3(view, offset + 36, c);
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }
  return buffer;
}

function writeVec3(view, offset, p) {
  view.setFloat32(offset, p.x, true);
  view.setFloat32(offset + 4, p.y, true);
  view.setFloat32(offset + 8, p.z, true);
}

function fmtNum(n) {
  if (!Number.isFinite(n)) return "0";
  return Number(n.toPrecision(8)).toString();
}
