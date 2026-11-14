/* Portable Mancala mini-database reader. Works in browsers and Node.js. */
(function (root) {
  "use strict";
  const MAGIC = "MANCMM01";
  const RULES = "kalah6-capture-opposite-nonempty-perspective-future-score-v1";
  const combinations = Array.from({length: 60}, () => Array(12).fill(0));
  for (let n = 0; n < 60; n++) {
    combinations[n][0] = 1;
    for (let k = 1; k <= Math.min(n, 11); k++) {
      combinations[n][k] = combinations[n - 1][k - 1] + combinations[n - 1][k];
    }
  }
  const bitCounts = Array.from({length: 256}, (_, value) => {
    let count = 0;
    while (value) { value &= value - 1; count++; }
    return count;
  });

  function rank(pits) {
    let prefix = 0, result = 0;
    for (let i = 0; i < 11; i++) {
      prefix += pits[i];
      result += combinations[prefix + i][i + 1];
    }
    return result;
  }

  class MiniDatabase {
    constructor(input) {
      this.bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
      this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
      if (this.bytes.length < 12 || String.fromCharCode(...this.bytes.subarray(0, 8)) !== MAGIC) {
        throw new Error("Invalid mini-database header");
      }
      const length = this.view.getUint32(8, true);
      this.payloadStart = 12 + length;
      if (this.payloadStart > this.bytes.length) throw new Error("Truncated metadata");
      this.metadata = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(this.bytes.subarray(12, this.payloadStart)));
      if (this.metadata.version !== 1 || this.metadata.rules !== RULES || this.metadata.ranking !== "colex-bars-v1") {
        throw new Error("Incompatible mini-database");
      }
      this.layers = this.metadata.layers;
      const ranges = [];
      if (!Array.isArray(this.layers) || !this.layers.length) throw new Error("Empty mini-database");
      for (const layer of this.layers) {
        if (!Number.isInteger(layer.stone) || layer.stone < 2 || layer.stone > 48) throw new Error("Invalid stone count");
        const names = Object.keys(layer.sections).sort().join(",");
        if ((layer.storage === "dense" && names !== "scores") ||
            (layer.storage === "compact" && names !== "blocks,members,scores") ||
            !["dense", "compact"].includes(layer.storage)) throw new Error("Invalid layer sections");
        for (const section of Object.values(layer.sections)) {
          if (!Number.isSafeInteger(section.offset) || !Number.isSafeInteger(section.length) ||
              section.offset < 0 || section.length < 0 ||
              section.offset + section.length > this.bytes.length - this.payloadStart) {
            throw new Error("Section outside database");
          }
          ranges.push([section.offset, section.offset + section.length]);
        }
        if (layer.storage === "dense" && layer.sections.scores.length !== combinations[layer.stone + 11][11]) {
          throw new Error("Incorrect dense length");
        }
        if (layer.storage === "compact" && (layer.sections.blocks.length % 24 || layer.sections.scores.length !== layer.positions)) {
          throw new Error("Incorrect compact lengths");
        }
      }
      ranges.sort((a,b) => a[0] - b[0]);
      let end = 0;
      for (const [start, nextEnd] of ranges) {
        if (start !== end) throw new Error("Overlapping sections or payload gap");
        end = nextEnd;
      }
      if (end !== this.bytes.length - this.payloadStart) throw new Error("Incorrect payload length");
    }

    static async load(url, expectedSha256 = null) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Database download failed (${response.status})`);
      const buffer = await response.arrayBuffer();
      if (expectedSha256 !== null) {
        const hash = await globalThis.crypto.subtle.digest("SHA-256", buffer);
        const hex = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
        if (hex !== expectedSha256.toLowerCase()) throw new Error("Database file checksum mismatch");
      }
      const database = new MiniDatabase(buffer);
      await database.verify();
      return database;
    }

    section(layer, name) {
      const section = layer.sections[name];
      const start = this.payloadStart + section.offset;
      return this.bytes.subarray(start, start + section.length);
    }

    async verify() {
      for (const layer of this.layers) {
        for (const [name, section] of Object.entries(layer.sections)) {
          const hash = await globalThis.crypto.subtle.digest("SHA-256", this.section(layer, name));
          const hex = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
          if (hex !== section.sha256) throw new Error(`Checksum mismatch: ${layer.stone}/${name}`);
        }
      }
      return true;
    }

    u64(offset) {
      const value = this.view.getUint32(offset, true) + 4294967296 * this.view.getUint32(offset + 4, true);
      if (!Number.isSafeInteger(value)) throw new Error("Index exceeds JavaScript's exact integer range");
      return value;
    }

    compactOrdinal(layer, positionRank) {
      const index = this.payloadStart + layer.sections.blocks.offset;
      const members = this.payloadStart + layer.sections.members.offset;
      const blocks = layer.sections.blocks.length / 24;
      const blockId = Math.floor(positionRank / 65536), local = positionRank % 65536;
      let lo = 0, hi = blocks;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (this.view.getUint32(index + 24 * mid + 16, true) < blockId) lo = mid + 1;
        else hi = mid;
      }
      if (lo === blocks || this.view.getUint32(index + 24 * lo + 16, true) !== blockId) return null;
      const offset = this.u64(index + 24 * lo), base = this.u64(index + 24 * lo + 8);
      const count = this.view.getUint32(index + 24 * lo + 20, true);
      const size = count <= 4352 ? count * 2 : 8704;
      if (count < 1 || count > 65536 || offset + size > layer.sections.members.length || base + count > layer.positions) {
        throw new Error("Invalid compact block");
      }
      if (count <= 4352) {
        let left = 0, right = count;
        while (left < right) {
          const mid = Math.floor((left + right) / 2);
          if (this.view.getUint16(members + offset + 2 * mid, true) < local) left = mid + 1;
          else right = mid;
        }
        if (left === count || this.view.getUint16(members + offset + 2 * left, true) !== local) return null;
        return base + left;
      }
      const group = Math.floor(local / 256), within = local % 256;
      const bitsStart = members + offset + 512 + 32 * group;
      const byte = this.bytes[bitsStart + Math.floor(within / 8)], bit = within % 8;
      if (!(byte & (1 << bit))) return null;
      let ordinal = this.view.getUint16(members + offset + 2 * group, true);
      for (let i = 0; i < Math.floor(within / 8); i++) ordinal += bitCounts[this.bytes[bitsStart + i]];
      ordinal += bitCounts[byte & ((1 << bit) - 1)];
      return base + ordinal;
    }

    lookupRank(stone, positionRank) {
      if (!Number.isInteger(stone) || stone < 2 || stone > 48 || !Number.isSafeInteger(positionRank) ||
          positionRank < 0 || positionRank >= combinations[stone + 11][11]) throw new Error("Invalid position rank");
      let result = null;
      for (const layer of this.layers) {
        if (layer.stone !== stone) continue;
        const ordinal = layer.storage === "dense" ? positionRank : this.compactOrdinal(layer, positionRank);
        if (ordinal === null) continue;
        const encoded = this.bytes[this.payloadStart + layer.sections.scores.offset + ordinal];
        if (encoded === 0 && layer.storage === "dense") continue;
        if (!(encoded >= 1 && encoded <= stone + 1)) throw new Error("Invalid score byte");
        const value = encoded - 1;
        if (result !== null && result !== value) throw new Error("Conflicting scores in overlapping datasets");
        result = value;
      }
      return result;
    }

    lookup(pits) {
      if (!Array.isArray(pits) || pits.length !== 12 || pits.some(n => !Number.isInteger(n) || n < 0) ||
          pits.reduce((a,b) => a + b, 0) > 48) throw new Error("Expected twelve pit counts totaling at most 48");
      if (!pits.slice(0,6).some(Boolean) || !pits.slice(6).some(Boolean)) return pits.slice(0,6).reduce((a,b) => a+b, 0);
      return this.lookupRank(pits.reduce((a,b) => a+b, 0), rank(pits));
    }
  }

  const api = {MiniDatabase, rank};
  root.MancalaMini = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
