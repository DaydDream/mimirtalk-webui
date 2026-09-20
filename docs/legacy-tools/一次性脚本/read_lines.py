from __future__ import annotations

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("start", type=int)
    parser.add_argument("end", type=int)
    args = parser.parse_args()
    lines = args.path.read_text(encoding="utf-8").splitlines()
    for number in range(max(args.start, 1), min(args.end, len(lines)) + 1):
        print(f"{number}: {lines[number - 1]}")


if __name__ == "__main__":
    main()
