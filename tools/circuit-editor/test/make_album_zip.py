# Writes test/fixtures/photos-album.zip with Python's zipfile (a writer that is not the
# editor's), from the photo fixtures:  python3 -I tools/circuit-editor/test/make_album_zip.py tools/circuit-editor/test/fixtures
import sys, zipfile, pathlib
fx = pathlib.Path(sys.argv[1])
png = bytes.fromhex('89504e470d0a1a0a') + b'not really a picture'
with zipfile.ZipFile(fx / 'photos-album.zip', 'w') as z:
    z.comment = b'Google Photos'
    def put(name, data, method):
        i = zipfile.ZipInfo(name, date_time=(2026, 11, 27, 18, 0, 0))
        i.compress_type = method
        z.writestr(i, data)
    put('Album Kep/', b'', zipfile.ZIP_STORED)
    put('Album Kep/photo-near.jpg', (fx / 'photo-near.jpg').read_bytes(), zipfile.ZIP_STORED)
    put('Album Kep/photo-near-2.jpg', (fx / 'photo-near-2.jpg').read_bytes(), zipfile.ZIP_DEFLATED)
    put('Album Kep/capture.png', png, zipfile.ZIP_STORED)
    put('Album Kep/Été à Kep.jpg', (fx / 'photo-near.jpg').read_bytes(), zipfile.ZIP_DEFLATED)
