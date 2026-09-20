"""probe_aethergazer_usm_key：密钥、元数据或运行时参数探测工具。"""
import argparse
import json
import struct
import subprocess
import sys
import time
from pathlib import Path


DEFAULT_FFMPEG = (
    Path(__file__).resolve().parents[1]
    / "tools"
    / "bin"
    / "ffmpeg"
    / "ffmpeg-master-latest-win64-gpl-shared"
    / "bin"
    / "ffmpeg.exe"
)


def ensure_wannacri() -> None:
    root = Path(__file__).resolve().parents[1] / "tools" / "bin" / "wannacri_py"
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))


def parse_key(text: str) -> int:
    """解析key相关数据。"""
    value = int(text, 0)
    if value < 0 or value > 0xFFFFFFFF:
        raise argparse.ArgumentTypeError("key must fit in 32 bits")
    return value


def write_ivf(path: Path, packets, width: int, height: int, fps_n: int, fps_d: int) -> int:
    fps = fps_n / fps_d if fps_d else 60.0
    count = 0
    with path.open("wb") as handle:
        handle.write(b"DKIF")
        handle.write(struct.pack("<HH4sHHIIII", 0, 32, b"VP90", width, height, int(fps), 1, count, 0))
        for packet in packets:
            payload = packet[0] if isinstance(packet, tuple) else packet
            handle.write(struct.pack("<IQ", len(payload), count))
            handle.write(payload)
            count += 1
        if count:
            handle.seek(24)
            handle.write(struct.pack("<I", count))
    return count


def decode_check(ffmpeg: Path, ivf: Path, timeout: int):
    command = [
        str(ffmpeg),
        "-v",
        "error",
        "-xerror",
        "-i",
        str(ivf),
        "-f",
        "null",
        "-",
    ]
    started = time.time()
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "command": command,
            "returncode": None,
            "timeout": True,
            "elapsed_seconds": round(time.time() - started, 3),
            "stdout": exc.stdout or "",
            "stderr": exc.stderr or "",
        }

    return {
        "command": command,
        "returncode": result.returncode,
        "timeout": False,
        "elapsed_seconds": round(time.time() - started, 3),
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(description="Extract one AetherGazer USM video stream and fully decode it.")
    parser.add_argument("usm", type=Path)
    parser.add_argument("--key", type=parse_key, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--encoding", default="gbk")
    parser.add_argument("--ffmpeg", type=Path, default=DEFAULT_FFMPEG)
    parser.add_argument("--timeout", type=int, default=300)
    args = parser.parse_args()

    ensure_wannacri()
    from wannacri.usm import Usm, OpMode

    out_dir = args.out.resolve()
    if out_dir.exists() and any(out_dir.iterdir()):
        raise SystemExit(f"Refusing to overwrite non-empty output: {out_dir}")
    out_dir.mkdir(parents=True, exist_ok=True)

    started = time.time()
    usm = Usm.open(args.usm, encoding=args.encoding, key=args.key)
    parse_seconds = time.time() - started
    video = usm.videos[0]
    width = int(video.header_page["width"].val)
    height = int(video.header_page["height"].val)
    fps_n = int(video.header_page["framerate_n"].val)
    fps_d = int(video.header_page["framerate_d"].val)
    expected_frames = int(video.header_page["total_frames"].val)

    packets = list(video.stream(OpMode.DECRYPT, usm.video_key))
    ivf = out_dir / f"{args.usm.stem}.ivf"
    frames = write_ivf(ivf, packets, width, height, fps_n, fps_d)
    decode = decode_check(args.ffmpeg, ivf, args.timeout)

    report = {
        "usm": str(args.usm.resolve()),
        "key": f"0x{args.key:08X}",
        "encoding": args.encoding,
        "output_dir": str(out_dir),
        "ivf": str(ivf),
        "parse_seconds": round(parse_seconds, 3),
        "extract_seconds": round(time.time() - started - parse_seconds, 3),
        "width": width,
        "height": height,
        "fps_n": fps_n,
        "fps_d": fps_d,
        "expected_frames": expected_frames,
        "written_frames": frames,
        "decode": decode,
    }
    report_path = out_dir / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return 0 if decode["returncode"] == 0 and frames == expected_frames else 2


if __name__ == "__main__":
    raise SystemExit(main())
