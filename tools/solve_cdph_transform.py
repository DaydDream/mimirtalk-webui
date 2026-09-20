"""solve_cdph_transform：项目辅助脚本，封装对应的数据处理、提取或验证流程。"""
from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path


STOP_AFTER_WRITE = 0x1806E3392
STOP_LOOP = 0x1806E3396
TABLE_VA = 0x1806E33B8
TABLE_COUNT = 256


def parse_pe(data: bytes) -> dict:
    """解析pe相关数据。"""
    pe_offset = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe_offset : pe_offset + 4] != b"PE\0\0":
        raise ValueError("not a PE file")
    coff = pe_offset + 4
    _, section_count, _, _, _, optional_size, _ = struct.unpack_from("<HHIIIHH", data, coff)
    optional = coff + 20
    image_base = struct.unpack_from("<Q", data, optional + 24)[0]
    sections_start = optional + optional_size
    sections = []
    for index in range(section_count):
        offset = sections_start + index * 40
        name = data[offset : offset + 8].rstrip(b"\0").decode("latin1")
        virtual_size, virtual_address, raw_size, raw_pointer, _ = struct.unpack_from(
            "<IIIII", data, offset + 8
        )
        sections.append(
            {
                "name": name,
                "virtual_address": virtual_address,
                "virtual_size": virtual_size,
                "raw_pointer": raw_pointer,
                "raw_size": raw_size,
            }
        )
    return {"image_base": image_base, "sections": sections}


def va_to_offset(image: dict, va: int) -> int:
    rva = va - image["image_base"]
    for section in image["sections"]:
        start = section["virtual_address"]
        size = max(section["virtual_size"], section["raw_size"])
        if start <= rva < start + size:
            offset = rva - start
            if offset >= section["raw_size"]:
                break
            return section["raw_pointer"] + offset
    raise ValueError(f"VA not mapped: 0x{va:X}")


def read_table(data: bytes, image: dict, table_va: int, count: int) -> list[int]:
    offset = va_to_offset(image, table_va)
    return [
        image["image_base"] + struct.unpack_from("<I", data, offset + index * 4)[0]
        for index in range(count)
    ]


