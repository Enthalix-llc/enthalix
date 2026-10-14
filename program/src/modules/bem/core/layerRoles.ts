// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE LAYER ROLES (user, 2026-09-16: "the layer editor should be listing generic parts and be aware of the assembly and
// layer position (for example, a roof assembly and outside layer, which means the materials would be Membrane, Asphalt (as
// in shingles), Slate, Tile or Metal) … classify the assemblies and their layers so that the dropdown exposes a culled
// material list in the table below"). Ten roles shared by every section; each SECTION orders them outside → inside in its
// own words. A materials.db row's roles are READ from its name (a regex table — a row keeps every hit; a name that says
// nothing falls back to its kind); a layer's role is read from the FILE's word first, else from its position (the outside,
// the inside; the middle stays open). Nothing is stored: the classifier runs over the rows in memory, and the user's choice
// rides on the LayerPick as `role`. Measured before it was written: 1,355 of 1,377 rows classify by name; the rest by kind or
// not at all (paperboard, waferboard, species boards, the catalogue's compliance stand-ins) — every one under "show all".
import type { MaterialKind } from "./materialsDb.js";

export type LayerRole = "roofing" | "cladding" | "finish-floor" | "barrier" | "sheathing" | "structure" | "insulation" | "air" | "interior-finish" | "ground";
export type LayerSection = "roof" | "wall" | "floor" | "ceiling";
export const ROLE_LABELS: Record<LayerRole, string> = {
  roofing: "Roofing", cladding: "Cladding / siding", "finish-floor": "Finish floor", barrier: "Barrier / underlayment", sheathing: "Sheathing / deck",
  structure: "Structure / framing", insulation: "Insulation", air: "Air gap", "interior-finish": "Interior finish", ground: "Ground contact",
};
/** the roles a section's layers take, OUTSIDE first (the top of a floor, the attic side of a ceiling), in the section's own words */
export const ROLES_BY_SECTION: Record<LayerSection, Array<{ role: LayerRole; label: string }>> = {
  roof: [{ role: "roofing", label: "Roofing" }, { role: "barrier", label: "Underlayment" }, { role: "sheathing", label: "Deck" }, { role: "structure", label: "Structure / rafters" }, { role: "insulation", label: "Insulation" }, { role: "air", label: "Air gap" }, { role: "interior-finish", label: "Ceiling finish" }],
  wall: [{ role: "cladding", label: "Cladding / siding" }, { role: "barrier", label: "Weather barrier" }, { role: "sheathing", label: "Sheathing" }, { role: "structure", label: "Structure / studs" }, { role: "insulation", label: "Insulation" }, { role: "air", label: "Air gap" }, { role: "interior-finish", label: "Interior finish" }],
  floor: [{ role: "finish-floor", label: "Finish floor" }, { role: "sheathing", label: "Subfloor" }, { role: "structure", label: "Structure / joists" }, { role: "insulation", label: "Insulation" }, { role: "air", label: "Air gap" }, { role: "barrier", label: "Barrier" }, { role: "ground", label: "Ground contact" }, { role: "interior-finish", label: "Ceiling below" }],
  ceiling: [{ role: "air", label: "Attic side" }, { role: "insulation", label: "Insulation" }, { role: "structure", label: "Furring / joists" }, { role: "interior-finish", label: "Interior finish" }],
};
/** the section's OUTSIDE role — what its first layer is unless the file says otherwise */
export const OUTER: Record<LayerSection, LayerRole | null> = { roof: "roofing", wall: "cladding", floor: "finish-floor", ceiling: null };
const OUTER_ROLES: LayerRole[] = ["roofing", "cladding", "finish-floor"];
/** the material kinds a role draws on — the fallback pool when a row's name says nothing, and the tooltip's family */
export const ROLE_KINDS: Record<LayerRole, MaterialKind[]> = {
  roofing: ["roofing", "membrane", "metal", "masonry", "siding"], cladding: ["siding", "masonry", "metal", "wood", "glass"], "finish-floor": ["wood", "masonry", "membrane"],
  barrier: ["membrane"], sheathing: ["plywood", "gypsum"], structure: ["wood", "concrete", "masonry", "metal"], insulation: ["insulation-batt", "insulation-rigid"],
  air: ["air"], "interior-finish": ["gypsum", "wood", "masonry"], ground: ["generic"],
};
/** a row whose name says nothing takes its kind's roles */
const KIND_ROLES: Partial<Record<MaterialKind, LayerRole[]>> = {
  roofing: ["roofing"], siding: ["cladding"], wood: ["structure", "interior-finish"], plywood: ["sheathing"], concrete: ["structure"], masonry: ["structure", "cladding"], gypsum: ["interior-finish"],
  "insulation-batt": ["insulation"], "insulation-rigid": ["insulation"], metal: ["cladding", "roofing", "structure"], membrane: ["barrier", "roofing"], air: ["air"], glass: ["cladding"],
};
/** the NAME's word for each role — measured over the DataSets, the catalogue and the reference list (2026-09-16) */
const ROLE_RE: Array<[LayerRole, RegExp]> = [
  ["roofing", /shingle|shake|built[- ]?up|\bbur\b|epdm|\btpo\b|pvc (roof|membrane)|modified bitumen|\bsbs\b|torch|standing seam|metal (roof|standing)|clay tile|concrete tile|slate|asphalt roll|roofing|roof (membrane|gravel|tile|deck|panel)/],
  ["cladding", /siding|clapboard|stucco|eifs|fiber ?cement|hardboard|hardie|cladding|veneer|\bbrick\b|metal (panel|siding|wall)|wall panel|render|spandrel|curtain wall|\bacm\b|structural glazing|wood shingle/],
  ["barrier", /vapou?r|retarder|barrier|building paper|felt|house ?wrap|\bwrb\b|polyethylene|poly sheet|membrane|underlayment|tar paper|vapor seal/],
  ["sheathing", /plywood|\bosb\b|oriented strand|sheath|particle ?board|fiber ?board|fibreboard|\bmdf\b|wood panel|densglass|cement board|backer|subfloor|decking|wood deck|waferboard/],
  ["structure", /stud|joist|rafter|truss|lumber|furring|framing|framed|\bframe\b|softwood|hardwood|pine|\bfir\b|spruce|timber|glulam|\bclt\b|\blvl\b|cross laminated|concrete|\bcmu\b|block|brick|masonry|adobe|rammed|\bsips?\b|\bicf\b|precast|slab|steel|structural|metal deck|\blog\b|sandwich|insulated panel|\bhw\b|\blw\b|stone|granite|marble|limestone|sandstone|birch|maple|\bash\b|cypress|cedar|redwood/],
  ["insulation", /insul|batt|foam|polystyrene|\beps\b|\bxps\b|polyiso|\bpir\b|spray|cellulose|mineral wool|rock ?wool|glass fiber|fiberglass|loose[- ]fill|blown|perlite|vermiculite|cork|aerogel|vacuum|straw|hemp|wool|cellular glass|foamglas|compliance|\br-?\d|continuous ins|urethane|phenolic/],
  ["air", /air ?gap|air ?space|airspace|cavity|plenum|attic|void|^air\b|air layer/],
  ["interior-finish", /gypsum|drywall|plasterboard|\bgwb\b|wall ?board|plaster|acoustic|ceiling tile|panel(l)?ing|wainscot|paint|finish|lath|tile|terrazzo|wood planks?|hardwood/],
  ["finish-floor", /flooring|floor finish|hardwood strip|parquet|carpet|vinyl|\bvct\b|\blvt\b|linoleum|terrazzo|ceramic tile|tile\b|oak|wood planks?|floor cover|rubber/],
  ["ground", /soil|earth|clay silt|\bsand\b|gravel fill|hardcore|sub-?base|backfill|paving|tarmac|ground|dirt|mud/],
];
const hitsOf = (name: string): LayerRole[] => { const n = name.toLowerCase(); return ROLE_RE.filter(([, re]) => re.test(n)).map(([r]) => r); };
/** a materials.db row's roles: every role its NAME names; its kind's when the name says nothing; none for a gas or a generic placeholder */
export function rolesOfRow(name: string, kind: MaterialKind): LayerRole[] {
  const hits = hitsOf(name);
  if (hits.length) return hits;
  // a fenestration FRAME row (the catalogue's "Aluminum w/ Thrml Break - Double glass …") is no roofing or cladding: no fallback
  if (/window|door|glass|low.?e\b|thrml|thermal break/i.test(name)) return [];
  return KIND_ROLES[kind] ?? [];
}
/** among a layer's word hits, the one that names what the layer IS: the structure before the insulation between it, the sheathing before its gypsum */
const PRIORITY: LayerRole[] = ["structure", "barrier", "sheathing", "insulation", "air", "interior-finish", "ground"];
export interface LayerRoleRead {
  role: LayerRole | null;
  /** how it was read: the file's word, the layer's position, or not at all (a middle layer the file names vaguely) */
  from: "word" | "position" | null;
  /** the file's last layer reads as the outside (or its first as the inside): the stack may be listed inside-first — said, never applied */
  flag: string | null;
}
/** a layer's role from the FILE's word first, else from its POSITION (1 = outside, or the top of a floor); a middle layer with no
 *  word stays open. `outsideFirst` is the ruling on the stack's order (bemDb.ts); read false, the positions count from the end */
