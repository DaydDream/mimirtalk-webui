"""Minimal CPK / @UTF reader for this project.

Adapted from the public PyCriCodecsEx sources. Only read/list/extract paths are
kept so we can inspect CRI CPK archives without adding a package dependency.
"""

from __future__ import annotations

from io import BytesIO, FileIO
from os.path import join
from struct import unpack, calcsize
from typing import BinaryIO, Generator


UTFChunkHeader = ">4sIIIIIHHI"
CPKChunkHeader = "<4sIII"


class UTFTypeValues:
    uchar = 0
    char = 1
    ushort = 2
    short = 3
    uint = 4
    int = 5
    ullong = 6
    llong = 7
    float = 8
    double = 9
    string = 10
    bytes = 11


def _stringtypes(typeflag: int) -> str:
    types = "BbHhIiQqfdI"
    if typeflag == 0xB:
        return "II"
    return types[typeflag]


class UTF:
    """Unpack an @UTF table payload."""

    def __init__(self, stream: BinaryIO | bytes, recursive: bool = False):
        if isinstance(stream, (bytes, bytearray, memoryview)):
            self.stream = BytesIO(bytes(stream))
        else:
            self.stream = stream
        self.recursive = recursive
        self._read_header_and_rows()

    def _read_header_and_rows(self) -> None:
        (
            self.magic,
            self.table_size,
            self.rows_offset,
            self.string_offset,
            self.data_offset,
            self.table_name,
            self.num_columns,
            self.row_length,
            self.num_rows,
        ) = unpack(UTFChunkHeader, self.stream.read(calcsize(UTFChunkHeader)))
        if self.magic == b"@UTF":
            self._read_rows_and_columns()
        elif self.magic == b"\x1F\x9E\xF3\xF5":
            self.stream.seek(0)
            data = memoryview(bytearray(self.stream.read()))
            m = 0x655F
            t = 0x4115
            for i in range(len(data)):
                data[i] ^= 0xFF & m
                m = (m * t) & 0xFFFFFFFF
            self.stream = BytesIO(bytearray(data))
            (
                self.magic,
                self.table_size,
                self.rows_offset,
                self.string_offset,
                self.data_offset,
                self.table_name,
                self.num_columns,
                self.row_length,
                self.num_rows,
            ) = unpack(UTFChunkHeader, self.stream.read(calcsize(UTFChunkHeader)))
            if self.magic != b"@UTF":
                raise ValueError("Decryption error.")
            self._read_rows_and_columns()
        else:
            raise ValueError("UTF chunk is not present.")

    def _read_rows_and_columns(self) -> None:
        stream = BytesIO(self.stream.read(self.data_offset - 0x18))
        types = [[], [], [], []]
        target_data = []
        target_constant = []
        target_tuple = []
        s_offsets = []

        for _ in range(self.num_columns):
            flag = stream.read(1)[0]
            stflag = flag >> 4
            typeflag = flag & 0xF
            if stflag == 0x1:
                offset = int.from_bytes(stream.read(4), "big")
                s_offsets.append(offset)
                target_constant.append(offset)
                types[2].append((_stringtypes(typeflag), typeflag))
            elif stflag == 0x3:
                offset = int.from_bytes(stream.read(4), "big")
                s_offsets.append(offset)
                target_tuple.append(
                    (
                        offset,
                        unpack(
                            ">" + _stringtypes(typeflag),
                            stream.read(calcsize(_stringtypes(typeflag))),
                        ),
                    )
                )
                types[1].append((_stringtypes(typeflag), typeflag))
            elif stflag == 0x5:
                offset = int.from_bytes(stream.read(4), "big")
                s_offsets.append(offset)
                target_data.append(offset)
                types[0].append((_stringtypes(typeflag), typeflag))
            elif stflag == 0x7:
                raise NotImplementedError("Unsupported 0x70 storage flag.")
            else:
                raise Exception("Unknown storage flag.")

        rows = []
        for _ in range(self.num_rows):
            for i in types[0]:
                rows.append(unpack(i[0], stream.read(calcsize(i[0]))))

        for i in range(4):
            for j in range(len(types[i])):
                types[i][j] = (types[i][j][0][1:], types[i][j][1])

        strings = (stream.read()).split(b"\x00")
        strings_copy = strings[:]
        self.encoding = "utf-8"
        for i in range(len(strings)):
            try:
                strings_copy[i] = strings[i].decode("utf-8")
            except UnicodeDecodeError:
                for enc in ("shift-jis", "utf-16"):
                    try:
                        strings_copy[i] = strings[i].decode(enc)
                        self.encoding = enc
                        break
                    except UnicodeDecodeError:
                        continue
                else:
                    raise UnicodeDecodeError(
                        f"String of unknown encoding: {strings[i]!r}"
                    )

        self.table_name = strings_copy[self._finder(self.table_name, strings)]
        value_types = list(range(0, 12))
        s_orders = [strings_copy[self._finder(i, strings)] for i in s_offsets]

        def ensure_order(d: dict) -> dict:
            return {k: d[k] for k in s_orders if k in d}

        t_t_dict: dict = {}
        for i in range(len(target_constant)):
            if types[2][i][1] not in (0xA, 0xB):
                val = self._finder(target_constant[i], strings)
                t_t_dict.update({strings_copy[val]: (value_types[types[2][i][1]], None)})
            elif types[2][i][1] == 0xA:
                val = self._finder(target_constant[i], strings)
                t_t_dict.update({strings_copy[val]: (UTFTypeValues.string, "<NULL>")})
            else:
                val = self._finder(target_constant[i], strings)
                t_t_dict.update({strings_copy[val]: (UTFTypeValues.bytes, b"")})

        for i in range(len(target_tuple)):
            col = types[1][i % len(types[1])][1]
            if col not in (0xA, 0xB):
                t_t_dict.update(
                    {
                        strings_copy[self._finder(target_tuple[i][0], strings)]: (
                            value_types[col],
                            target_tuple[i][1][0],
                        )
                    }
                )
            elif col == 0xA:
                t_t_dict.update(
                    {
                        strings_copy[self._finder(target_tuple[i][0], strings)]: (
                            UTFTypeValues.string,
                            strings_copy[
                                self._finder(target_tuple[i][1][0], strings)
                            ],
                        )
                    }
                )
            else:
                self.stream.seek(self.data_offset + target_tuple[i][1][0] + 0x8, 0)
                bin_val = self.stream.read(target_tuple[i][1][1])
                t_t_dict.update(
                    {
                        strings_copy[self._finder(target_tuple[i][0], strings)]: (
                            UTFTypeValues.bytes,
                            bin_val,
                        )
                    }
                )

        temp_dict = {}
        self._dictarray = []
        if len(rows) == 0:
            self._dictarray.append(ensure_order(t_t_dict))
        for i in range(len(rows)):
            col_type = types[0][i % len(types[0])][1]
            col_name = strings_copy[
                self._finder(target_data[i % len(target_data)], strings)
            ]
            if col_type not in (0xA, 0xB):
                temp_dict.update({col_name: (value_types[col_type], rows[i][0])})
            elif col_type == 0xA:
                temp_dict.update(
                    {
                        col_name: (
                            UTFTypeValues.string,
                            strings_copy[self._finder(rows[i][0], strings)],
                        )
                    }
                )
            else:
                self.stream.seek(self.data_offset + rows[i][0] + 0x8, 0)
                bin_val = self.stream.read(rows[i][1])
                temp_dict.update({col_name: (UTFTypeValues.bytes, bin_val)})
            if not (i + 1) % len(types[0]):
                temp_dict.update(t_t_dict)
                self._dictarray.append(ensure_order(temp_dict))
                temp_dict = {}

    @staticmethod
    def _finder(pointer: int, strings: list[bytes]) -> int:
        total = 0
        for i in range(len(strings)):
            if total < pointer:
                total += len(strings[i]) + 1
                continue
            return i
        raise Exception("Failed string lookup.")

    @property
    def table(self) -> dict:
        keys = self._dictarray[0].keys()
        return {key: [d[key][1] for d in self._dictarray] for key in keys}

    @property
    def dictarray(self) -> list[dict]:
        return self._dictarray


