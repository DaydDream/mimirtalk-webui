"""Pinned official font preparation and validation; no network or subsetting."""
from pathlib import Path
import hashlib
import json
import fontTools
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[2]
FONT_DIR = ROOT / "webui/frontend/assets/fonts"
OLD_HASH = "2a8a798d64d8c67e6ab3d027a7aa233dac973205297e537760b2975ecb02e3f7"
SPECS = [
    dict(family="Noto Sans SC", folder="notosanssc", alias="MomoTalk Sans", role="正文与界面",
         commit="a85815a42757630ce188fdad368c2dfc444d4773", original="NotoSansSC[wght].ttf",
         output="noto-sans-sc-variable.ttf", weight=[100,900], license="NotoSansSC-OFL.txt",
         original_sha256="a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da"),
    dict(family="Noto Serif SC", folder="notoserifsc", alias="MomoTalk Serif", role="说话人名字",
         commit="8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5", original="NotoSerifSC[wght].ttf",
         output="noto-serif-sc-bold.ttf", weight=700, license="NotoSerifSC-OFL.txt",
         original_sha256="050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9"),
]

def sha(path):
    with Path(path).open("rb") as f:
        return hashlib.file_digest(f,"sha256").hexdigest()

def source_dir(spec):
    return ROOT/"docs/font-sources/google-fonts"/spec["commit"]/spec["folder"]

def names(font):
    return {str(i):list(dict.fromkeys(n.toUnicode() for n in font["name"].names if n.nameID==i))
            for i in (0,1,2,4,5,6,13,14,16,17)}

def build():
    import shutil
    FONT_DIR.mkdir(parents=True,exist_ok=True)
    entries=[]
    for s in SPECS:
        source=source_dir(s)/s["original"]
        license=source_dir(s)/"OFL.txt"
        assert sha(source)==s["original_sha256"],"Pinned source hash mismatch"
        assert "SIL OPEN FONT LICENSE Version 1.1" in license.read_text(encoding="utf-8")
        output=FONT_DIR/s["output"]
        if isinstance(s["weight"],list):
            shutil.copyfile(source,output)
        else:
            with TTFont(source,recalcTimestamp=False) as vf:
                static=instantiateVariableFont(vf,{"wght":s["weight"]},inplace=False,updateFontNames=True)
                static.recalcTimestamp=False
                static.save(output)
                static.close()
        shutil.copyfile(license,FONT_DIR/s["license"])
        with TTFont(source) as original, TTFont(output) as active:
            assert set(original.getBestCmap())==set(active.getBestCmap()),"Coverage unexpectedly changed"
            active_names=names(active)
            source_names=names(original)
        encoded=s["original"].replace("[","%5B").replace("]","%5D")
        base=f'https://raw.githubusercontent.com/google/fonts/{s["commit"]}/ofl/{s["folder"]}/'
        entries.append(dict(
            font_name=s["family"],role=s["role"],css_alias=s["alias"],
            output=output.relative_to(ROOT).as_posix(),bytes=output.stat().st_size,sha256=sha(output),
            variable=isinstance(s["weight"],list),weight=s["weight"],subset=False,names=active_names,
            processing=("unchanged complete official variable font" if isinstance(s["weight"],list)
                        else "full static wght=700; updateFontNames=True; recalcTimestamp=False; no subset"),
            source=dict(repository="https://github.com/google/fonts",commit=s["commit"],
                        path=source.relative_to(ROOT).as_posix(),url=base+encoded,
                        file=s["original"],bytes=source.stat().st_size,sha256=sha(source),names=source_names),
            license=dict(name="SIL Open Font License 1.1",file=s["license"],url=base+"OFL.txt",
                         sha256=sha(license),reserved_names=["Source"] if s["folder"]=="notosanssc" else [],
                         modified_family_uses_reserved_name=False),
            generator="webui/tools/build_fonts.py",fonttools_version=fontTools.__version__))
        print(f'[fonts] {s["family"]}: {output.stat().st_size} bytes {sha(output)}',flush=True)
    (FONT_DIR/"manifest.json").write_text(json.dumps(entries,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

def gb2312():
    result=set()
    for high in range(0xA1,0xF8):
        for low in range(0xA1,0xFF):
            try: result.add(ord(bytes((high,low)).decode("gb2312")))
            except UnicodeDecodeError: pass
    return result

def check(folder=FONT_DIR):
    manifest=json.loads((folder/"manifest.json").read_text(encoding="utf-8"))
    contacts=json.loads((ROOT/"webui/data/chat_contacts.json").read_text(encoding="utf-8"))
    text="简体中文繁體中文標點，。！？「」0123456789ABCabc龘𠮷"+"".join(c.get("name","") for c in contacts["contacts"])
    required=gb2312()|set(map(ord,"".join(c.get("name","") for c in contacts["contacts"])))
    for s in SPECS:
        entry=next(e for e in manifest if e["font_name"]==s["family"])
        fontpath=folder/s["output"]
        assert sha(fontpath)==entry["sha256"],f"Runtime hash mismatch: {fontpath}"
        assert sha(source_dir(s)/s["original"])==s["original_sha256"]
        assert entry["source"]["sha256"]==s["original_sha256"]
        assert sha(folder/s["license"])==entry["license"]["sha256"]
        with TTFont(fontpath) as active, TTFont(source_dir(s)/s["original"]) as original:
            family=" ".join(n.toUnicode() for n in active["name"].names if n.nameID in (1,4,16))
            assert s["family"] in family,f"Wrong identity: {fontpath}"
            cmap=set(active.getBestCmap())
            missing=required-cmap
            assert not missing,f'{fontpath.name}: missing '+",".join(f"U+{cp:04X}" for cp in sorted(missing))
            assert cmap==set(original.getBestCmap()),"Full source coverage must be preserved"
            if isinstance(s["weight"],list):
                axes={a.axisTag:[a.minValue,a.maxValue] for a in active["fvar"].axes}
                assert axes["wght"]==s["weight"]
                assert sha(fontpath)==s["original_sha256"]
            else:
                assert "fvar" not in active and active["OS/2"].usWeightClass==s["weight"]
            print(f"[fonts] OK {fontpath.name}: {len(cmap)} Unicode mappings; GB2312 and built-in names covered")
            sample_missing=sorted(set(map(ord,text))-cmap)
            print("[fonts] supplementary sample missing (system fallback required): "+(",".join(f"U+{cp:04X}" for cp in sample_missing) or "none"))
    for p in folder.rglob("*.ttf"):
        assert sha(p)!=OLD_HASH,f"Old HarmonyOS font: {p}"
    assert not (folder/"source-han-sans.ttf").exists()
    assert not (folder/"noto-serif-sc-vf.ttf").exists()
