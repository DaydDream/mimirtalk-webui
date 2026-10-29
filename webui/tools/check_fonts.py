#!/usr/bin/env python
"""Validate both runtime/packaged fonts, real weights, coverage and licenses."""
import argparse
from pathlib import Path
from font_assets import FONT_DIR, check

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fonts-dir", type=Path, default=FONT_DIR)
    parser.add_argument("--font", type=Path, help="Infer fonts-dir from a packaged font")
    args = parser.parse_args()
    check(args.font.parent if args.font else args.fonts_dir)
