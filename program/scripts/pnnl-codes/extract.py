# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Enthalix LLC
# Extract the residential code values from the DOE/PNNL Residential Prototype Building Models
# (energycodes.gov) — single-family, heat pump files; one row per edition x climate zone.
# Usage: python3 -I extract.py <zips dir> <out dir>
import html, io, json, re, sys, zipfile, os

ZIPS, OUT = sys.argv[1], sys.argv[2]
EDITIONS = ["2006", "2009", "2012", "2015", "2018", "2021", "2024"]
SRC = "https://www.energycodes.gov/prototype-building-models"

def table(t, name):
    i = t.find("<b>" + name + "</b>")
    if i < 0: return []
    j = t.find("</table>", i)
    rows = re.findall(r"<tr>(.*?)</tr>", t[i:j], re.S)
    return [[html.unescape(re.sub("<.*?>", "", c)).strip() for c in re.findall(r"<t[dh].*?>(.*?)</t[dh]>", r, re.S)] for r in rows]

def u_of(t, cons, surf_pred=lambda s: True):
    """U-factor with film (Btu/h-ft2-F) of the first surface of construction `cons` in the opaque tables; all such surfaces must agree"""
    vals = set()
    for name in ("Opaque Exterior", "Opaque Interior"):
        for r in table(t, name)[1:]:
            if len(r) > 3 and r[1] == cons and surf_pred(r[0]) and r[3]:
                vals.add(r[3])
    return vals

def block(idf):
    m = re.search(r"^! Code requirements: (\S+)\s*\n(.*?)^! GPARM parameters as run", idf, re.S | re.M)
    kv = dict(re.findall(r"^!\s+(\w+) = (.*?)\s*$", m.group(2), re.M))
    ach = re.search(r"^!\s+ach50 = (\S+)", idf, re.M).group(1)
    def sp(name):
        mm = re.search(r"^\s*" + name + r",.*?Until: 24:00,[^\n]*\n\s*([0-9.]+)\s*;", idf, re.S | re.M)
        return float(mm.group(1))
    return m.group(1), kv, float(ach), sp("heating_sch"), sp("cooling_sch")

rows, problems = [], []
for zf in sorted(os.listdir(ZIPS)):
    if not zf.endswith(".zip"): continue
    zone = zf[2:-4]  # CZ4A.zip -> 4A
    z = zipfile.ZipFile(os.path.join(ZIPS, zf))
    names = set(z.namelist())
    for ed in EDITIONS:
        def f(fndn, ext):
            # the zone's own file; where every file of the zone is warm-humid (1A, 2A), the warm-humid one — never the tropical variants
            hit = []
            for tok in (zone, zone + "WH"):
                n = f"US+SF+CZ{tok}+hp+{fndn}+IECC_{ed}.{ext}"
                if n in names: hit = [n]; break
            if len(hit) != 1: raise KeyError(f"{zone} {fndn} {ed} {ext}: {hit}")
            used.add(hit[0].rsplit(".", 2)[0] if ext == "table.htm" else hit[0].rsplit(".", 1)[0])
            return z.read(hit[0]).decode("latin-1")
        used = set()
        try:
            slab_idf, slab_t = f("slab", "idf"), f("slab", "table.htm")
            crawl_t, bsmt_t = f("crawlspace", "table.htm"), f("heatedbsmt", "table.htm")
        except KeyError as e:
            problems.append(f"{zone} {ed}: missing {e}"); continue
        code, kv, ach, hC, cC = block(slab_idf)
        wall = u_of(slab_t, "EXTERIOR WALL", lambda s: "UNIT" in s)
        ceil = u_of(slab_t, "ATTIC FLOOR")
        floor = u_of(crawl_t, "EXTERIOR FLOOR", lambda s: not s.startswith("iz-"))
        bsmt = u_of(bsmt_t, "BASEMENT WALL", lambda s: "UPPER" in s)
        for nm, v in (("wall", wall), ("ceiling", ceil), ("floor", floor), ("basement", bsmt)):
            if len(v) != 1: problems.append(f"{zone} {ed}: {nm} U {sorted(v)}")
        g = lambda v: float(next(iter(v))) if len(v) == 1 else None
        shgc = kv.get("shgc_window", "")
        rows.append({
            "zone": zone, "edition": ed, "code": code,
            "frameWallU": g(wall), "ceilingU": g(ceil), "floorU": g(floor), "basementWallU": g(bsmt),
            "fenestrationU": float(kv["u_window"]), "skylightU": float(kv["u_skylight"]),
            "fenestrationSHGC": (float(shgc) if re.match(r"^[0-9.]+$", shgc) else None), "shgc_raw": shgc,
            "slabR": float(kv["r_slab"]), "slabDepthFt": float(kv["r_slab_depth"]), "ach50": ach,
            "heatingSetpointF": round(hC * 9 / 5 + 32, 2), "coolingSetpointF": round(cC * 9 / 5 + 32, 2),
            "r": {k: kv[k] for k in ("r_wall", "r_sheathing", "r_ceiling", "r_floor", "r_bsmtwall", "r_crawlwall", "r_masswall")},
            "files": sorted(used),
        })
os.makedirs(OUT, exist_ok=True)
json.dump({"rows": rows, "problems": problems}, open(os.path.join(OUT, "pnnl.json"), "w"), indent=1)
print(len(rows), "rows;", len(problems), "problems"); print("\n".join(problems[:30]))