export function roleOfLayer(section: LayerSection, position: number, count: number, name: string, category: string | null, outsideFirst = true): LayerRoleRead {
  const pos = outsideFirst ? position : count + 1 - position;
  const outer = OUTER[section];
  const hits = hitsOf(name);
  const outerHit = hits.some((r) => OUTER_ROLES.includes(r));
  let role: LayerRole | null = null, from: LayerRoleRead["from"] = null;
  if (hits.length) {
    from = "word";
    // an outside word (siding, shingles, a metal panel, flooring) at either end, or alone, is the section's outside; between, the
    // stronger word (a concrete roof tile in the middle of a stack is the structure it also names)
    if (outerHit && outer && (pos === 1 || pos === count || hits.every((r) => OUTER_ROLES.includes(r)))) role = outer;
    else role = PRIORITY.find((r) => hits.includes(r)) ?? outer ?? hits[0]!;
  } else if (category && /paint|finish/i.test(category)) {
    // Revit's Paint / Finish category with a name that says nothing: the outside at the outside, a finish elsewhere
    if (pos === 1 && outer) { role = outer; from = "position"; } else { role = "interior-finish"; from = "word"; }
  } else if (pos === 1 && outer) { role = outer; from = "position"; }
  else if (pos === count && count > 1) { role = "interior-finish"; from = "position"; }
  const flag = from === "word" && count > 1 && ((outer !== null && role === outer && pos === count) || (role === "interior-finish" && pos === 1))
    ? `the file's ${pos === count ? "last" : "first"} layer reads as ${pos === count ? "the outside" : "the inside"} — the stack may be listed inside-first`
    : null;
  return { role, from, flag };
}
/** the section a type's kind belongs to, for the roles */
export const sectionOfKind = (kind: "roof" | "ceiling" | "wall" | "floor" | "window" | "door"): LayerSection => (kind === "roof" ? "roof" : kind === "ceiling" ? "ceiling" : kind === "floor" ? "floor" : "wall");
