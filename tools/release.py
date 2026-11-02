#!/usr/bin/env python3
"""Build deterministic installable, source, and documentation release ZIP files."""
from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODULE = ROOT / "luck-points"
VERSION = json.loads((MODULE / "module.json").read_text(encoding="utf-8"))["version"]
ZIP_TIMESTAMP = (2026, 10, 28, 12, 0, 0)
EXCLUDE_NAMES = {"__pycache__", ".DS_Store", ".pytest_cache"}


def add_tree(archive: zipfile.ZipFile, directory: Path, prefix: str) -> None:
  for file in sorted(directory.rglob("*")):
    if not file.is_file() or any(part in EXCLUDE_NAMES for part in file.parts):
      continue
    if file.suffix in {".pyc", ".zip"}:
      continue
    relative = file.relative_to(directory).as_posix()
    destination = f"{prefix}/{relative}"
    member = zipfile.ZipInfo(destination, ZIP_TIMESTAMP)
    member.compress_type = zipfile.ZIP_DEFLATED
    member.external_attr = (0o100644 << 16)
    archive.writestr(member, file.read_bytes(), compresslevel=9)


def build(output: Path) -> None:
  output.mkdir(parents=True, exist_ok=True)
  with zipfile.ZipFile(output / f"luck-points-v{VERSION}.zip", "w") as archive:
    add_tree(archive, MODULE, "luck-points")
  with zipfile.ZipFile(output / f"luck-points-source-v{VERSION}.zip", "w") as archive:
    add_tree(archive, ROOT, "luck-points-source")
  with zipfile.ZipFile(output / f"luck-points-documentation-v{VERSION}.zip", "w") as archive:
    for path in ("README.md", "README.de.md", "CHANGELOG.md", "LICENSE"):
      file = MODULE / path
      member = zipfile.ZipInfo(f"luck-points-documentation/{path}", ZIP_TIMESTAMP)
      member.compress_type = zipfile.ZIP_DEFLATED
      member.external_attr = (0o100644 << 16)
      archive.writestr(member, file.read_bytes(), compresslevel=9)
    add_tree(archive, MODULE / "docs", "luck-points-documentation/docs")


if __name__ == "__main__":
  parser = argparse.ArgumentParser()
  parser.add_argument("--output", type=Path, default=ROOT.parent)
  build(parser.parse_args().output)
