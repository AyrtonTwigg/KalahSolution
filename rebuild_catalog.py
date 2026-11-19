"""Build the website's directory from the solution packs in this folder only."""
import hashlib
import json
import os
from pathlib import Path
import struct

ROOT=Path(__file__).resolve().parent
RULES="kalah6-capture-opposite-nonempty-perspective-future-score-v1"


def build(root=ROOT):
    data=Path(root)/"Website Solutions"
    entries=[]
    files={}
    for folder in sorted((p for p in data.iterdir() if p.is_dir()),key=lambda p:("Stone" not in p.name,"Optimal" not in p.name,p.name)):
        if folder.name == "Distance":
            continue  # The distance exporter maintains its own catalog and format.
        source=folder/"catalog.json"
        if source.exists():
            manifest=json.loads(source.read_text(encoding="utf8"))
            if manifest.get("discovery_complete") is False:
                print(f"Note: {folder.name} contains a partial collection.")
            selected={entry["file"]:entry.get("sha256") for entry in manifest["layers"]}
        else:
            selected={p.relative_to(folder).as_posix():None for p in sorted(folder.rglob("*.mini"))}
        for relative,expected in selected.items():
            path=(folder/relative).resolve()
            if not path.is_relative_to(folder.resolve()):
                raise ValueError(f"Solution path escapes its collection: {relative}")
            with path.open("rb") as stream:
                prefix=stream.read(12)
                magic,length=struct.unpack("<8sI",prefix)
                if magic!=b"MANCMM01" or length>1024*1024:
                    raise ValueError(f"Invalid pack header: {path}")
                metadata=json.loads(stream.read(length))
            if (metadata["version"],metadata["rules"],metadata["ranking"])!=(1,RULES,"colex-bars-v1"):
                raise ValueError(f"Incompatible solution pack: {path}")
            digest=hashlib.sha256(path.read_bytes()).hexdigest()
            if expected and expected!=digest:
                raise ValueError(f"Catalog checksum mismatch: {path}")
            relative_path=path.relative_to(data.resolve()).as_posix()
            size=path.stat().st_size
            files[relative_path]=size
            for layer in metadata["layers"]:
                entry=dict(stone=layer["stone"],file=relative_path,bytes=size,positions=layer["positions"],
                           coverage=layer["coverage"],collection=folder.name,sha256=digest)
                for key in ("rank_min","rank_max"):
                    if key in layer:
                        entry[key]=layer[key]
                entries.append(entry)
    if not entries:
        raise ValueError("No .mini solution packs found under Website Solutions")
    result=dict(format="kalah-website-catalog",version=1,rules=RULES,ranking="colex-bars-v1",layers=entries)
    temporary=data/"catalog.json.tmp"
    with temporary.open("w",encoding="utf8") as stream:
        json.dump(result,stream,indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary,data/"catalog.json")
    print(f"Catalog ready: {len(files)} files; {sum(files.values())/1048576:.2f} MiB. Overlapping positions are not counted as a unique union.")
    return result


if __name__=="__main__":
    build()