class TransformEmulator:
    INPUT_BASE = 0x10000000
    STATE_BASE = 0x20000000

    def __init__(self, data: bytes, image: dict, input_bytes: bytes, state: bytes):
        self.data = data
        self.image = image
        self.input = bytes(input_bytes)
        self.state = bytearray(state)
        self.regs = {
            "rax": 0,
            "rbx": 0,
            "rcx": 0,
            "rdx": 0,
            "rsi": 0,
            "rdi": 0,
            "rbp": 0,
            "r8": self.INPUT_BASE,
            "r9": 0,
            "r10": 0x10,
            "r11": self.STATE_BASE,
            "r12": 0,
            "r13": 0,
            "r14": 0,
            "r15": 0,
        }
        self.instruction_count = 0

    def read_code(self, va: int, size: int) -> bytes:
        offset = va_to_offset(self.image, va)
        code = self.data[offset : offset + size]
        if len(code) != size:
            raise ValueError(f"short code read at 0x{va:X}")
        return code

    def reg32(self, name: str) -> int:
        return self.regs[name] & 0xFFFFFFFF

    def set_reg32(self, name: str, value: int) -> None:
        self.regs[name] = value & 0xFFFFFFFF

    def set_reg8(self, name: str, value: int) -> None:
        self.regs[name] = (self.regs[name] & ~0xFF) | (value & 0xFF)

    def read_memory_byte(self, address: int) -> int:
        if self.INPUT_BASE <= address < self.INPUT_BASE + len(self.input):
            return self.input[address - self.INPUT_BASE]
        if self.STATE_BASE <= address < self.STATE_BASE + len(self.state):
            return self.state[address - self.STATE_BASE]
        raise ValueError(f"unmapped memory read: 0x{address:X}")

    def write_memory_byte(self, address: int, value: int) -> None:
        if self.STATE_BASE <= address < self.STATE_BASE + len(self.state):
            self.state[address - self.STATE_BASE] = value & 0xFF
            return
        raise ValueError(f"unmapped memory write: 0x{address:X}")

    def memory_address(self, base_register: str, index_register: str | None = None, disp: int = 0) -> int:
        address = self.regs[base_register]
        if index_register:
            address += self.regs[index_register]
        return address + disp

    def div_r10d(self) -> None:
        divisor = self.reg32("r10")
        if divisor == 0:
            raise ZeroDivisionError("division by zero")
        numerator = (self.reg32("rdx") << 32) | self.reg32("rax")
        self.set_reg32("rax", numerator // divisor)
        self.set_reg32("rdx", numerator % divisor)

    def step(self, ip: int) -> int:
        self.instruction_count += 1
        code = self.read_code(ip, 12)

        if code.startswith(b"\x33\xD2"):
            self.set_reg32("rdx", 0)
            return ip + 2

        if code[0] == 0xB8:
            self.set_reg32("rax", int.from_bytes(code[1:5], "little"))
            return ip + 5

        if code.startswith(b"\x41\xF7\xF2") or code.startswith(b"\xF7\xF2"):
            self.div_r10d()
            return ip + (3 if code.startswith(b"\x41") else 2)

        if code.startswith(b"\x41\x0F\xB6\x80"):
            self.set_reg32("rax", self.read_memory_byte(self.regs["r8"] + int.from_bytes(code[4:8], "little")))
            return ip + 8
        if code.startswith(b"\x41\x0F\xB6\x40"):
            self.set_reg32("rax", self.read_memory_byte(self.regs["r8"] + code[4]))
            return ip + 5
        if code.startswith(b"\x41\x0F\xB6\x00"):
            self.set_reg32("rax", self.read_memory_byte(self.regs["r8"]))
            return ip + 4
        if code.startswith(b"\x41\x0F\xB6\x88"):
            self.set_reg32("rcx", self.read_memory_byte(self.regs["r8"] + int.from_bytes(code[4:8], "little")))
            return ip + 8
        if code.startswith(b"\x41\x0F\xB6\x48"):
            self.set_reg32("rcx", self.read_memory_byte(self.regs["r8"] + code[4]))
            return ip + 5
        if code.startswith(b"\x41\x0F\xB6\x08"):
            self.set_reg32("rcx", self.read_memory_byte(self.regs["r8"]))
            return ip + 4

        if code.startswith(b"\x42\x32\x04\x1A"):
            value = self.reg32("rax") & 0xFF
            address = self.memory_address("r11", "rdx")
            self.set_reg8("rax", value ^ self.read_memory_byte(address))
            return ip + 4

        if code.startswith(b"\x42\x0F\xB6\x04\x1A"):
            self.set_reg32("rax", self.read_memory_byte(self.memory_address("r11", "rdx")))
            return ip + 5
        if code.startswith(b"\x42\x0F\xB6\x0C\x1A"):
            self.set_reg32("rcx", self.read_memory_byte(self.memory_address("r11", "rdx")))
            return ip + 5
        if code.startswith(b"\x46\x0F\xB6\x0C\x19"):
            self.set_reg32("r9", self.read_memory_byte(self.memory_address("r11", "rcx")))
            return ip + 5

        if code.startswith(b"\x42\x88\x04\x1A"):
            self.write_memory_byte(self.memory_address("r11", "rdx"), self.reg32("rax") & 0xFF)
            return ip + 4
        if code.startswith(b"\x42\x88\x04\x19"):
            self.write_memory_byte(self.memory_address("r11", "rcx"), self.reg32("rax") & 0xFF)
            return ip + 4
        if code.startswith(b"\x46\x88\x0C\x1A"):
            self.write_memory_byte(self.memory_address("r11", "rdx"), self.reg32("r9") & 0xFF)
            return ip + 4
        if code.startswith(b"\x42\x88\x0C\x1A"):
            self.write_memory_byte(self.memory_address("r11", "rdx"), self.reg32("rcx") & 0xFF)
            return ip + 4

        if code.startswith(b"\x42\x00\x04\x1A"):
            address = self.memory_address("r11", "rdx")
            self.write_memory_byte(address, self.read_memory_byte(address) + (self.reg32("rax") & 0xFF))
            return ip + 4
        if code.startswith(b"\x42\x28\x04\x1A"):
            address = self.memory_address("r11", "rdx")
            self.write_memory_byte(address, self.read_memory_byte(address) - (self.reg32("rax") & 0xFF))
            return ip + 4
        if code.startswith(b"\x43\x28\x0C\x19"):
            address = self.memory_address("r11", "r9")
            self.write_memory_byte(address, self.read_memory_byte(address) - (self.reg32("rcx") & 0xFF))
            return ip + 4

        if code[0] == 0x34:
            self.set_reg8("rax", (self.reg32("rax") & 0xFF) ^ code[1])
            return ip + 2
        if code[0] == 0x05:
            self.set_reg32("rax", self.reg32("rax") + int.from_bytes(code[1:5], "little"))
            return ip + 5
        if code[0] == 0x2D:
            self.set_reg32("rax", self.reg32("rax") - int.from_bytes(code[1:5], "little"))
            return ip + 5
        if code.startswith(b"\x83\xC1"):
            self.set_reg32("rcx", self.reg32("rcx") + code[2])
            return ip + 3
        if code.startswith(b"\x83\xE9"):
            self.set_reg32("rcx", self.reg32("rcx") - code[2])
            return ip + 3
        if code.startswith(b"\x83\xE1"):
            self.set_reg32("rcx", self.reg32("rcx") & code[2])
            return ip + 3
        if code.startswith(b"\xFF\xC1"):
            self.set_reg32("rcx", self.reg32("rcx") + 1)
            return ip + 2
        if code.startswith(b"\xFF\xC9"):
            self.set_reg32("rcx", self.reg32("rcx") - 1)
            return ip + 2
        if code.startswith(b"\xFE\xC9"):
            self.set_reg8("rcx", (self.reg32("rcx") & 0xFF) - 1)
            return ip + 2
        if code.startswith(b"\x8B\xCA"):
            self.set_reg32("rcx", self.reg32("rdx"))
            return ip + 2
        if code.startswith(b"\x44\x8B\xCA"):
            self.set_reg32("r9", self.reg32("rdx"))
            return ip + 3

        if code.startswith(b"\x41\x2A\x80"):
            value = self.read_memory_byte(self.regs["r8"] + int.from_bytes(code[3:7], "little"))
            self.set_reg8("rax", (self.reg32("rax") & 0xFF) - value)
            return ip + 7
        if code.startswith(b"\x41\x2A\x40"):
            value = self.read_memory_byte(self.regs["r8"] + code[3])
            self.set_reg8("rax", (self.reg32("rax") & 0xFF) - value)
            return ip + 4
        if code.startswith(b"\xD2\xC8"):
            count = self.reg32("rcx") & 0xFF
            value = self.reg32("rax") & 0xFF
            count &= 7
            rotated = ((value >> count) | (value << (8 - count))) & 0xFF if count else value
            self.set_reg8("rax", rotated)
            return ip + 2

        if code[0] == 0xE9:
            return ip + 5 + int.from_bytes(code[1:5], "little", signed=True)
        if code[0] == 0xEB:
            return ip + 2 + int.from_bytes(code[1:2], "little", signed=True)

        raise ValueError(
            f"unsupported instruction at 0x{ip:X}: {code[:12].hex(' ')} "
            f"rax=0x{self.reg32('rax'):08X} rcx=0x{self.reg32('rcx'):08X} "
            f"rdx=0x{self.reg32('rdx'):08X} r9=0x{self.reg32('r9'):08X}"
        )

    def run_branch(self, entry: int) -> int:
        ip = entry
        while True:
            if ip == STOP_AFTER_WRITE:
                self.write_memory_byte(self.memory_address("r11", "rdx"), self.reg32("rax") & 0xFF)
                return ip + 4
            if ip == STOP_LOOP:
                return ip
            try:
                ip = self.step(ip)
            except Exception as exc:
                raise RuntimeError(f"branch failed at 0x{ip:X}: {exc}") from exc

    def transform(self, table: list[int]) -> bytes:
        if len(table) != TABLE_COUNT:
            raise ValueError("unexpected branch table size")
        for index in range(TABLE_COUNT):
            selector = 0xFF - index
            self.run_branch(table[selector])
        return bytes(self.state)


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(description="Solve the HybridCLR CDPH byte transform.")
    parser.add_argument("dll", type=Path)
    parser.add_argument("cdph", type=Path)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()

    data = args.dll.read_bytes()
    image = parse_pe(data)
    table = read_table(data, image, TABLE_VA, TABLE_COUNT)
    cdph = args.cdph.read_bytes()

    if cdph[:4] != b"CDPH":
        raise ValueError("input is not a CDPH blob")
    initial_input = cdph[0x10:0x110]
    if len(initial_input) != 0x100:
        raise ValueError("CDPH header input is truncated")

    descriptor = 0x110
    for _ in range(8):
        length = struct.unpack_from("<I", cdph, descriptor)[0]
        descriptor = (descriptor + 4 + length + 3) & ~3
    initial_state = cdph[descriptor : descriptor + 0x10]
    if len(initial_state) != 0x10:
        raise ValueError("CDPH validation state is truncated")

    emulator = TransformEmulator(data, image, initial_input, initial_state)
    final_state = emulator.transform(table)
    result = {
        "dll": str(args.dll.resolve()),
        "cdph": str(args.cdph.resolve()),
        "state_offset": f"0x{descriptor:X}",
        "initial_state_hex": initial_state.hex(),
        "final_state_hex": final_state.hex(),
        "final_state_ascii": final_state.decode("ascii", errors="replace"),
        "expected_ascii": "Hello, HybridCLR",
        "matched": final_state == b"Hello, HybridCLR",
        "instruction_count": emulator.instruction_count,
    }
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(text, encoding="utf-8")
    print(text)
    return 0 if result["matched"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
