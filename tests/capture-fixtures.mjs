// A valid one-pixel grayscale JPEG with distinct synthetic COM metadata.
export function capturePhoto(n) {
  const label = Buffer.from(`synthetic-pantry-${n}`), comment = Buffer.alloc(4)
  comment[0] = 0xff; comment[1] = 0xfe; comment.writeUInt16BE(label.length + 2, 2)
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), comment, label,
    Buffer.from([0xff, 0xdb, 0, 67, 0]), Buffer.alloc(64, 1),
    Buffer.from([0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    Buffer.from([0xff, 0xc4, 0, 20, 0, 1]), Buffer.alloc(15), Buffer.from([0]),
    Buffer.from([0xff, 0xc4, 0, 20, 0x10, 1]), Buffer.alloc(15), Buffer.from([0]),
    Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x3f, 0xff, 0xd9]),
  ])
}

