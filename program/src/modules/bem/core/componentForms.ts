// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE FORMS (user, 2026-09-14 afternoon: "clean up the component UI — these
// corrections should be reviewed for all components"). A component's inputs are
// a FORM grouped by function, with ROLL-UPS to conserve vertical space, the
// fields the program assigns (names, nodes, references) left out, a schedule a
// dropdown, an enum in the user's words, every stated default in the dataset
// colour with its citation. The water-to-air heat pump's form was written by
// hand that morning (HeatPumpInputs); this module states the same thing as DATA
// for the unit heater, the two pumps, the ground heat exchanger in its subsets
// — the vertical System (Sizing:Rectangle · Properties · Array · Single ·
// ResponseFactors), the Slinky, the Pond, the Surface, the Horizontal Trench —
// and the fluid-to-fluid exchanger (its inputs determined, the object refused
// until a second ring can hold its other side).
//
// Every key in a spec is a field of an EnergyPlus class (the card's own or a
// sub-object's the generator writes for it — the fan's, the borehole's, the
// ground temperature model's) or one of the CARD-ONLY keys below; the gate
// checks each against the schema and writes references/component-inputs.md
// from these specs, so the determination is reviewable in one place. The words
// on hover are the Input Output Reference's own, shortened.

import type { SystemFields, FieldValue } from "./bemDb.js";
import type { EpSchema, EpField } from "./epSchema.js";

/** what the sheet knows about the card that a rule may need: the zone its Loc line names, how many units it is written as */
export interface Derived { zone?: string; units?: number }
export interface FormOption { v: string; label: string; title?: string; /** offered and refused: the reason */ disabled?: string }
export interface FormInput {
  /** the schema field key on `cls` (the card's class when absent) or a card-only key */
  key: string;
  /** the class the key belongs to when it is a sub-object's the generator writes for the card */
  cls?: string;
  /** the user's word for it; the schema's label otherwise */
  label?: string;
  /** what it means, from the Input Output Reference (on hover) */
  title?: string;
  /** the input's shape when the schema's kind is not it */
  as?: "schedule" | "constant-schedule" | "xy-list" | "pairs" | "slider" | "location" | "note";
  /** a schedule dropdown's words: the blank entry, an always entry, whether the SCHEDULES role is offered */
  schedule?: { blank: string; always?: string; role?: boolean };
  /** the enum in the user's words (the value the engine's); an entry offered and refused carries its reason */
  options?: FormOption[];
  /** a STATED default when the engine's is blank or the generator states another — the placeholder, in the dataset colour */
  dflt?: FieldValue | ((f: SystemFields, d: Derived) => FieldValue | undefined);
  /** where the stated default comes from */
  citation?: string;
  /** shown only when */
  when?: (f: SystemFields, d: Derived) => boolean;
  digits?: number; min?: number; max?: number;
  /** words beside the input */
  note?: string | ((f: SystemFields, d: Derived) => string | undefined);
}
export interface FormGroup {
  title: string;
  note?: string | ((f: SystemFields, d: Derived) => string | undefined);
  inputs: FormInput[];
  /** a ROLL-UP: collapsed until opened (user: "use roll ups to conserve vertical space") */
  rollup?: boolean;
  when?: (f: SystemFields, d: Derived) => boolean;
  /** a switch on the title: off = this value on this key, the inputs greyed */
  toggle?: { key: string; off: string; offNote: string };
  sub?: FormGroup[];
}
export interface FormSpec {
  cls: string;
  /** the head's words after "Inputs" */
  head: string;
  groups: FormGroup[];
  /** required fields of the class the form does not show because the generator STATES them (the gate checks every other required field is shown or assigned) */
  stated?: string[];
  /** the card is drawn and refused with this reason (the inputs determined, the object not written yet) */
  refused?: string;
}

// ── the card-only keys: on the card's fields beside the engine's own, read by the compile and the generator, never written as fields
/** the unit heater's availability manager (`none` · an AvailabilityManager class the generator writes with its assignment list) */
export const UH_MANAGER_FIELD = "uh_availability_manager";
/** the vertical borefield's layout: `array` (Vertical:Array) · `single` (a Vertical:Single per borehole) · `sizing` (Sizing:Rectangle, FullDesign) */
export const GHX_LAYOUT_FIELD = "ghx_layout";
/** the boreholes placed one by one: "x, y" per line, metres */
export const GHX_BOREHOLES_FIELD = "ghx_boreholes";
/** stated response factors: "ln(t/ts), g" per line — a GroundHeatExchanger:ResponseFactors is written and the System names it */
export const GHX_GFUNCTIONS_FIELD = "ghx_gfunctions";
export const CARD_KEYS: readonly string[] = [UH_MANAGER_FIELD, GHX_LAYOUT_FIELD, GHX_BOREHOLES_FIELD, GHX_GFUNCTIONS_FIELD];

/** the ground heat exchanger's TYPES — one card, its class the type (changed in place, the lines re-hung by medium); the
 *  fluid-to-fluid exchanger is offered and refused (its other side wants a second ring) */
export const GHX_TYPES: ReadonlyArray<{ cls: string; label: string; sub: string; /** offered — its inputs shown — and refused on the card with this reason */ refused?: string }> = [
  { cls: "GroundHeatExchanger:System", label: "Vertical borefield", sub: "boreholes with U-tubes: the engine computes the field's response (g-function) from the array, the boreholes placed one by one, a stated set, or designs the field itself" },
  { cls: "GroundHeatExchanger:Slinky", label: "Slinky (horizontal coils)", sub: "coiled tubing in trenches, vertical or horizontal rings — the engine computes the response itself" },
  { cls: "GroundHeatExchanger:Pond", label: "Pond", sub: "a shallow pond with submerged tubing circuits, on a condenser loop's supply side" },
  { cls: "GroundHeatExchanger:Surface", label: "Surface (hydronic slab)", sub: "a slab with embedded tubes — pavement, a hybrid system's heat rejection — ground-coupled or exposed below" },
  { cls: "GroundHeatExchanger:HorizontalTrench", label: "Horizontal trench", sub: "straight pipes in trenches: a transient soil simulation (the PipingSystem:Underground model behind a small interface)" },
  { cls: "HeatExchanger:FluidToFluid", label: "Fluid-to-fluid exchanger", sub: "couples the supply side of one loop to the demand side of another", refused: "couples the supply side of one loop to the demand side of ANOTHER — the sheet writes one loop per water ring today; a second ring on its demand side is the next slice" },
];
export const isGhxClass = (cls: string): boolean => GHX_TYPES.some((t) => t.cls === cls);

