"""Build the Windows icon from the approved transparent cube, with no inner tile."""
from pathlib import Path
from icon_artwork import load_cube, centered_cube, write_windows_ico, write_manifest

root = Path(__file__).resolve().parents[1]
master = root / "artwork/cube-mark.png"
target = root / "app.ico"
sizes = (16, 20, 24, 32, 40, 48, 64, 128, 256)
cube = load_cube(master)
records = write_windows_ico(target, cube, sizes)
app_icon = root / "data/app-icon.png"
centered_cube(cube, 1024, 922).save(app_icon, compress_level=9)
write_manifest(root / "artwork/windows-icon-manifest.json", master, [target, app_icon], frames=records, transparent=True,
    appIconCanvas=1024, appIconContent=922, alphaCleanup="discard disconnected noise; preserve centered cube and attached antialiasing")
print("Generated transparent Windows ICO frames:", ", ".join(map(str, sizes)))
