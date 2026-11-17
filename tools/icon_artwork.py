"""Deterministic format preparation of the approved transparent cube master."""
from io import BytesIO
from pathlib import Path
import hashlib
import json
import struct
from PIL import Image, ImageDraw, ImageChops

def load_cube(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    alpha = image.getchannel("A")
    bounds = alpha.getbbox()
    if bounds is None or alpha.getextrema()[0] == 255:
        raise ValueError("The approved cube master must have a transparent margin")
    # Technical export cleanup only: preserve every pixel of the centered cube
    # and its attached antialiasing; discard disconnected alpha-noise specks.
    seed = (image.width // 2, image.height // 2)
    if not alpha.getpixel(seed):
        raise ValueError("The approved cube master must be centered")
    support = alpha.point(lambda value: 255 if value else 0)
    ImageDraw.floodfill(support, seed, 128)
    connected = support.point(lambda value: 255 if value == 128 else 0)
    image.putalpha(ImageChops.multiply(alpha, connected))
    return image.crop(connected.getbbox())

def centered_cube(cube: Image.Image, edge: int, content_edge: int) -> Image.Image:
    scale = content_edge / max(cube.size)
    size = tuple(max(1, round(value * scale)) for value in cube.size)
    # RGBa resamples premultiplied colors, preventing dark/colored alpha fringes.
    resized = cube.convert("RGBa").resize(size, Image.Resampling.LANCZOS).convert("RGBA")
    result = Image.new("RGBA", (edge, edge))
    result.alpha_composite(resized, ((edge - size[0]) // 2, (edge - size[1]) // 2))
    return result

def background_icon(cube: Image.Image, edge: int, color="#20242e", round_icon=False) -> Image.Image:
    # Legacy/store icons have one background; no tile enters adaptive foreground.
    result = Image.new("RGBA", (edge, edge), color)
    result.alpha_composite(centered_cube(cube, edge, round(edge * .86)))
    if round_icon:
        mask = Image.new("L", (edge * 4, edge * 4))
        ImageDraw.Draw(mask).ellipse((0, 0, edge * 4 - 1, edge * 4 - 1), fill=255)
        result.putalpha(mask.resize((edge, edge), Image.Resampling.LANCZOS))
    return result

def write_windows_ico(path: Path, cube: Image.Image, sizes) -> list[dict]:
    payloads, records = [], []
    for size in sizes:
        frame = centered_cube(cube, size, max(1, round(size * .96)))
        output = BytesIO()
        frame.save(output, format="PNG", compress_level=9)
        payloads.append(output.getvalue())
        records.append({"size": size, "alphaBounds": frame.getchannel("A").getbbox()})
    offset = 6 + 16 * len(sizes)
    directory = bytearray(struct.pack("<HHH", 0, 1, len(sizes)))
    for size, data in zip(sizes, payloads):
        directory.extend(struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
    path.write_bytes(directory + b"".join(payloads))
    return records

def write_manifest(path: Path, master: Path, outputs, **metadata):
    records = []
    for output in outputs:
        data = output.read_bytes()
        records.append({"path": output.relative_to(master.parents[1]).as_posix(), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"master": "artwork/cube-mark.png", "masterSha256": hashlib.sha256(master.read_bytes()).hexdigest(), **metadata, "files": records}, indent=2) + "\n", encoding="utf-8")
