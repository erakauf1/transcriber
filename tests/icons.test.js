import { describe, it, expect } from 'vitest';
import { makePng } from '../scripts/make-icons.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('makePng', () => {
  it('produces a valid PNG with the requested dimensions', () => {
    const buf = makePng(192);
    expect(buf.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    // IHDR: width at byte 16, height at byte 20 (big-endian)
    expect(buf.readUInt32BE(16)).toBe(192);
    expect(buf.readUInt32BE(20)).toBe(192);
  });
});
