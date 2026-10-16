# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Enthalix LLC
# pnnl.json -> pnnl-editions.csv + pnnl-values.csv (the energy-code CSV format Enthalix reads)
# Usage: python3 -I gen.py <pnnl.json> <out dir>
import csv, io, json, sys, os

d = json.load(open(sys.argv[1])); OUT = sys.argv[2]
URL = "https://www.energycodes.gov/prototype-building-models"
READ_ON = "2026-10-16"
EDS = ["2006", "2009", "2012", "2015", "2018", "2021", "2024"]
UNIT = {"u": "Btu/h·ft²·°F", "r": "h·ft²·°F/Btu", "ft": "ft", "-": "-", "ach": "ACH50", "f": "°F"}
# factor -> (unit kind, where the value is read in the prototype)
F = [
    ("ceilingU", "u", "slab", "results table, Opaque Interior: ATTIC FLOOR, U-factor with film"),
    ("frameWallU", "u", "slab", "results table, Opaque Exterior: EXTERIOR WALL, U-factor with film"),
    ("basementWallU", "u", "heatedbsmt", "results table, Opaque Exterior: BASEMENT WALL (above-grade part), U-factor with film"),
    ("floorU", "u", "crawlspace", "results table, Opaque Interior: EXTERIOR FLOOR (over the vented crawl space), U-factor with film"),
    ("fenestrationU", "u", "slab", "Code requirements: u_window"),
    ("skylightU", "u", "slab", "Code requirements: u_skylight"),
    ("fenestrationSHGC", "-", "slab", "Code requirements: shgc_window"),
    ("slabR", "r", "slab", "Code requirements: r_slab"),
    ("slabDepthFt", "ft", "slab", "Code requirements: r_slab_depth"),
    ("ach50", "ach", "slab", "parameters: ach50"),
]
ALL = [("heatingSetpointF", "f", "slab", "heating_sch (Schedule:Compact)"), ("coolingSetpointF", "f", "slab", "cooling_sch (Schedule:Compact)")]

def fileof(r, kind):
    return next(f for f in r["files"] if f"+hp+{kind}+" in f)

def note(r, fac):
    rv = r["r"]
    if fac == "frameWallU": return f"the prototype's wall built to R-{rv['r_wall']}" + (f" + R-{rv['r_sheathing']} sheathing" if rv["r_sheathing"] not in ("0", "") else "")
    if fac == "ceilingU": return f"the prototype's ceiling built to R-{rv['r_ceiling']}"
    if fac == "floorU": return f"the prototype's floor built to R-{rv['r_floor']}"
    if fac == "basementWallU": return f"the prototype's basement wall built to R-{rv['r_bsmtwall']}"
    if fac == "fenestrationSHGC" and r["fenestrationSHGC"] is None: return f"the prototype states \"{r['shgc_raw']}\" — no requirement"
    return ""

def num(v):
    return "" if v is None else str(float(v)).rstrip("0").rstrip(".") if isinstance(v, float) else str(v)

rows = {(r["zone"], r["edition"]): r for r in d["rows"]}
vals = []
for ed in EDS:
    eid = f"PNNL-IECC-{ed}"
    zones = sorted(z for (z, e) in rows if e == ed)
    # the zone number's row: its A file (or the only one: 7, 8); a sub-zone's row only where a value differs from it
    base = {}
    for z in zones:
        if z in (z[0], z[0] + "A"): base[z[0]] = z
    for z in zones: base.setdefault(z[0], z)
    def factors(r):
        return [(fac, kind, fnd, where, r[fac]) for fac, kind, fnd, where in F]
    for n, z in sorted(base.items()):
        r = rows[(z, ed)]
        for fac, kind, fnd, where, v in factors(r):
            vals.append([eid, n, fac, num(v), UNIT[kind], f"PNNL prototype {fileof(r, fnd)}: {where}", note(r, fac), URL])
    for z in zones:
        if z in base.values(): continue
        r, b = rows[(z, ed)], rows[(base[z[0]], ed)]
        if all(r[fac] == b[fac] for fac, *_ in F): continue
        for fac, kind, fnd, where, v in factors(r):
            vals.append([eid, z, fac, num(v), UNIT[kind], f"PNNL prototype {fileof(r, fnd)}: {where}", note(r, fac), URL])
    # the thermostat: one for the edition — every prototype's must agree
    for fac, kind, fnd, where in ALL:
        vs = {rows[(z, ed)][fac] for z in zones}
        assert len(vs) == 1, (ed, fac, vs)
        r = rows[(base["4"], ed)]
        vals.append([eid, "all", fac, num(vs.pop()), UNIT[kind], f"PNNL prototype {fileof(r, fnd)}: {where} (the same in every climate zone's prototype)", "", URL])

os.makedirs(OUT, exist_ok=True)
def write(name, header, data):
    b = io.StringIO(); w = csv.writer(b, lineterminator="\n"); w.writerow(header); w.writerows(data)
    open(os.path.join(OUT, name), "w", encoding="utf-8").write(b.getvalue())
write("pnnl-editions.csv", ["id", "label", "base", "publisher", "irc_equivalent", "source_url", "read_on", "read_from"],
      [[f"PNNL-IECC-{e}", f"{e} IECC — DOE/PNNL prototype values", f"IECC-{e}", "U.S. Department of Energy / Pacific Northwest National Laboratory", "", URL, READ_ON,
        "the Residential Prototype Building Models (EnergyPlus 23.1): single-family, heat pump; slab, crawl space and heated basement variants, their IDF files and results tables"] for e in EDS])
write("pnnl-values.csv", ["edition", "zone", "factor", "value", "unit", "cite", "note", "source_url"], vals)
print(len(vals), "values")
