/*
 * 低内存 PNG 分片编码器（B2）。
 *
 * 目的：长图导出不再创建整幅大 canvas。业务层按 tile 逐片取像素交给本模块，
 * 本模块逐片压入**同一条** zlib 流（原生 CompressionStream('deflate')，RFC1950），
 * 最后按 PNG 规则封装 IHDR/IDAT/IEND。任意时刻只保留当前片的原始像素与已压缩流，
 * 因此内存按「片」而不是按「整幅」增长。
 *
 * 只做编码，不碰业务布局；安卓端使用，桌面端仍走整幅 canvas.toBlob（D10/D11）。
 * 不新增第三方依赖。
 */
(function () {
  "use strict";

  const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  // 单个 IDAT chunk 的数据上限，避免超长 chunk。
  const IDAT_CHUNK_MAX = 1 << 20;

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function u32(value) {
    return new Uint8Array([
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ]);
  }

  // 组装一个 PNG chunk：长度 + 类型 + 数据 + CRC（CRC 覆盖类型 + 数据）。
  function buildChunk(type, data) {
    const typeBytes = new Uint8Array([
      type.charCodeAt(0),
      type.charCodeAt(1),
      type.charCodeAt(2),
      type.charCodeAt(3),
    ]);
    const body = new Uint8Array(typeBytes.length + data.length);
    body.set(typeBytes, 0);
    body.set(data, typeBytes.length);
    const out = new Uint8Array(4 + body.length + 4);
    out.set(u32(data.length), 0);
    out.set(body, 4);
    out.set(u32(crc32(body)), 4 + body.length);
    return out;
  }

  function supported() {
    return typeof CompressionStream === "function";
  }

  function pickTileHeight(options = {}) {
    const explicit = Number(options.tileHeight);
    if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
    return 4096;
  }

  /**
   * 逐片编码为单张 PNG。
   *
   * @param {object} options
   * @param {number} options.width   输出图宽（设备像素）
   * @param {number} options.height  输出图高（设备像素）
   * @param {number} options.tileHeight 每片高度（设备像素）
   * @param {(top:number, height:number) => (Uint8ClampedArray|Uint8Array)} options.getTileRgba
   *        取某一片的 RGBA 像素（长度必须为 width*height*4）
   * @param {(done:number,total:number) => void} [options.onProgress]
   * @returns {Promise<Blob>}
   */
  async function encodeTiled(options) {
    if (!supported()) {
      throw new Error("当前环境不支持 CompressionStream，无法低内存编码 PNG");
    }
    const width = Math.max(1, Math.round(Number(options.width) || 0));
    const height = Math.max(1, Math.round(Number(options.height) || 0));
    const tileHeight = pickTileHeight(options);
    const getTileRgba = options.getTileRgba;
    if (typeof getTileRgba !== "function") {
      throw new Error("encodeTiled 需要 getTileRgba 回调");
    }

    const stream = new CompressionStream("deflate");
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const compressed = [];
    let compressedBytes = 0;
    // 与写入并发地抽干压缩输出，避免 TransformStream 背压死锁。
    const pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length) {
          compressed.push(value);
          compressedBytes += value.length;
        }
      }
    })();

    const rowBytes = 1 + width * 4;
    let written = 0;
    for (let top = 0; top < height; top += tileHeight) {
      const tileH = Math.min(tileHeight, height - top);
      const rgba = getTileRgba(top, tileH);
      const raw = new Uint8Array(rowBytes * tileH);
      for (let row = 0; row < tileH; row += 1) {
        const src = row * width * 4;
        const dst = row * rowBytes;
        raw[dst] = 0; // filter: None
        raw.set(rgba.subarray(src, src + width * 4), dst + 1);
      }
      await writer.write(raw);
      written += tileH;
      if (typeof options.onProgress === "function") {
        options.onProgress(written, height);
      }
    }
    await writer.close();
    await pump;

    const idat = new Uint8Array(compressedBytes);
    let offset = 0;
    for (const part of compressed) {
      idat.set(part, offset);
      offset += part.length;
    }

    const ihdr = new Uint8Array(13);
    ihdr.set(u32(width), 0);
    ihdr.set(u32(height), 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type: truecolor + alpha
    ihdr[10] = 0; // compression: deflate
    ihdr[11] = 0; // filter: adaptive
    ihdr[12] = 0; // interlace: none

    const pieces = [SIGNATURE, buildChunk("IHDR", ihdr)];
    for (let start = 0; start < idat.length; start += IDAT_CHUNK_MAX) {
      pieces.push(buildChunk("IDAT", idat.subarray(start, Math.min(start + IDAT_CHUNK_MAX, idat.length))));
    }
    pieces.push(buildChunk("IEND", new Uint8Array(0)));
    return new Blob(pieces, { type: "image/png" });
  }

  window.MimirTalkPngStream = { supported, encodeTiled, crc32, IDAT_CHUNK_MAX };
})();