def read_utf_after_chunk_header(chunk_stream: BinaryIO, magic_size: int) -> UTF:
    """Read a UTF table following a 16-byte CPK chunk header."""
    chunk_stream.seek(magic_size)
    return UTF(chunk_stream.read(0x800 - magic_size))


class PackedFile:
    """Minimal stand-in for CPK entries."""

    def __init__(
        self,
        stream: BinaryIO,
        path: str,
        offset: int,
        size: int,
        compressed: bool = False,
    ):
        self.stream = stream
        self.path = path
        self.offset = offset
        self.size = size
        self.compressed = compressed

    def get_bytes(self) -> bytes:
        self.stream.seek(self.offset)
        data = self.stream.read(self.size)
        return data


class _TOC:
    def __init__(self, stream: bytes):
        self.stream = BytesIO(stream)
        self.magic, self.encflag, self.packet_size, self.unk0c = unpack(
            CPKChunkHeader, self.stream.read(16)
        )
        if self.magic not in (b"TOC ", b"ITOC", b"GTOC", b"HTOC", b"HGTOC", b"ETOC"):
            raise ValueError(f"{self.magic} header not supported.")
        self.table = UTF(self.stream.read()).table


class CPK:
    def __init__(self, filename: str | BinaryIO):
        if isinstance(filename, str):
            self.filename = filename
            self.stream = FileIO(filename)
        else:
            self.stream = filename
            self.filename = ""
        self.magic, self.encflag, self.packet_size, self.unk0c = unpack(
            CPKChunkHeader, self.stream.read(16)
        )
        if self.magic != b"CPK ":
            raise ValueError("Invalid CPK file.")
        self.tables = {"CPK": read_utf_after_chunk_header(self.stream, 16).table}
        self._load_tocs()

    def _load_tocs(self) -> None:
        """加载并返回目标配置。"""
        for key, value in self.tables["CPK"].items():
            if key == "TocOffset":
                if value[0]:
                    self.stream.seek(value[0], 0)
                    self.tables["TOC"] = _TOC(
                        self.stream.read(self.tables["CPK"]["TocSize"][0])
                    ).table
            elif key == "ItocOffset":
                if value[0]:
                    self.stream.seek(value[0], 0)
                    self.tables["ITOC"] = _TOC(
                        self.stream.read(self.tables["CPK"]["ItocSize"][0])
                    ).table
            elif key == "HtocOffset":
                if value[0]:
                    self.stream.seek(value[0], 0)
                    self.tables["HTOC"] = _TOC(
                        self.stream.read(self.tables["CPK"]["HtocSize"][0])
                    ).table
            elif key == "GtocOffset":
                if value[0]:
                    self.stream.seek(value[0], 0)
                    self.tables["GTOC"] = _TOC(
                        self.stream.read(self.tables["CPK"]["GtocSize"][0])
                    ).table

    @property
    def files(self) -> Generator[PackedFile, None, None]:
        if "TOC" not in self.tables:
            return
        toctable = self.tables["TOC"]
        rel_off = 0x800
        dirnames = toctable.get("DirName", ["."] * len(toctable.get("FileName", [])))
        for i in range(len(toctable["FileName"])):
            dirname = dirnames[i % len(dirnames)]
            filename = toctable["FileName"][i]
            if len(filename) >= 255:
                filename = filename[:250] + "_" + str(i)
            compressed = toctable["ExtractSize"][i] > toctable["FileSize"][i]
            self.stream.seek(rel_off + toctable["FileOffset"][i], 0)
            yield PackedFile(
                self.stream,
                join(dirname, filename),
                self.stream.tell(),
                toctable["FileSize"][i],
                compressed,
            )


def list_files(path: str) -> None:
    cpk = CPK(path)
    for f in cpk.files:
        print(f"{f.size}\t{f.compressed}\t{f.path}")


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("usage: python cpk_utf.py <archive.cpk>", file=sys.stderr)
        raise SystemExit(1)
    list_files(sys.argv[1])
