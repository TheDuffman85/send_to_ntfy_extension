// ZIP utilities for the popup. Archives use the "stored" method, so files are
// packaged without compression and can be extracted by any standard ZIP tool.

const ZipUtils = (() => {
    const textEncoder = new TextEncoder();
    const UTF8_FLAG = 0x0800;
    const STORE_METHOD = 0;
    const crcTable = new Uint32Array(256);

    for (let index = 0; index < crcTable.length; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++) {
            value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
        }
        crcTable[index] = value >>> 0;
    }

    function toBytes(data) {
        if (data instanceof Uint8Array) {
            return data;
        }

        if (data instanceof ArrayBuffer) {
            return new Uint8Array(data);
        }

        if (ArrayBuffer.isView(data)) {
            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        }

        throw new TypeError('ZIP entries must contain binary data');
    }

    function crc32(bytes) {
        let crc = 0xffffffff;

        for (const byte of bytes) {
            crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
        }

        return (crc ^ 0xffffffff) >>> 0;
    }

    function writeUint16(buffer, offset, value) {
        buffer[offset] = value & 0xff;
        buffer[offset + 1] = (value >>> 8) & 0xff;
    }

    function writeUint32(buffer, offset, value) {
        buffer[offset] = value & 0xff;
        buffer[offset + 1] = (value >>> 8) & 0xff;
        buffer[offset + 2] = (value >>> 16) & 0xff;
        buffer[offset + 3] = (value >>> 24) & 0xff;
    }

    function getDosDateTime(date) {
        const year = Math.max(1980, date.getFullYear());
        const time = (date.getHours() << 11)
            | (date.getMinutes() << 5)
            | Math.floor(date.getSeconds() / 2);
        const dosDate = ((year - 1980) << 9)
            | ((date.getMonth() + 1) << 5)
            | date.getDate();

        return { time, date: dosDate };
    }

    function getEntryName(name, index) {
        const fallback = `file-${index + 1}`;
        const normalized = String(name || fallback).replace(/\\/g, '/');
        const basename = normalized.split('/').filter(Boolean).pop();
        return (basename || fallback).replace(/[\u0000-\u001f]/g, '_');
    }

    function assertUint32(value, label) {
        if (value > 0xffffffff) {
            throw new RangeError(`${label} is too large for a ZIP archive`);
        }
    }

    function createStoredZip(files) {
        if (!Array.isArray(files) || files.length < 2) {
            throw new Error('At least two files are required to create a ZIP');
        }

        if (files.length > 0xffff) {
            throw new RangeError('A ZIP cannot contain more than 65,535 files');
        }

        const localParts = [];
        const centralParts = [];
        const timestamp = getDosDateTime(new Date());
        let localOffset = 0;

        files.forEach((file, index) => {
            const nameBytes = textEncoder.encode(getEntryName(file.name, index));
            const dataBytes = toBytes(file.data);

            if (nameBytes.length > 0xffff) {
                throw new RangeError('A ZIP filename is too long');
            }
            assertUint32(dataBytes.byteLength, 'A ZIP entry');
            assertUint32(localOffset, 'The ZIP archive');

            const checksum = crc32(dataBytes);
            const localHeader = new Uint8Array(30 + nameBytes.length);
            writeUint32(localHeader, 0, 0x04034b50);
            writeUint16(localHeader, 4, 20);
            writeUint16(localHeader, 6, UTF8_FLAG);
            writeUint16(localHeader, 8, STORE_METHOD);
            writeUint16(localHeader, 10, timestamp.time);
            writeUint16(localHeader, 12, timestamp.date);
            writeUint32(localHeader, 14, checksum);
            writeUint32(localHeader, 18, dataBytes.byteLength);
            writeUint32(localHeader, 22, dataBytes.byteLength);
            writeUint16(localHeader, 26, nameBytes.length);
            localHeader.set(nameBytes, 30);

            localParts.push(localHeader, dataBytes);

            const centralHeader = new Uint8Array(46 + nameBytes.length);
            writeUint32(centralHeader, 0, 0x02014b50);
            writeUint16(centralHeader, 4, 20);
            writeUint16(centralHeader, 6, 20);
            writeUint16(centralHeader, 8, UTF8_FLAG);
            writeUint16(centralHeader, 10, STORE_METHOD);
            writeUint16(centralHeader, 12, timestamp.time);
            writeUint16(centralHeader, 14, timestamp.date);
            writeUint32(centralHeader, 16, checksum);
            writeUint32(centralHeader, 20, dataBytes.byteLength);
            writeUint32(centralHeader, 24, dataBytes.byteLength);
            writeUint16(centralHeader, 28, nameBytes.length);
            writeUint32(centralHeader, 42, localOffset);
            centralHeader.set(nameBytes, 46);
            centralParts.push(centralHeader);

            localOffset += localHeader.length + dataBytes.byteLength;
        });

        const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
        assertUint32(centralSize, 'The ZIP central directory');
        assertUint32(localOffset, 'The ZIP archive');

        const endRecord = new Uint8Array(22);
        writeUint32(endRecord, 0, 0x06054b50);
        writeUint16(endRecord, 8, files.length);
        writeUint16(endRecord, 10, files.length);
        writeUint32(endRecord, 12, centralSize);
        writeUint32(endRecord, 16, localOffset);

        return new Blob([...localParts, ...centralParts, endRecord], {
            type: 'application/zip'
        });
    }

    return { createStoredZip };
})();

globalThis.ZipUtils = ZipUtils;
