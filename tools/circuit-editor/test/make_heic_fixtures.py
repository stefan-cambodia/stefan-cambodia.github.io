# Writes the HEIC fixtures of the circuit editor from photo-near-2.jpg (needs
# heif-enc, from libheif, which carries the JPEG's Exif block over):
#
#   python3 -I tools/circuit-editor/test/make_heic_fixtures.py tools/circuit-editor/test/fixtures
#
# photo-near-2.heic         as a phone writes it: the metadata box ("meta") first
# photo-near-2-late.heic    the same boxes with the picture ("mdat") first and the
#                           metadata box after it, as the files of a Google Photos
#                           album download are laid out (its "iloc" offsets moved)
import pathlib
import struct
import subprocess
import sys

fx = pathlib.Path(sys.argv[1])
subprocess.run(["heif-enc", "-q", "60", "-o", str(fx / "photo-near-2.heic"), str(fx / "photo-near-2.jpg")], check=True,
               stdout=subprocess.DEVNULL)
data = (fx / "photo-near-2.heic").read_bytes()


def boxes(b, start, end):
    out, pos = [], start
    while pos + 8 <= end:
        size, kind = struct.unpack(">I4s", b[pos:pos + 8])
        out.append((kind.decode("latin1"), pos, pos + size))
        pos += size
    return out


top = boxes(data, 0, len(data))
assert [k for k, _, _ in top] == ["ftyp", "meta", "mdat"], top
(_, f0, f1), (_, m0, m1), (_, d0, d1) = top
meta = bytearray(data[m0:m1])
assert d0 == m1
delta = m1 - f1                   # the picture moves up by the size of the metadata box
for kind, a, b in boxes(meta, 12, len(meta)):
    if kind != "iloc":
        continue
    version = meta[a + 8]
    pos = a + 12
    off_size, len_size = meta[pos] >> 4, meta[pos] & 15
    base_size, idx_size = meta[pos + 1] >> 4, (meta[pos + 1] & 15 if version else 0)
    pos += 2
    count = struct.unpack(">H" if version < 2 else ">I", meta[pos:pos + (2 if version < 2 else 4)])[0]
    pos += 2 if version < 2 else 4
    fmt = {0: None, 4: ">I", 8: ">Q"}
    for _ in range(count):
        pos += 2 if version < 2 else 4
        method = 0
        if version:
            method = meta[pos + 1] & 15
            pos += 2
        pos += 2
        if base_size and method == 0:
            v = struct.unpack(fmt[base_size], meta[pos:pos + base_size])[0]
            meta[pos:pos + base_size] = struct.pack(fmt[base_size], v - delta)
            shift_extents = False
        else:
            shift_extents = method == 0
        pos += base_size
        extents = struct.unpack(">H", meta[pos:pos + 2])[0]
        pos += 2
        for _ in range(extents):
            pos += idx_size
            if shift_extents and off_size:
                v = struct.unpack(fmt[off_size], meta[pos:pos + off_size])[0]
                meta[pos:pos + off_size] = struct.pack(fmt[off_size], v - delta)
            pos += off_size + len_size
(fx / "photo-near-2-late.heic").write_bytes(data[f0:f1] + data[d0:d1] + bytes(meta))
print("wrote photo-near-2.heic (%d bytes) and photo-near-2-late.heic, picture moved up by %d bytes" % (len(data), delta))
