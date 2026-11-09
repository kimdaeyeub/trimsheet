import zlib from 'node:zlib';

const CRC = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc = (buf: Uint8Array) => {
	let c = 0xffffffff;
	for (const x of buf) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const td = Buffer.concat([Buffer.from(type), data]);
	const c = Buffer.alloc(4);
	c.writeUInt32BE(crc(td));
	return Buffer.concat([len, td, c]);
};

/** RGB PNG whose pixel colour comes from `pixel(x, y)`. */
export function makePng(w: number, h: number, pixel: (x: number, y: number) => [number, number, number]): Uint8Array {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const rows = Array.from({ length: h }, (_, y) => Buffer.from([0, ...Array.from({ length: w }, (_, x) => pixel(x, y)).flat()]));
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
		chunk('IEND', Buffer.alloc(0)),
	]);
}