/** a number on a card's field, read from a number or from numeric text (an integer typed before the form knew integers are numbers, 2026-09-14) */
export const numOf = (v: FieldValue | undefined): number | null => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** the two lists a card's text fields hold: boreholes "x, y" per line; response factors "ln(t/ts), g" per line — a line that is not two numbers is named */
export function parsePairs(text: FieldValue | undefined): { pairs: Array<[number, number]>; bad: string[] } {
  const pairs: Array<[number, number]> = [], bad: string[] = [];
  for (const raw of String(text ?? "").split(/[\n;]/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.split(/[,\s]+/).filter(Boolean).map(Number);
    if (m.length === 2 && m.every((x) => Number.isFinite(x))) pairs.push([m[0]!, m[1]!]); else bad.push(line);
  }
  return { pairs, bad };
}

// ── the stated defaults the generator writes (cited once here, read by the forms and the generator)
export const UH_FAN_DEFAULT = { pressureRisePa: 75, totalEfficiency: 0.7, citation: "stated: a unit heater blows into the room, not into duct — a small direct-drive propeller fan" } as const;
/** the engine's own slinky (GSHP-Slinky.idf, Slinky GHX), the whole object: 15 trenches of 40 m at 2.5 m, 1 m rings at a 0.2 m pitch stood
 *  vertical, 2 m apart — a required number left blank is a Severe (GATE_GHX, 2026-09-15), so every one is stated and the card's own wins */
export const SLINKY_EXAMPLE = { configuration: "Vertical", years: 10, designFlowM3s: 0.0033, soilK: 1.2, soilDensity: 3200, soilCp: 850, pipeK: 1.8, pipeDensity: 920, pipeCp: 2200,
  pipeOuterM: 0.02667, pipeThicknessM: 0.002413, coilDiameterM: 1, coilPitchM: 0.2, trenchDepthM: 2.5, trenchLengthM: 40, trenches: 15, spacingM: 2, citation: "ExampleFiles/GSHP-Slinky.idf, Slinky GHX" } as const;
/** the engine's own horizontal trench (PlantHorizontalGroundHX.idf, My Pipe Circuit), the whole object: 2 trenches of 75 m at 1.25 m, 2 m apart —
 *  at the engine's own field defaults alone the fluid ran −60 … 209 °C over the year (GATE_GHX, 2026-09-15), so the example's sizes are stated */
export const TRENCH_EXAMPLE = { designFlowM3s: 0.004, trenchLengthM: 75, trenches: 2, spacingM: 2.0, pipeInnerM: 0.016, pipeOuterM: 0.02667, burialDepthM: 1.25, soilK: 1.08, soilDensity: 962, soilCp: 2576,
  pipeK: 0.3895, pipeDensity: 641, pipeCp: 2405, moisturePct: 30, moistureSatPct: 50, groundCover: 0.408, citation: "ExampleFiles/PlantHorizontalGroundHX.idf, My Pipe Circuit" } as const;
/** the engine's own pond (PondGroundHeatExchanger.idf, Pond 1): depth, area, the tubing, the ground's conductance */
export const POND_EXAMPLE = { depthM: 2, areaM2: 1000, tubeInM: 0.02, tubeOutM: 0.025, tubeK: 0.4, groundK: 1.0, circuits: 10, circuitLengthM: 50, citation: "ExampleFiles/PondGroundHeatExchanger.idf, Pond 1" } as const;
/** the engine's own surface (SurfaceGroundHeatExchanger.idf, SURFACE 1): two layers of 4 in heavyweight concrete under 100 × 100 m of tubing */
export const SURFACE_EXAMPLE = { tubeInM: 0.02, circuits: 10, spacingM: 0.3, lengthM: 100, widthM: 100, lower: "Ground", concrete: { thicknessM: 0.1, conductivity: 1.729577, density: 2242.585, specificHeat: 836.8, roughness: "MediumRough", thermalAbs: 0.9, solarAbs: 0.65, visibleAbs: 0.65 }, source: { afterLayer: 1, temperatureAfterLayer: 1, ctfDimensions: 1, tubeSpacingM: 0.1524, position: 0 }, citation: "ExampleFiles/SurfaceGroundHeatExchanger.idf, SURFACE 1 and its 4 IN HW CONCRETE" } as const;
/** the sizing period the engine's own borefield design runs on (GSHP-GLHE-BoreholeFieldDesign.idf): the whole weather year */
export const GHX_SIZING_YEAR = { citation: "ExampleFiles/GSHP-GLHE-BoreholeFieldDesign.idf, Full Year Weather File Sizing Period", designFlowM3s: 0.001 } as const;

const KA = "Site:GroundTemperature:Undisturbed:KusudaAchenbach", FD = "Site:GroundTemperature:Undisturbed:FiniteDifference", XING = "Site:GroundTemperature:Undisturbed:Xing";
const groundModel = (f: SystemFields): string => (typeof f.undisturbed_ground_temperature_model_type === "string" && f.undisturbed_ground_temperature_model_type ? f.undisturbed_ground_temperature_model_type : KA);
/** THE UNDISTURBED GROUND TEMPERATURE — one roll-up shared by the vertical field, the slinky and the trench: the model's class, then its own fields;
 *  the soil numbers are the borefield default's (BOREFIELD_DEFAULT in epAssemble) until typed */
const GROUND_TEMPERATURE: FormGroup = {
  title: "Ground temperature", rollup: true, note: "the undisturbed ground, the model the engine takes",
  inputs: [
    { key: "undisturbed_ground_temperature_model_type", label: "model", title: "how the undisturbed ground temperature is found through the year — the engine's three", options: [
      { v: KA, label: "Kusuda-Achenbach — a sine through the year from a mean, an amplitude and a phase (the default)" },
      { v: FD, label: "finite difference — a 1-D soil simulation driven by the weather file" },
      { v: XING, label: "Xing — two harmonics" }], dflt: KA },
    { key: "soil_thermal_conductivity", cls: KA, label: "soil conductivity", dflt: 2.5, citation: "the borefield default (BOREFIELD_DEFAULT)", digits: 2 },
    { key: "soil_density", cls: KA, label: "soil density", dflt: 1500, digits: 0 },
    { key: "soil_specific_heat", cls: KA, label: "soil specific heat", dflt: 1667, digits: 0 },
    { key: "average_soil_surface_temperature", cls: KA, label: "mean surface temperature", dflt: 13.4, digits: 1, when: (f) => groundModel(f) === KA, title: "the annual average soil surface temperature" },
    { key: "average_amplitude_of_surface_temperature", cls: KA, label: "amplitude", dflt: 3.2, digits: 1, when: (f) => groundModel(f) === KA, title: "the annual variation from the average" },
    { key: "phase_shift_of_minimum_surface_temperature", cls: KA, label: "day of minimum", dflt: 8, digits: 0, when: (f) => groundModel(f) === KA, title: "the day of the year the surface is coldest" },
    { key: "soil_moisture_content_volume_fraction", cls: FD, label: "moisture content", when: (f) => groundModel(f) === FD, digits: 0 },
    { key: "soil_moisture_content_volume_fraction_at_saturation", cls: FD, label: "moisture at saturation", when: (f) => groundModel(f) === FD, digits: 0 },
    { key: "evapotranspiration_ground_cover_parameter", cls: FD, label: "ground cover", when: (f) => groundModel(f) === FD, digits: 2, title: "0 concrete or other solid · 0.5 short grass · 1 a crop · 1.5 a tall crop (the reference's cases)" },
    { key: "average_soil_surface_temperature", cls: XING, label: "mean surface temperature", dflt: 13.4, digits: 1, when: (f) => groundModel(f) === XING },
    { key: "soil_surface_temperature_amplitude_1", cls: XING, label: "amplitude 1", dflt: 3.2, digits: 1, when: (f) => groundModel(f) === XING },
    { key: "soil_surface_temperature_amplitude_2", cls: XING, label: "amplitude 2", dflt: 0, digits: 1, when: (f) => groundModel(f) === XING },
    { key: "phase_shift_of_temperature_amplitude_1", cls: XING, label: "phase 1", dflt: 8, digits: 0, when: (f) => groundModel(f) === XING },
    { key: "phase_shift_of_temperature_amplitude_2", cls: XING, label: "phase 2", dflt: 0, digits: 0, when: (f) => groundModel(f) === XING },
  ],
};

const layoutOf = (f: SystemFields): string => (typeof f[GHX_LAYOUT_FIELD] === "string" && f[GHX_LAYOUT_FIELD] ? String(f[GHX_LAYOUT_FIELD]) : "array");
const boresOf = (f: SystemFields): number => {
  const lay = layoutOf(f);
  if (lay === "single") return parsePairs(f[GHX_BOREHOLES_FIELD]).pairs.length || 1;
  if (lay === "sizing") return 1;
  const nx = numOf(f.number_of_boreholes_in_x_direction) ?? 4, ny = numOf(f.number_of_boreholes_in_y_direction) ?? 1;
  return Math.max(1, Math.round(nx * ny));
};
const gfStated = (f: SystemFields): boolean => parsePairs(f[GHX_GFUNCTIONS_FIELD]).pairs.length > 0;

const VP = "GroundHeatExchanger:Vertical:Properties", VA = "GroundHeatExchanger:Vertical:Array", VS = "GroundHeatExchanger:Vertical:Sizing:Rectangle", RF = "GroundHeatExchanger:ResponseFactors";
const VERTICAL: FormSpec = {
  cls: "GroundHeatExchanger:System",
  head: "a vertical borefield on the ring's supply side — its nodes and branch assigned by the program; the borehole, the array and the ground model are written for it",
  stated: ["inlet_node_name", "outlet_node_name", "undisturbed_ground_temperature_model_name"],
  groups: [
    { title: "System", inputs: [
      { key: "design_flow_rate", label: "design flow rate", title: "the total flow for the whole field, spread evenly over the boreholes", dflt: (f) => (layoutOf(f) === "sizing" ? GHX_SIZING_YEAR.designFlowM3s : Number((0.0005 * boresOf(f)).toPrecision(4))), citation: "0.0005 m³/s per borehole — the engine's own Sizing:Rectangle default, × the boreholes", digits: 5 },
      { key: "ground_thermal_conductivity", label: "ground conductivity", dflt: 2.5, citation: "the borefield default", digits: 2 },
      { key: "ground_thermal_heat_capacity", label: "ground heat capacity", dflt: 2.5e6, citation: "the borefield default", digits: 0 },
      { key: "g_function_calculation_method", label: "response", title: "how the field's g-function is found when no response factors are stated — computed by the engine from the boreholes, or the field designed by the engine (GHEDesigner) within the rectangle stated below", options: [
        { v: "UHFcalc", label: "computed by the engine — uniform heat flux at the borehole wall (the default)" },
        { v: "UBHWTcalc", label: "computed by the engine — uniform borehole wall temperature" },
        { v: "FullDesign", label: "designed by the engine — the field sized within the rectangle (the designed layout)" }], dflt: "UHFcalc", when: (f) => !gfStated(f) && layoutOf(f) !== "sizing" },
      { key: "g_function_calculation_method", as: "note", label: "response", when: (f) => !gfStated(f) && layoutOf(f) === "sizing", note: "FullDesign — the field is designed by the engine within the rectangle stated in the layout" },
      { key: GHX_GFUNCTIONS_FIELD, as: "note", label: "response", when: (f) => gfStated(f), note: "the response factors stated below are used; the calculation method is ignored" },
    ] },
    GROUND_TEMPERATURE,
    { title: "Vertical · borehole", rollup: true, note: "GroundHeatExchanger:Vertical:Properties — one description every borehole shares", inputs: [
      { key: "depth_of_top_of_borehole", cls: VP, label: "depth of top", dflt: 1, citation: "the borefield default", digits: 2 },
      { key: "borehole_length", cls: VP, label: "length", dflt: 76.2, citation: "the borefield default (250 ft)", digits: 1 },
      { key: "borehole_diameter", cls: VP, label: "diameter", dflt: 0.127, digits: 3 },
      { key: "grout_thermal_conductivity", cls: VP, label: "grout conductivity", dflt: 0.744, digits: 3 },
      { key: "grout_thermal_heat_capacity", cls: VP, label: "grout heat capacity", dflt: 3.9e6, digits: 0 },
      { key: "pipe_thermal_conductivity", cls: VP, label: "pipe conductivity", dflt: 0.389, digits: 3 },
      { key: "pipe_thermal_heat_capacity", cls: VP, label: "pipe heat capacity", dflt: 1.77e6, digits: 0 },
      { key: "pipe_outer_diameter", cls: VP, label: "pipe outer diameter", dflt: 0.0267, digits: 4 },
      { key: "pipe_thickness", cls: VP, label: "pipe thickness", dflt: 0.00243, digits: 5 },
      { key: "u_tube_distance", cls: VP, label: "U-tube distance", dflt: 0.0511, digits: 4, title: "centre to centre between the two legs of the U-tube" },
    ] },
    { title: "Vertical · layout", note: (f) => ({ array: "GroundHeatExchanger:Vertical:Array", single: "GroundHeatExchanger:Vertical:Single, one per borehole", sizing: "GroundHeatExchanger:Vertical:Sizing:Rectangle — the engine runs a sizing year first (SizingPeriod:WeatherFileDays, written)" } as Record<string, string>)[layoutOf(f)], inputs: [
      { key: GHX_LAYOUT_FIELD, label: "layout", title: "the four ways the reference gives to describe the field: a rectangular array; boreholes placed one by one; response factors from a third-party tool (the roll-up below); or the field designed by the engine from a single seed borehole and the rectangle it may use", options: [
        { v: "array", label: "a rectangular array — rows × columns at a spacing (the default)" },
        { v: "single", label: "boreholes placed one by one — x, y each" },
        { v: "sizing", label: "designed by the engine — sized within an available rectangle (FullDesign, GHEDesigner)" }], dflt: "array" },
      { key: "number_of_boreholes_in_x_direction", cls: VA, label: "boreholes in x", dflt: 4, digits: 0, when: (f) => layoutOf(f) === "array" },
      { key: "number_of_boreholes_in_y_direction", cls: VA, label: "boreholes in y", dflt: 1, digits: 0, when: (f) => layoutOf(f) === "array" },
      { key: "borehole_spacing", cls: VA, label: "spacing", dflt: 6, digits: 2, when: (f) => layoutOf(f) === "array" },
      { key: GHX_BOREHOLES_FIELD, as: "xy-list", label: "boreholes", title: "one borehole per line: x, y in metres — a GroundHeatExchanger:Vertical:Single is written for each", when: (f) => layoutOf(f) === "single", note: (f) => { const p = parsePairs(f[GHX_BOREHOLES_FIELD]); return `${p.pairs.length} borehole${p.pairs.length === 1 ? "" : "s"}${p.bad.length ? ` · not read: ${p.bad.join(" · ")}` : ""}${p.pairs.length ? "" : " — none yet: one x, y per line (0, 0 to start)"}`; } },
      { key: "available_borehole_field_length", cls: VS, label: "available length", when: (f) => layoutOf(f) === "sizing", digits: 1, title: "the length of the area the field may use" },
      { key: "available_borehole_field_width", cls: VS, label: "available width", when: (f) => layoutOf(f) === "sizing", digits: 1 },
      { key: "maximum_number_of_boreholes", cls: VS, label: "max boreholes", when: (f) => layoutOf(f) === "sizing", digits: 0 },
      { key: "minimum_borehole_spacing", cls: VS, label: "spacing min", when: (f) => layoutOf(f) === "sizing", digits: 1 },
      { key: "maximum_borehole_spacing", cls: VS, label: "spacing max", when: (f) => layoutOf(f) === "sizing", digits: 1 },
      { key: "minimum_borehole_vertical_length", cls: VS, label: "depth min", when: (f) => layoutOf(f) === "sizing", digits: 0 },
      { key: "maximum_borehole_vertical_length", cls: VS, label: "depth max", when: (f) => layoutOf(f) === "sizing", digits: 0 },
      { key: "minimum_exiting_fluid_temperature_for_sizing", cls: VS, label: "exiting fluid min", when: (f) => layoutOf(f) === "sizing", digits: 1, title: "the coldest the fluid may leave the field in the design" },
      { key: "maximum_exiting_fluid_temperature_for_sizing", cls: VS, label: "exiting fluid max", when: (f) => layoutOf(f) === "sizing", digits: 1 },
      { key: "design_flow_rate_per_borehole", cls: VS, label: "flow per borehole", when: (f) => layoutOf(f) === "sizing", digits: 5 },
    ] },
    { title: "Response factors", rollup: true, note: "GroundHeatExchanger:ResponseFactors — g-functions from GLHEPro or a library; blank = computed by the engine", inputs: [
      { key: GHX_GFUNCTIONS_FIELD, as: "pairs", label: "g-functions", title: "one pair per line: ln(t/ts), g — the non-dimensional time and the g-function value", note: (f) => { const p = parsePairs(f[GHX_GFUNCTIONS_FIELD]); return p.pairs.length ? `${p.pairs.length} pairs${p.bad.length ? ` · not read: ${p.bad.join(" · ")}` : ""}` : "none — the engine computes them"; } },
      { key: "g_function_reference_ratio", cls: RF, label: "reference ratio", when: gfStated, digits: 5, title: "the rb/H the g-functions were computed at" },
      { key: "number_of_boreholes", cls: RF, label: "boreholes", when: gfStated, digits: 0, dflt: (f) => boresOf(f), citation: "the layout's count" },
    ] },
  ],
};

const SLINKY: FormSpec = {
  cls: "GroundHeatExchanger:Slinky",
  head: "coiled tubing in trenches on the ring's supply side — the engine computes the response; nodes and branch assigned by the program",
  stated: ["inlet_node_name", "outlet_node_name", "undisturbed_ground_temperature_model_name"],
  groups: [
    { title: "System", inputs: [
      { key: "design_flow_rate", label: "design flow rate", dflt: SLINKY_EXAMPLE.designFlowM3s, citation: SLINKY_EXAMPLE.citation, digits: 4 },
      { key: "heat_exchanger_configuration", label: "rings", title: "the orientation of the coil's rings in the trench", options: [{ v: "Vertical", label: "vertical — rings stood in the trench" }, { v: "Horizontal", label: "horizontal — rings laid flat" }], dflt: SLINKY_EXAMPLE.configuration, citation: SLINKY_EXAMPLE.citation },
      { key: "maximum_length_of_simulation", label: "years simulated", dflt: SLINKY_EXAMPLE.years, citation: SLINKY_EXAMPLE.citation, digits: 0, title: "the longest run the response is prepared for" },
    ] },
    { title: "Trench", inputs: [
      { key: "trench_depth", label: "depth", dflt: SLINKY_EXAMPLE.trenchDepthM, citation: SLINKY_EXAMPLE.citation, digits: 2, title: "from the ground surface to the trench bottom" },
      { key: "trench_length", label: "length", dflt: SLINKY_EXAMPLE.trenchLengthM, citation: SLINKY_EXAMPLE.citation, digits: 1, title: "the length of one trench; the coil runs its full length" },
      { key: "number_of_trenches", label: "trenches", dflt: SLINKY_EXAMPLE.trenches, citation: SLINKY_EXAMPLE.citation, digits: 0, title: "parallel trenches, a coil in each" },
      { key: "horizontal_spacing_between_pipes", label: "spacing", dflt: SLINKY_EXAMPLE.spacingM, citation: SLINKY_EXAMPLE.citation, digits: 2, title: "between trenches" },
    ] },
    { title: "Coil", inputs: [
      { key: "coil_diameter", label: "ring diameter", dflt: SLINKY_EXAMPLE.coilDiameterM, citation: SLINKY_EXAMPLE.citation, digits: 2 },
      { key: "coil_pitch", label: "pitch", dflt: SLINKY_EXAMPLE.coilPitchM, citation: SLINKY_EXAMPLE.citation, digits: 2, title: "centre to centre between rings" },
    ] },
    { title: "Soil", rollup: true, inputs: [
      { key: "soil_thermal_conductivity", label: "conductivity", dflt: SLINKY_EXAMPLE.soilK, citation: SLINKY_EXAMPLE.citation, digits: 2 }, { key: "soil_density", label: "density", dflt: SLINKY_EXAMPLE.soilDensity, citation: SLINKY_EXAMPLE.citation, digits: 0 }, { key: "soil_specific_heat", label: "specific heat", dflt: SLINKY_EXAMPLE.soilCp, citation: SLINKY_EXAMPLE.citation, digits: 0 },
    ] },
    { title: "Pipe", rollup: true, inputs: [
      { key: "pipe_outer_diameter", label: "outer diameter", dflt: SLINKY_EXAMPLE.pipeOuterM, citation: SLINKY_EXAMPLE.citation, digits: 5 }, { key: "pipe_thickness", label: "wall thickness", dflt: SLINKY_EXAMPLE.pipeThicknessM, citation: SLINKY_EXAMPLE.citation, digits: 6 },
      { key: "pipe_thermal_conductivity", label: "conductivity", dflt: SLINKY_EXAMPLE.pipeK, citation: SLINKY_EXAMPLE.citation, digits: 3 }, { key: "pipe_density", label: "density", dflt: SLINKY_EXAMPLE.pipeDensity, citation: SLINKY_EXAMPLE.citation, digits: 0 }, { key: "pipe_specific_heat", label: "specific heat", dflt: SLINKY_EXAMPLE.pipeCp, citation: SLINKY_EXAMPLE.citation, digits: 0 },
    ] },
    GROUND_TEMPERATURE,
  ],
};

const POND: FormSpec = {
  cls: "GroundHeatExchanger:Pond",
  head: "a shallow pond with submerged tubing on the ring's supply side — no stratification modelled; nodes and branch assigned by the program",
  stated: ["fluid_inlet_node_name", "fluid_outlet_node_name"],
  groups: [
    { title: "Pond", inputs: [
      { key: "pond_depth", label: "depth", dflt: POND_EXAMPLE.depthM, citation: POND_EXAMPLE.citation, digits: 2 },
      { key: "pond_area", label: "area", dflt: POND_EXAMPLE.areaM2, citation: POND_EXAMPLE.citation, digits: 0 },
      { key: "ground_thermal_conductivity", label: "ground conductance", dflt: POND_EXAMPLE.groundK, citation: POND_EXAMPLE.citation, digits: 2, title: "the pond bottom's coupling to the ground, per unit area (W/m²·K — the engine's own unit here)" },
    ] },
    { title: "Tubing", inputs: [
      { key: "number_of_tubing_circuits", label: "circuits", dflt: POND_EXAMPLE.circuits, digits: 0 },
      { key: "length_of_each_tubing_circuit", label: "length each", dflt: POND_EXAMPLE.circuitLengthM, digits: 0 },
      { key: "hydronic_tubing_inside_diameter", label: "inside diameter", dflt: POND_EXAMPLE.tubeInM, digits: 4 },
      { key: "hydronic_tubing_outside_diameter", label: "outside diameter", dflt: POND_EXAMPLE.tubeOutM, digits: 4 },
      { key: "hydronic_tubing_thermal_conductivity", label: "conductivity", dflt: POND_EXAMPLE.tubeK, digits: 3 },
    ] },
  ],
};

const SURFACE: FormSpec = {
  cls: "GroundHeatExchanger:Surface",
  head: "a slab with embedded tubes on the ring's supply side — nodes, branch and its construction assigned by the program",
  stated: ["fluid_inlet_node_name", "fluid_outlet_node_name", "construction_name"],
  groups: [
    { title: "Surface", inputs: [
      { key: "surface_length", label: "length", dflt: SURFACE_EXAMPLE.lengthM, citation: SURFACE_EXAMPLE.citation, digits: 1 },
      { key: "surface_width", label: "width", dflt: SURFACE_EXAMPLE.widthM, citation: SURFACE_EXAMPLE.citation, digits: 1 },
      { key: "lower_surface_environment", label: "below it", options: [{ v: "Ground", label: "ground — the slab is ground-coupled (the default)" }, { v: "Exposed", label: "exposed — the underside sees the wind, not the sun" }], dflt: "Ground" },
      { key: "construction_name", as: "note", label: "construction", note: "written for it: two layers of 4 in heavyweight concrete — the engine's own example's" },
    ] },
    { title: "Tubing", inputs: [
      { key: "number_of_tubing_circuits", label: "circuits", dflt: SURFACE_EXAMPLE.circuits, digits: 0 },
      { key: "hydronic_tube_spacing", label: "spacing", dflt: SURFACE_EXAMPLE.spacingM, digits: 2 },
      { key: "hydronic_tubing_inside_diameter", label: "inside diameter", dflt: SURFACE_EXAMPLE.tubeInM, digits: 4 },
    ] },
  ],
};

const TRENCH: FormSpec = {
  cls: "GroundHeatExchanger:HorizontalTrench",
  head: "straight pipes in trenches on the ring's supply side — a transient soil simulation; nodes and branch assigned by the program",
  stated: ["inlet_node_name", "outlet_node_name", "undisturbed_ground_temperature_model_name"],
  groups: [
    { title: "System", inputs: [
      { key: "design_flow_rate", label: "design flow rate", dflt: TRENCH_EXAMPLE.designFlowM3s, citation: TRENCH_EXAMPLE.citation, digits: 4 },
    ] },
    { title: "Trench", inputs: [
      { key: "trench_length_in_pipe_axial_direction", label: "length", dflt: TRENCH_EXAMPLE.trenchLengthM, citation: TRENCH_EXAMPLE.citation, digits: 1, title: "the axial length of each trench, one pipe per trench" },
      { key: "number_of_trenches", label: "trenches", dflt: TRENCH_EXAMPLE.trenches, citation: TRENCH_EXAMPLE.citation, digits: 0 },
      { key: "horizontal_spacing_between_pipes", label: "spacing", dflt: TRENCH_EXAMPLE.spacingM, citation: TRENCH_EXAMPLE.citation, digits: 2 },
      { key: "burial_depth", label: "burial depth", dflt: TRENCH_EXAMPLE.burialDepthM, citation: TRENCH_EXAMPLE.citation, digits: 2, title: "ground surface to the pipe's centre" },
    ] },
    { title: "Pipe", rollup: true, inputs: [
      { key: "pipe_inner_diameter", label: "inner diameter", dflt: TRENCH_EXAMPLE.pipeInnerM, citation: TRENCH_EXAMPLE.citation, digits: 4 }, { key: "pipe_outer_diameter", label: "outer diameter", dflt: TRENCH_EXAMPLE.pipeOuterM, citation: TRENCH_EXAMPLE.citation, digits: 4 },
      { key: "pipe_thermal_conductivity", label: "conductivity", dflt: TRENCH_EXAMPLE.pipeK, citation: TRENCH_EXAMPLE.citation, digits: 4 }, { key: "pipe_density", label: "density", dflt: TRENCH_EXAMPLE.pipeDensity, citation: TRENCH_EXAMPLE.citation, digits: 0 }, { key: "pipe_specific_heat", label: "specific heat", dflt: TRENCH_EXAMPLE.pipeCp, citation: TRENCH_EXAMPLE.citation, digits: 0 },
    ] },
    { title: "Soil", rollup: true, inputs: [
      { key: "soil_thermal_conductivity", label: "conductivity", dflt: TRENCH_EXAMPLE.soilK, citation: TRENCH_EXAMPLE.citation, digits: 2 }, { key: "soil_density", label: "density", dflt: TRENCH_EXAMPLE.soilDensity, citation: TRENCH_EXAMPLE.citation, digits: 0 }, { key: "soil_specific_heat", label: "specific heat", dflt: TRENCH_EXAMPLE.soilCp, citation: TRENCH_EXAMPLE.citation, digits: 0 },
      { key: "soil_moisture_content_percent", label: "moisture content", dflt: TRENCH_EXAMPLE.moisturePct, citation: TRENCH_EXAMPLE.citation, digits: 0 }, { key: "soil_moisture_content_percent_at_saturation", label: "moisture at saturation", dflt: TRENCH_EXAMPLE.moistureSatPct, citation: TRENCH_EXAMPLE.citation, digits: 0 },
      { key: "evapotranspiration_ground_cover_parameter", label: "ground cover", dflt: TRENCH_EXAMPLE.groundCover, citation: TRENCH_EXAMPLE.citation, digits: 2, title: "0 concrete or other solid · 0.5 short grass · 1 a crop · 1.5 a tall crop" },
    ] },
    GROUND_TEMPERATURE,
  ],
};

const FLUID: FormSpec = {
  cls: "HeatExchanger:FluidToFluid",
  head: "couples the supply side of one loop to the demand side of another — nodes assigned by the program",
  refused: GHX_TYPES.find((t) => t.cls === "HeatExchanger:FluidToFluid")!.refused,
  stated: ["loop_demand_side_inlet_node_name", "loop_demand_side_outlet_node_name", "loop_supply_side_inlet_node_name", "loop_supply_side_outlet_node_name"],
  groups: [
    { title: "Unit", inputs: [
      { key: "availability_schedule_name", as: "schedule", label: "availability", schedule: { blank: "always available" } },
      { key: "heat_exchange_model_type", label: "model", options: [
        { v: "Ideal", label: "ideal — the outlet reaches the other side's inlet (the default)" }, { v: "CounterFlow", label: "counter flow" }, { v: "ParallelFlow", label: "parallel flow" },
        { v: "CrossFlowBothUnMixed", label: "cross flow, both unmixed" }, { v: "CrossFlowBothMixed", label: "cross flow, both mixed" },
        { v: "CrossFlowSupplyMixedDemandUnMixed", label: "cross flow, supply mixed, demand unmixed" }, { v: "CrossFlowSupplyUnMixedDemandMixed", label: "cross flow, supply unmixed, demand mixed" }] },
      { key: "heat_exchanger_u_factor_times_area_value", label: "UA", digits: 0, title: "the exchanger's U × A; autosize = the engine's" },
    ] },
    { title: "Design", inputs: [
      { key: "loop_supply_side_design_flow_rate", label: "supply-side flow", digits: 4 },
      { key: "loop_demand_side_design_flow_rate", label: "demand-side flow", digits: 4 },
      { key: "sizing_factor", label: "sizing factor", digits: 2, title: "multiplies the autosized flows" },
    ] },
    { title: "Control", inputs: [
      { key: "control_type", label: "control", options: [
        { v: "UncontrolledOn", label: "uncontrolled on — runs whenever both sides flow (the default)" },
        { v: "OperationSchemeModulated", label: "by the loop's operation scheme, modulated" }, { v: "OperationSchemeOnOff", label: "by the loop's operation scheme, on/off" },
        { v: "HeatingSetpointModulated", label: "heating setpoint, modulated" }, { v: "HeatingSetpointOnOff", label: "heating setpoint, on/off" },
        { v: "CoolingSetpointModulated", label: "cooling setpoint, modulated" }, { v: "CoolingSetpointOnOff", label: "cooling setpoint, on/off" },
        { v: "DualDeadbandSetpointModulated", label: "dual deadband setpoint, modulated" }, { v: "DualDeadbandSetpointOnOff", label: "dual deadband setpoint, on/off" },
        { v: "CoolingDifferentialOnOff", label: "cooling differential, on/off — the waterside economizer" }, { v: "CoolingSetpointOnOffWithComponentOverride", label: "cooling setpoint with a component override — the old hydronic exchanger" }] },
      { key: "minimum_temperature_difference_to_activate_heat_exchanger", label: "min ΔT to run", digits: 2 },
      { key: "operation_minimum_temperature_limit", label: "inlet min", digits: 1, title: "the exchanger does not run when either inlet is below this" },
      { key: "operation_maximum_temperature_limit", label: "inlet max", digits: 1 },
      { key: "heat_transfer_metering_end_use_type", label: "metered as", options: [{ v: "LoopToLoop", label: "loop to loop (the default)" }, { v: "FreeCooling", label: "free cooling" }, { v: "HeatRecovery", label: "heat recovery" }, { v: "HeatRecoveryForCooling", label: "heat recovery for cooling" }, { v: "HeatRecoveryForHeating", label: "heat recovery for heating" }, { v: "HeatRejection", label: "heat rejection" }] },
    ] },
  ],
};

// ── the unit heater (user, 2026-09-14): availability, the supply fan (its type, flow, operating mode, running without a load, an
//    availability manager), the heating coil (its type; a water or steam coil's flows; the convergence)
const fanCls = (f: SystemFields): string => (typeof f.supply_air_fan_object_type === "string" && f.supply_air_fan_object_type ? f.supply_air_fan_object_type : "Fan:OnOff");
const coilCls = (f: SystemFields): string => (typeof f.heating_coil_object_type === "string" && f.heating_coil_object_type ? f.heating_coil_object_type : "Coil:Heating:Electric");
const wetCoil = (f: SystemFields): boolean => /Water|Steam/.test(coilCls(f));
export const UH_WATER_REFUSAL = "a hot-water or steam coil needs the heater on a hot-water ring with a pump and a boiler — not written yet (the unit heater is placed by its Loc alone; its water side is the next slice); pick an electric or a fuel coil";
const UNIT_HEATER: FormSpec = {
  cls: "ZoneHVAC:UnitHeater",
  head: "a fan-forced heater: its Air in is the zone's exhaust node, its Air out the zone's inlet node (the reference's rule) — the Air lines to the Zone or its Loc say which zone; the nodes are assigned by the program",
  stated: ["air_inlet_node_name", "air_outlet_node_name", "supply_air_fan_name", "heating_coil_name", "maximum_supply_air_flow_rate", "supply_air_fan_operation_during_no_heating", "supply_air_fan_object_type", "heating_coil_object_type"],
  groups: [
    { title: "Unit", inputs: [
      { key: "availability_schedule_name", as: "schedule", label: "availability", title: "the unit is available while the schedule reads > 0; blank = always (the engine's default). The fan and the coil take the same schedule.", schedule: { blank: "always available (the engine's default)", role: true } },
    ] },
    { title: "Supply fan", inputs: [
      { key: "supply_air_fan_object_type", label: "fan", title: "the four fans the unit heater takes; the reference recommends Fan:SystemModel for new models and says the other three may be deprecated", options: [
        { v: "Fan:OnOff", label: "on/off — cycles with the coil (the default)" },
        { v: "Fan:SystemModel", label: "system model — the engine's general fan (recommended by the reference)" },
        { v: "Fan:ConstantVolume", label: "constant volume — runs while available" },
        { v: "Fan:VariableVolume", label: "variable volume — power by a curve of the flow fraction" }], dflt: "Fan:OnOff" },
      { key: "maximum_supply_air_flow_rate", label: "air flow rate", title: "the maximum air flow through the unit; autosize = the engine sizes it at the design day", dflt: "autosize" },
      { key: "supply_air_fan_operating_mode_schedule_name", as: "schedule", label: "operating mode", title: "0 = the fan cycles with the coil · > 0 = the fan runs continuously; blank = cycling (the engine's default). Read for the on/off and system-model fans.", schedule: { blank: "cycling — the fan runs with the coil", always: "continuous — the fan runs always", role: false } },
      { key: "supply_air_fan_operation_during_no_heating", label: "fan without a load", title: "No: the fan does not run unless there is a heating load (the unit is effectively off) · Yes: the unit available and the fan continuous, it runs and moves air, adding its own heat", options: [{ v: "No", label: "No — the fan runs only when it heats" }, { v: "Yes", label: "Yes — the fan circulates air when there is no load" }], dflt: "No" },
      { key: UH_MANAGER_FIELD, label: "availability manager", title: "an AvailabilityManagerAssignmentList on the unit: a manager that overrides the schedule — night cycle brings the unit on when the zone falls below its setpoint while it is scheduled off", options: [
        { v: "none", label: "none — the availability schedule alone (the default)" },
        { v: "AvailabilityManager:NightCycle", label: "night cycle — cycles the unit on when the zone falls below its setpoint while unavailable" }], dflt: "none" },
      { key: "pressure_rise", cls: "Fan:OnOff", label: "pressure rise", dflt: UH_FAN_DEFAULT.pressureRisePa, citation: UH_FAN_DEFAULT.citation, digits: 0 },
      { key: "fan_total_efficiency", cls: "Fan:OnOff", label: "fan efficiency", dflt: UH_FAN_DEFAULT.totalEfficiency, citation: UH_FAN_DEFAULT.citation, digits: 2, min: 0.01, max: 1 },
    ] },
    { title: "Heating coil", inputs: [
      { key: "heating_coil_object_type", label: "coil", title: "the four coils the unit heater takes", options: [
        { v: "Coil:Heating:Electric", label: "electric — resistance (the default)" },
        { v: "Coil:Heating:Fuel", label: "fuel — gas, propane, oil" },
        { v: "Coil:Heating:Water", label: "hot water — refused: needs a hot-water ring (not written yet)" },
        { v: "Coil:Heating:Steam", label: "steam — refused: needs a steam loop (not written yet)" }], dflt: "Coil:Heating:Electric", note: (f) => (wetCoil(f) ? UH_WATER_REFUSAL : undefined) },
      { key: "fuel_type", cls: "Coil:Heating:Fuel", label: "fuel", when: (f) => coilCls(f) === "Coil:Heating:Fuel", dflt: "the file's — Propane when it names a propane tank, else NaturalGas", citation: "the boiler's rule: read from the file's equipment names", options: [
        { v: "NaturalGas", label: "natural gas" }, { v: "Propane", label: "propane" }, { v: "FuelOilNo1", label: "fuel oil no. 1" }, { v: "FuelOilNo2", label: "fuel oil no. 2" }, { v: "Diesel", label: "diesel" }, { v: "Gasoline", label: "gasoline" }, { v: "Coal", label: "coal" }, { v: "OtherFuel1", label: "other fuel 1" }, { v: "OtherFuel2", label: "other fuel 2" }] },
      // THE HEATER'S RATING (user, 2026-10-08: "Show garage heater at 3.8kW and report peak" — a 3.8 kW wall heater on its thermostat):
      // the coil's nominal capacity as the product states it; autosize = the engine sizes it to the zone's design day
      { key: "nominal_capacity", cls: "Coil:Heating:Electric", label: "capacity", title: "the heater's rated output — the product's nameplate; autosize = the engine sizes it to the zone's design heating load (the garage's came to 0 W: its design day sees the house's warmth and no infiltration). The run's peak heating rate shows below once it has run", dflt: "autosize", when: (f) => !wetCoil(f) },
      { key: "efficiency", cls: "Coil:Heating:Electric", label: "efficiency", title: "electric: every watt in is a watt out (1) · fuel: the burner's efficiency (the engine's 0.8)", dflt: (f) => (coilCls(f) === "Coil:Heating:Fuel" ? 0.8 : 1), citation: "electric 1 stated; fuel 0.8 the engine's default", digits: 2, min: 0.01, max: 1, when: (f) => !wetCoil(f) },
      { key: "maximum_hot_water_or_steam_flow_rate", label: "max water/steam flow", when: wetCoil, title: "through the coil; steam at 100 °C and 101325 Pa; autosize = the engine's", dflt: "autosize" },
      { key: "minimum_hot_water_or_steam_flow_rate", label: "min water/steam flow", when: wetCoil, digits: 5 },
      { key: "heating_convergence_tolerance", as: "slider", label: "convergence", title: "the tolerance of the coil's iteration on the heating load: it stops when its output is within this fraction of the load; the engine's default 0.001 — 1.0 accepts the first estimate", dflt: 0.001, citation: "the engine's default" },
    ] },
  ],
};

// ── the pumps (user, 2026-09-14): design · motor · pump · end use; the constant-speed pump the subset the schema gives it
const sizingMethod = (f: SystemFields): string => (typeof f.design_power_sizing_method === "string" && f.design_power_sizing_method ? f.design_power_sizing_method : "PowerPerFlowPerPressure");
const vfd = (f: SystemFields): string => (typeof f.vfd_control_type === "string" && f.vfd_control_type ? f.vfd_control_type : "");
const pumpSpec = (cls: "Pump:VariableSpeed" | "Pump:ConstantSpeed"): FormSpec => {
  const vs = cls === "Pump:VariableSpeed";
  return {
    cls,
    head: "on the supply inlet branch of the ring it is in — its nodes and branch assigned by the program; its zone from its Loc line",
    stated: ["inlet_node_name", "outlet_node_name"],
    groups: [
      { title: "Design", inputs: [
        { key: vs ? "design_maximum_flow_rate" : "design_flow_rate", label: "flow rate", title: "the pump's design flow; autosize = the loop's", dflt: "autosize" },
        { key: "design_pump_head", label: "pump head", dflt: 179352, citation: "the engine's default: 60 ft of water, for a fairly large building", digits: 0 },
        { key: "design_power_consumption", label: "power consumption", title: "at the design flow; autosize = from the sizing method below", dflt: "autosize" },
        { key: "design_power_sizing_method", label: "power sizing method", title: "how an autosized power is found: per flow (flow × the electric factor) or per flow per head (flow × head × the shaft factor ÷ the motor efficiency)", options: [
          { v: "PowerPerFlowPerPressure", label: "per flow per head — flow × head × the shaft factor ÷ motor efficiency (the default)" },
          { v: "PowerPerFlow", label: "per flow — flow × the electric factor" }], dflt: "PowerPerFlowPerPressure" },
        { key: "design_electric_power_per_unit_flow_rate", label: "electric power per flow", when: (f) => sizingMethod(f) === "PowerPerFlow", digits: 0, title: "the engine's default 348701.1 W per m³/s = 22 W/gpm" },
        { key: "design_shaft_power_per_unit_flow_rate_per_unit_head", label: "shaft power per flow per head", when: (f) => sizingMethod(f) !== "PowerPerFlow", digits: 3 },
        ...(vs ? [{ key: "design_minimum_flow_rate_fraction", label: "min flow sizing factor", title: "an autosized minimum flow is this fraction of the maximum", digits: 2, min: 0, max: 1 } as FormInput] : []),
      ] },
      { title: "Motor", inputs: [
        { key: "motor_efficiency", label: "efficiency", digits: 2, min: 0.01, max: 1 },
        { key: "fraction_of_motor_inefficiencies_to_fluid_stream", label: "inefficiencies to fluid", title: "the share of the motor's losses that warms the fluid", digits: 2, min: 0, max: 1 },
        ...(vs ? [
          { key: "coefficient_1_of_the_part_load_performance_curve", label: "part load C1", title: "fraction of full-load power = C1 + C2·PLR + C3·PLR² + C4·PLR³", digits: 4 },
          { key: "coefficient_2_of_the_part_load_performance_curve", label: "part load C2", digits: 4 },
          { key: "coefficient_3_of_the_part_load_performance_curve", label: "part load C3", digits: 4 },
          { key: "coefficient_4_of_the_part_load_performance_curve", label: "part load C4", digits: 4 },
        ] as FormInput[] : []),
      ] },
      { title: "Pump", inputs: [
        ...(vs ? [{ key: "design_minimum_flow_rate", label: "min flow rate", title: "the least flow while running; autosize = the sizing factor × the maximum", dflt: 0, citation: "stated by the generator", digits: 5 } as FormInput] : []),
        { key: "pump_control_type", label: "control", title: "Intermittent: the pump shuts down when the loop has no load · Continuous: it runs whenever available", options: [{ v: "Intermittent", label: "intermittent — off when the loop has no load" }, { v: "Continuous", label: "continuous — runs whenever available" }], dflt: "Intermittent", citation: "stated by the generator (the engine's own default is Continuous)" },
        { key: "pump_flow_rate_schedule_name", as: "schedule", label: "flow rate schedule", title: "modifies the rated flow on a time basis — the maximum available then, not the flow; blank = the pump runs by its loop's demand", schedule: { blank: "none — by the loop's demand", role: false } },
        { key: "end_use_subcategory", label: "end-use subcategory", title: "a category of your own in the End Uses by Subcategory table" },
        { key: "zone_name", as: "location", label: "zone", title: "the zone the pump's skin losses go to — join its Loc to a Zone; blank = outdoors, no losses modelled" },
        { key: "skin_loss_radiative_fraction", label: "skin loss radiant fraction", when: (_f, d) => !!d.zone, digits: 2, min: 0, max: 1, title: "the radiant share of the losses given to the zone; blank = all convective" },
      ], sub: [
        { title: "pressure simulation", rollup: true, note: "a pump curve, the impeller and the VFD are read only when a branch of the loop states a pressure drop — none does here", inputs: [
          { key: "pump_curve_name", as: "note", label: "pump curve", note: "none — no pressure simulation on this loop (a curve needs pressure-drop curves on its branches)" },
          { key: "impeller_diameter", label: "impeller diameter", digits: 3 },
          ...(vs ? [
            { key: "vfd_control_type", label: "VFD control", options: [{ v: "ManualControl", label: "manual — the rpm follows its schedule" }, { v: "PressureSetpointControl", label: "pressure setpoint — the rpm holds the head between the pressure bounds" }] },
            { key: "pump_rpm_schedule_name", as: "constant-schedule", label: "rpm", when: (f) => vfd(f) === "ManualControl", digits: 0, title: "held constant (written as a constant schedule)" },
            { key: "minimum_pressure_schedule", as: "constant-schedule", label: "pressure min", when: (f) => vfd(f) === "PressureSetpointControl", digits: 0 },
            { key: "maximum_pressure_schedule", as: "constant-schedule", label: "pressure max", when: (f) => vfd(f) === "PressureSetpointControl", digits: 0 },
            { key: "minimum_rpm_schedule", as: "constant-schedule", label: "rpm min", when: (f) => vfd(f) === "PressureSetpointControl", digits: 0 },
            { key: "maximum_rpm_schedule", as: "constant-schedule", label: "rpm max", when: (f) => vfd(f) === "PressureSetpointControl", digits: 0 },
          ] as FormInput[] : [{ key: "rotational_speed", label: "rpm", digits: 0 } as FormInput]),
        ] },
      ] },
    ],
  };
};


// ── THE HEAT-RECOVERY CORE (user, 2026-10-03: "each ERV requires its related input values for editing"): the static core on a unit's
// outdoor-air intake — HeatExchanger:AirToAir:SensibleAndLatent, written by epAssemble's outdoorAirSystem with its nodes, the mixer and
// the controller generated. Effectiveness at 100 % flow is the rating; the engine's own 75 % fields became the four optional curves in
// 26.1 (blank = the 100 % value at every flow). An HRV is the same core with no latent recovery.
export const HX_EXAMPLE = { sensible: 0.76, latent: 0.68, citation: "ExampleFiles/TermRhGenericOAHeatRecMinExh.idf, OA Heat Recovery 1" } as const;
const frost = (f: SystemFields): string => (typeof f.frost_control_type === "string" ? f.frost_control_type : "None");
const HX_CORE: FormSpec = {
  cls: "HeatExchanger:AirToAir:SensibleAndLatent",
  head: "the energy-recovery core on the unit's outdoor-air intake: its Air out runs to the unit's OA ‹ — the outdoor node, the exhaust side (the unit's relief air), the mixer and the outdoor-air controller are generated",
  stated: ["supply_air_inlet_node_name", "supply_air_outlet_node_name", "exhaust_air_inlet_node_name", "exhaust_air_outlet_node_name", "supply_air_outlet_temperature_control"],
  groups: [
    { title: "Core", inputs: [
      { key: "availability_schedule_name", as: "schedule", label: "availability", title: "the core recovers while the schedule reads > 0; blank = always", schedule: { blank: "always available", role: true } },
      { key: "heat_exchanger_type", label: "core type", title: "plate (fixed) or rotary (wheel); the engine's frost control differs between them", options: [
        { v: "Plate", label: "plate — a fixed core (the default)" }, { v: "Rotary", label: "rotary — an enthalpy wheel" }], dflt: "Plate" },
      { key: "nominal_supply_air_flow_rate", label: "supply air flow", title: "the outdoor air through the core; autosize = the unit's outdoor-air flow at design", dflt: "autosize" },
      { key: "nominal_electric_power", label: "power", title: "the core's own electric power (a wheel's motor); a plate core draws none — the unit's fan moves the air", dflt: 0, citation: "a static plate core: no motor", digits: 0, min: 0 },
    ] },
    { title: "Effectiveness at 100 % flow", note: "sensible and latent recovery, rated at the nominal flow; latent 0 = a heat-recovery ventilator (HRV)", inputs: [
      { key: "sensible_effectiveness_at_100_heating_air_flow", label: "sensible, heating", dflt: HX_EXAMPLE.sensible, citation: HX_EXAMPLE.citation, digits: 2, min: 0, max: 1 },
      { key: "latent_effectiveness_at_100_heating_air_flow", label: "latent, heating", dflt: HX_EXAMPLE.latent, citation: HX_EXAMPLE.citation, digits: 2, min: 0, max: 1 },
      { key: "sensible_effectiveness_at_100_cooling_air_flow", label: "sensible, cooling", dflt: HX_EXAMPLE.sensible, citation: HX_EXAMPLE.citation, digits: 2, min: 0, max: 1 },
      { key: "latent_effectiveness_at_100_cooling_air_flow", label: "latent, cooling", dflt: HX_EXAMPLE.latent, citation: HX_EXAMPLE.citation, digits: 2, min: 0, max: 1 },
    ] },
    { title: "Frost control", rollup: true, inputs: [
      { key: "frost_control_type", label: "frost control", title: "how the core avoids frosting in cold weather", options: [
        { v: "None", label: "none (the default)" },
        { v: "ExhaustAirRecirculation", label: "exhaust-air recirculation — the supply side takes exhaust air while defrosting" },
        { v: "ExhaustOnly", label: "exhaust only — the supply air bypasses or stops while defrosting" },
        { v: "MinimumExhaustTemperature", label: "minimum exhaust temperature — the supply is bypassed to hold the exhaust above the threshold" }], dflt: "None" },
      { key: "threshold_temperature", label: "threshold", title: "the outdoor (or exhaust) temperature below which frost control acts", when: (f) => frost(f) !== "None", dflt: 1.7, digits: 1 },
      { key: "initial_defrost_time_fraction", label: "initial defrost fraction", when: (f) => frost(f) === "ExhaustAirRecirculation" || frost(f) === "ExhaustOnly", dflt: 0.083, digits: 3, min: 0, max: 1 },
      { key: "rate_of_defrost_time_fraction_increase", label: "defrost fraction increase", title: "per kelvin below the threshold", when: (f) => frost(f) === "ExhaustAirRecirculation" || frost(f) === "ExhaustOnly", dflt: 0.012, digits: 3, min: 0 },
    ] },
    { title: "Economizer", rollup: true, inputs: [
      { key: "economizer_lockout", label: "economizer lockout", title: "Yes: recovery stops while an air-side economizer runs; the units here have none, so No (the generator's) keeps the core recovering", options: [
        { v: "No", label: "no — the core always recovers (the generator's)" }, { v: "Yes", label: "yes — locked out while the economizer runs" }], dflt: "No" },
    ] },
  ],
};
export const FORMS: readonly FormSpec[] = [HX_CORE, UNIT_HEATER, pumpSpec("Pump:VariableSpeed"), pumpSpec("Pump:ConstantSpeed"), VERTICAL, SLINKY, POND, SURFACE, TRENCH, FLUID];
export const formOf = (cls: string): FormSpec | null => FORMS.find((s) => s.cls === cls) ?? null;

/** every input of a spec, flattened, with the group it is in */
export function formInputs(spec: FormSpec): Array<{ input: FormInput; group: string }> {
  const out: Array<{ input: FormInput; group: string }> = [];
  const walk = (g: FormGroup, path: string): void => { for (const i of g.inputs) out.push({ input: i, group: path }); for (const s of g.sub ?? []) walk(s, `${path} › ${s.title}`); };
  for (const g of spec.groups) walk(g, g.title);
  return out;
}
/** the keys a class's form knows — what a card keeps when its class changes to another form's (the shared soil, pipe and flow numbers) */
export const formKeys = (spec: FormSpec): Set<string> => new Set(formInputs(spec).map((x) => x.input.key));

/** THE OPTIONS OFFERED FOLLOW THE INSTALLED ENGINE (2026-09-23): a form's choices are written in the user's words once, and the ones the
 *  installed engine's enum does not take are left out — 26.1 dropped "HeatRecovery" from the fluid-to-fluid exchanger's metering end use
 *  (split into …ForCooling / …ForHeating), and a choice the engine refuses must never be offered. `optionsNotOffered` names them for the gate */
export function optionsFor(i: FormInput, f: EpField | null | undefined): FormOption[] {
  const opts = i.options ?? [];
  return f?.enum ? opts.filter((o) => f.enum!.includes(o.v)) : opts;
}
export function optionsNotOffered(spec: FormSpec, schema: EpSchema): string[] {
  const out: string[] = [];
  for (const { input: i } of formInputs(spec)) {
    const f = schema.fieldsOf(i.cls ?? spec.cls).find((x) => x.key === i.key);
    for (const o of i.options ?? []) if (f?.enum && !f.enum.includes(o.v)) out.push(`${spec.cls} "${i.key}" ${o.v}`);
  }
  return out;
}

/** THE CHECK the gate runs: every key a field of its class (or a card key); the options offered, the engine's own enum; nothing the program assigns
 *  offered (a node, a name, a reference — a schedule and the Loc'd zone aside); every required field of the class shown, assigned or stated */
export function checkForm(spec: FormSpec, schema: EpSchema, isAssigned: (f: EpField) => boolean): string[] {
  const bad: string[] = [];
  const c = schema.classOf(spec.cls);
  if (!c) return [`${spec.cls} is not in the schema`];
  const seen = new Set<string>();
  for (const { input: i, group } of formInputs(spec)) {
    const cls = i.cls ?? spec.cls;
    if (CARD_KEYS.includes(i.key)) { seen.add(i.key); continue; }
    const f = schema.fieldsOf(cls).find((x) => x.key === i.key);
    if (!f) { bad.push(`${spec.cls} › ${group}: "${i.key}" is not a field of ${cls}`); continue; }
    if (cls === spec.cls) seen.add(i.key);
    if (isAssigned(f) && i.as !== "schedule" && i.as !== "location" && i.as !== "note" && i.as !== "constant-schedule") bad.push(`${spec.cls} › ${group}: "${i.key}" is assigned by the program and must not be offered`);
    if (i.options && f.enum && !optionsFor(i, f).length) bad.push(`${spec.cls} › ${group}: "${i.key}" offers none of the engine's ${f.enum.join(" · ")}`);
    if (i.options && !f.enum) bad.push(`${spec.cls} › ${group}: "${i.key}" offers a choice but the engine's field is not an enum`);
  }
  for (const f of c.fields) {
    if (!f.required || f.key === "name") continue;
    if (seen.has(f.key) || isAssigned(f) || (spec.stated ?? []).includes(f.key)) continue;
    bad.push(`${spec.cls}: required "${f.key}" is neither shown, assigned nor stated`);
  }
  return bad;
}

/** the determination, written out (references/component-inputs.md): per class, its groups and inputs with the engine's field, units and default */
export function formDoc(specs: readonly FormSpec[], schema: EpSchema, isAssigned: (f: EpField) => boolean): string {
  const lines: string[] = ["# The components' inputs — determined per class", "",
    "Generated by `pnpm gate:bem` from `bem/core/componentForms.ts` (the specs the SYSTEMS column renders). Per class: the groups (a roll-up is collapsed until opened), each input with the engine's field it writes, its units and default, and what is shown only under a condition; then the fields the program assigns and never shows, and the required fields the generator states. The water-to-air heat pump's form is the hand-written one of the same morning (`HeatPumpInputs`).", ""];
  for (const s of specs) {
    const c = schema.classOf(s.cls);
    lines.push(`## ${s.cls}`, "", s.head + (s.refused ? ` — **refused on the sheet**: ${s.refused}` : ""), "");
    const walk = (g: FormGroup, depth: number): void => {
      lines.push(`${"#".repeat(Math.min(3 + depth, 6))} ${g.title}${g.rollup ? " (roll-up)" : ""}${typeof g.note === "string" ? ` — ${g.note}` : ""}`, "");
      lines.push("| input | engine field | units | default | when |", "|---|---|---|---|---|");
      for (const i of g.inputs) {
        const cls = i.cls ?? s.cls;
        const f = CARD_KEYS.includes(i.key) ? null : schema.fieldsOf(cls).find((x) => x.key === i.key) ?? null;
        const dflt = typeof i.dflt === "function" ? "by rule" : i.dflt !== undefined ? `${i.dflt}${i.citation ? ` (${i.citation})` : ""}` : f?.default !== null && f?.default !== undefined ? `${f.default} (the engine's)` : f?.autosizable ? "autosize" : "blank";
        const kind = i.as ?? (f?.enum ? "choice" : f?.kind ?? "card");
        lines.push(`| ${i.label ?? f?.label ?? i.key} | ${cls === s.cls ? "" : `${cls} · `}\`${i.key}\` (${kind}${i.options ? `: ${i.options.map((o) => o.v).join(" · ")}` : ""}) | ${f?.units ?? ""} | ${dflt} | ${i.when ? "conditional" : ""} |`);
      }
      lines.push("");
      for (const sub of g.sub ?? []) walk(sub, depth + 1);
    };
    for (const g of s.groups) walk(g, 0);
    if (c) {
      const assigned = c.fields.filter((f) => isAssigned(f) && f.key !== "name").map((f) => `\`${f.key}\``);
      const shown = formKeys(s);
      const left = c.fields.filter((f) => !isAssigned(f) && f.key !== "name" && !shown.has(f.key)).map((f) => `\`${f.key}\`${f.required ? " (required, stated)" : ""}`);
      lines.push(`Assigned by the program, never shown: ${assigned.join(", ") || "none"}.`, "", `Left to the engine's default${left.some((x) => /stated/.test(x)) ? " or stated by the generator" : ""}: ${left.join(", ") || "none"}.`, "");
    }
  }
  return lines.join("\n");
}
