<!--
THE EXPLAIN TEXTS — first pass, 2026-10-15, for review and editing.

How this file is read (src/explain/explainText.ts):
- "# Region" starts a region: Top bar, Rail, Levels and spaces, View, Frame, Right column.
- "## match" starts an entry. The entry is shown when the hovered header's text STARTS WITH `match` (case is ignored).
  "TAB › match" limits an entry to one tab: BIM, SITE, CONSTRUCTIONS, SCHEDULES, ZONES, SYSTEMS, RUN, BOM.
  The longest match wins. "## *" is the region's general text, shown when nothing else matches.
- Under an entry: paragraphs, "- " lists, **bold** and `code`. Blank lines separate paragraphs.
Save the file and the dialog's text updates; the model is not reloaded.
-->

# Top bar

## *
The bar across the top of the window: what the whole program works on, whatever module is open.

- **Open IFC…** opens the building's IFC file. Every module reads from it.
- **fill** sets how opaque the model's surfaces are drawn.
- **surface tables** shows or hides the frame of tables under the view.
- **spaces** draws the rooms (IfcSpace volumes) in the view.
- **terrain** (or **shading** on SITE's solar view) draws the files beside the building: the site's terrain and shading elements.
- The grey text is the program's **status**: what it is doing, or did last.
- **hidden · show all** appears when you have hidden elements, and shows them again.
- **Show Metric / Show Imperial** switches every number you read or type between feet and metres.
- **Explain** turns this help on: hover over a section's header to read about it here. Click it again to turn the help off.
- The **gate** mark (✓ or ✗) reports the last check of idf.db against the file.

# Rail

## *
The module rail: the three modules, in the order the work flows.

- **BIM** — the building information model. Reads the IFC and writes `ifc.db` and `idf.db`: each assembly collapsed to the single plane EnergyPlus takes, carved by room.
- **BEM** — the building energy model. Builds the EnergyPlus model from `idf.db` and your rulings, runs it, and reads the results into `bem.db`.
- **BOM** — the building operations model. Prices the run with the tariff and compares it with the bills and the PV production, in `bom.db`.

The dot beside each module says whether its file is **ok** (built from the current file before it), **stale** (the file before it has changed since) or **absent** (not built yet). Click a module to open its first tab.

# Levels and spaces

## *
LEVELS · SPACES lists the building as the IFC file organises it: each level (IfcBuildingStorey) with its elevation, and under it the spaces (IfcSpace) it holds.

- Click a level or a space to select it; the view lights it, and the frame below the view shows its details.
- The **eye** shows or hides a level or a space in the view.
- The **swatch** is the colour the space is drawn in, the same in every view.
- Attic voids under the roof are listed as their own rows. Every roof is insulated, so every void under one is inside the envelope.
- On SYSTEMS and ZONES, dragging a room onto the sheet takes it **out of the Zone it was in**: a room belongs to one zone.

# View

## *
The view: the drawing in the centre of the window. The tabs above it pick what it draws; the frame under it holds the facts and tables for what you select.

Views are drawings only — tables and settings stay in the frame and the right column.

## IFC — FRAGMENTS
The IFC file drawn as the authoring tool exported it: every wall, slab, roof, window and door with its true thickness.

On BIM this is the left half of a split view, beside IDF-DB. Click the tab to collapse or show this half; the other half then takes the width.

- Click a surface, a room or a level to select it; the frame under the view names it.
- Drag to orbit; the tools at the right end of the tab row turn the view to a side or zoom it.

## IDF-DB — SINGLE PLANE
`idf.db` drawn: each assembly collapsed to the single plane EnergyPlus takes, carved by room. This is the geometry the energy model is built from.

On BIM this is the right half of a split view, beside the IFC. Click the tab to collapse or show this half.

- Selecting a surface in either half selects it in both, so you can check the plane against the file's element.

## ENERGY & COST
BOM's view: the run's months against the bills, priced by the tariff applied in UTILITY (the frame below).

## SITE · the project location
The site on the map, at the position the IfcSite states or the one you located. Confirm the position here; the frame says which is in force.

## SITE · the weather stations
Every weather station near the site with a typical-year weather file, for picking the one the run uses. Click a station to download its files into `Weather/`; the frame below lists what is installed and which file is in force.

## IDF-DB — SITE · terrain
The model with the site around it: the terrain, the shading elements and the sun's position for the day and hour set in the right column's solar studies.

## IDF-DB — SITE · the model
The model with the files beside the building (the site and shading IFCs) as the energy model sees them. The frame below lists the files; a checkbox shows or hides one.

## PLAN
CONSTRUCTIONS' plan: the model from above, each cell painted by the file's type, or by what governs it (the code, the library or the file's own value). Click a cell to select its type.

## DETAIL
The selected construction type's assembly, drawn to scale from the file's own layers, with the U-factor the governing construction gives it. The frame below is its materials table.

## CALENDAR
The run's year as a calendar, painted by the schedule of the card selected in the right column — which days of the year, and which hours of each day, the schedule applies to. Click a month, a week or a day to go in; double-click to go back out.

The frame under it holds that schedule's **daily** values for the part picked (All Days, Weekdays, Weekends, Holiday, a season, or a design day).

## IDF-DB — ZONES
The model alone, without the site, each room painted by the Zone it belongs to on the SYSTEMS sheet. Rooms in no zone are grey.

## ASSEMBLY
The systems sheet, where a system is **assembled**: drag components from the bench under the view onto the sheet — MECHANICAL heat pumps, fans, coils, pumps and loops; ELECTRICAL PV arrays, inverters and load centres; PLUMBING water heaters and hot-water uses — and link them together: drag from one connector to another, or right-click a connector and choose **Connect to …**. The connectors are typed (water, air, location), so only compatible ones join.

Select a component to edit its EnergyPlus inputs in the right column. A red mark on a card names what is missing; hover over it. **Save** in the right column writes the sheet into the model.

## GRAPHS · ANNUAL
The run's year graphed: outside temperature, heating and cooling, ventilation, occupant loads, PV, bought and sold. The **checkboxes** pick which lines are drawn; the slider and scroll bar set the window of time (a day, a week, a month, the year).

To sum over a range: **left-click** the graph to set the first point and **right-click** to set the second. The frame below the graph sums each line drawn over that range — or at the single point, with one click. Clicking the same point again clears it.

## GRAPHS · PEAK
Peak conditioning on the design days, per structure and per zone. The frame below picks the parts.

## REPORT · ENGINE
EnergyPlus's own tabular report (`eplustbl.htm`) for the run, as the engine wrote it: end uses, component loads, sizing, envelope. A run that ended Fatal shows its error file instead.

## SURFACE TEMPERATURES
The model painted by each exposed surface's **external** (outside face) temperature — EnergyPlus's Surface Outside Face Temperature — on the winter or summer design day. It shows where the envelope runs cold or hot: areas of concern, and the effect of shading, both from the landscape (trees) and from installed systems (PV panels over the roof).

# Frame

## *
The frame: the panel under the view, holding the facts and tables for what the view shows and what you selected. Drag the line between the view and the frame to give either more height.

## IFC ·
The selected IFC element: its id, and the cell of it you clicked. Select a surface, a room or a level in the view to see it here.

## IDF-DB ·
The selected room in `idf.db`: its surfaces with their net areas (openings taken out), in the units you chose.

## LOCATION ·
The project site: the position the IfcSite states, and whether a position you located on the map is the ruling in force.

## WEATHER FILES ·
The weather file in force, the project's climate zone (from the county the site falls in) and the stations installed in the engine's WeatherData.

## SITE ·
The site files beside the building: which are projected into the model, and the trees' shade for the month shown. A checkbox shows or hides a file or a kind; right-click a file or an item to project it, hide it, delete it from the model, or turn the file.

## CONSTRUCTIONS ·
The construction types: what governs each one (the code, the library or the file's value), and on DETAIL the materials table of the selected type.

## SCHEDULES ·
The **daily schedule** of the card selected in the right column: its 24 hourly values, as applied for the part picked over the bars — **All Days**, **Weekdays**, **Weekends**, **Holiday**, **Seasonal** (a summer or winter season you set), **Summer DD** or **Winter DD** (the design days used to size the equipment).

The calendar above shows where in the year each part applies: click a month, a week or a day to go in, double-click to go back out. Editing a bar makes a custom copy of the schedule, which you name and save to your own library.

## ZONES ·
The selected zone's settings — occupancy, envelope, lighting, loads. Every room in the zone takes them; a room's own ruling overrides its zone's. Pick a zone in the right column, or a room in the view.

## OCCUPANCY
The zone's people: how many, their activity, and the schedule they follow.

## ENVELOPE
The zone's envelope: infiltration and the surfaces that bound it.

## LIGHTING
The zone's lighting power and its schedule.

## LOADS
The zone's plug and process loads, and any overrides of the defaults.

## SYSTEMS ·
The systems sheet's components: how many are on the sheet and whether any were refused by the writer. Below it, the bench: the components you drag onto the sheet, by shelf.

## ZONE EQUIPMENT
Bench shelf: equipment that serves a zone directly — a heat pump unit, an ERV, a baseboard.

## AIR LOOP
Bench shelf: the parts of a ducted air system — fans, mixers, the loop's controls.

## COILS
Bench shelf: heating and cooling coils, placed in a unit or a loop.

## PLANT LOOP
Bench shelf: the water side — pumps, ground heat exchangers, pipes.

## RESOURCE
Bench shelf: supporting objects — schedules, curves, the ground.

## GENERATION
Bench shelf: PV arrays and other generators.

## INVERTERS
Bench shelf: the inverters between the PV and the building's power.

## DISTRIBUTION
Bench shelf: load centres and the utility connection.

## WATER HEATERS
Bench shelf: tanks and heat-pump water heaters.

## HOT-WATER USE
Bench shelf: the uses the water heaters supply — sinks, showers, appliances.

## DOMESTIC WATER
Bench shelf: the cold-water supply and its mains temperature.

## RUN ·
The graph's settings and sums: for ANNUAL, each line drawn summed over the window in view and over the range or point picked on the graph; for PEAK, the parts and loads drawn. The run named is the one shown.

## BOM ·
BOM's frame, by its rail: UTILITY (the tariff cards), WEATHER (the weather the run used, and an actual year) or BILLS (the bills imported).

## UTILITY
The tariff cards: select one for its charges, its power cost adjustment and Apply, in the right column. The **Sample** card prices the run until you apply a card of your own. It holds example values of a residential rate with net metering, not any utility's.

## WEATHER
The weather the run used, and the **calibration-year** (actual-year) weather file, made here for the bills' period:

- **Measured hours** — temperature, dew point, pressure and wind — from NOAA's hourly station archive (GHCNh) for the nearest reporting station to the site (one with an ICAO or WMO id, within 150 km).
- **Sun, sky and rain** at the site from the Open-Meteo historical archive. **Open-Meteo's free API is for non-commercial use only**: for paid work, use an actual-year weather file you have the right to use, with **Run on my own weather file…** on the calibration card.
- **Gaps** in the station's record: short ones are filled from the neighbouring hours; gaps longer than 6 hours are filled from the archive's own values, and every fill is counted in the file's comments.
- The **header** — location, design conditions, ground temperatures — and the design days come from the typical-year file; every hour is in local standard time.

The file is saved in `Weather/` and used for the calibration run. The archive trails today by about six days, so the period must end before then.

## BILLS
The utility bills you entered or imported, month by month.

# Right column

## *
The right column: the selected module's tabs and the inputs and rulings for that tab. Each input is typed in one place only, and shown read-only everywhere else.

Sections fold: click a header to open or close it; the program remembers which are open. Drag the column's left edge to make it wider.

## IDF-DB EDITING
BIM's one tab: how the IFC's elements become `idf.db`'s planes, and the corrections you rule on.

## SITE
BEM's first tab: the building type, the location, the weather file, the design days, the run period, the ground and the simulation settings.

Changes on this tab are **staged** first: they show in amber, are kept on disk as you work, and change nothing in the model. Clicking **Apply** commits them to `idf.db` — the record the EnergyPlus input file is written from — and the model is rebuilt from it. **revert** drops what is staged.

## CONSTRUCTIONS
A construction for each kind of surface: the file's own U-values, the library's constructions, or the code's defaults.

Changes on this tab are **staged** first: they show in amber, are kept on disk as you work, and change nothing in the model. Clicking **Apply** commits them to `idf.db` — the record the EnergyPlus input file is written from — and the model is rebuilt from it. **revert** drops what is staged.

## SCHEDULES
The schedules each role runs on (occupancy, lighting, equipment, thermostat…): the engine's own **reference** schedules, or **custom** schedules of your own — an edited copy saved to your library. Which days of the year a schedule applies to is shown in the calendar view and the frame under it.

Changes on this tab are **staged** first: they show in amber, are kept on disk as you work, and change nothing in the model. Clicking **Apply** commits them to `idf.db` — the record the EnergyPlus input file is written from — and the model is rebuilt from it. **revert** drops what is staged.

## ZONES
What each zone runs on — conditioning, thermostat, infiltration, people and loads — and which rooms each zone holds.

Rooms are assigned to zones by right-clicking a room that is in no zone (in LEVELS · SPACES, on any tab) and picking a zone from the list. Zones themselves are created and deleted on **SYSTEMS › MECHANICAL** (see the zone cards' header below). The zone settings are saved with **Save**; the room gains (people, lights, equipment, the **Bed** ticks) are staged and applied with **Apply gains** to `idf.db`, the record the EnergyPlus input file is written from.

## SYSTEMS
The mechanical, electrical and plumbing systems. Each is **assembled in the view**: drag components from the bench under the view onto the sheet, and link their connectors — drag from one connector to another, or right-click a connector and choose **Connect to …** — to define the system. Select a component on the sheet: its EnergyPlus inputs are shown in this column for editing.

The sheet is saved with **Save · n changes**, which writes it — and the system it compiles to — into `idf.db`, the record the EnergyPlus input file is written from; **revert** puts the drawing back to the saved one.

## RUN
Build the model, check it, run EnergyPlus, and read the results.

The model the run uses is the one applied on the other tabs; what is still staged there is named here and is not in the run.

## OPERATIONS
BOM's one tab: the tariff, the bills and the PV, and the calibration year.

## MECHANICAL
SYSTEMS' mechanical sheet: heating, cooling and ventilation, assembled from the bench.

## ELECTRICAL
SYSTEMS' electrical sheet: power, lighting and generation (PV).

## PLUMBING
SYSTEMS' plumbing sheet: domestic hot water and domestic water.

## BIM › project
The project this IFC belongs to (its IfcProject) and its versions. Your rulings follow the project from one version of the file to the next.

## BIM › file changed
The IFC changed since your rulings were made: the changes found, and the rulings that need you to decide whether they still apply.

## BIM › single surface placement
Where each kind of assembly's single plane is placed — at the inside face, the centre or the outside face — by category. "matched" means the planes are matched across rooms.

## BIM › storey alignment QA
The storey alignment QA lists every place where a wall stands over a wall on the storey below, **parallel but offset** — a foundation wall under a framed wall, for example. Two parallel planes have no line of intersection, so the program cannot join them by itself and invents nothing: each pair is your ruling. Click a row to light the walls in the views.

- **Keep (strip between)** — both walls stay where the file put them. A horizontal strip, whose four corners are the two walls' own vertices, closes the offset and meets both walls exactly. The envelope gains that small ledge as a surface; no wall moves and no room changes size.
- **Align to upper** — the LOWER wall's whole plane slides onto the upper wall's. The wall below leaves the coordinates the file authored; the rooms behind it gain or lose floor area and volume (the offset × the wall's length), and the floor edges and partitions that meet it follow it, since the program solves them after the ruling. No strip is needed.
- **Align to lower** — the UPPER wall's plane slides onto the lower one's, with the same effects on the rooms above.

Choose **Keep** when the offset is real (a thicker wall below, a real ledge); choose an **Align** when the offset is a drafting difference that should not be in the energy model. Rulings are staged; **Apply** applies them, before any other correction (an alignment moves a whole plane). **set all** rules every row at once. Each ruling is kept with the file and listed under **corrections**, where it can be restored.

## BIM › wall QA
The wall QA checks every exposed exterior wall plane on its four boundaries — the top, the bottom and the two ends — and says whether each is sealed against what it should meet. The header counts the walls with a **gap**.

The table, one row per wall: **dir** the way it faces (on the project grid) · **above** and **below** its area above and below grade (against fill named) · **lost** authored length the wall lost from its exterior face · **gap** its widest open boundary · **open boundary → meets** which boundaries are open and what each should meet. A bottom open at ground level, meeting nothing, is not a defect.

To correct a gap:
- Click the row: the wall lights in the views.
- In the IDF-DB view, right-click the wall and choose **Select Extend to Surface**, then click the surface it should reach (a roof, a slab, the wall at the corner). The wall's facing edge moves onto the line where the two planes meet; the wall stays in its own plane. The target must actually cover that place, or the move is refused and said.
- **Undo Last**, at the foot of the same menu, takes back the last extension. Every extension is kept with the file and listed under **corrections**, where it can be restored.
- A gap between stacked walls is ruled in the **storey alignment QA** instead.

## BIM › spaces
The spaces QA lists every zone the model will have: each room (IfcSpace) the file names, and each attic or floor void the program builds over a room with a roof or floor above it. It checks whether each zone is **enclosed** — EnergyPlus's own test: every edge of every surface shared by exactly two of the zone's surfaces. The header counts the zones that are closed.

The table: **assign to** · **zone** (✓ when closed) · **surfaces** the number that bound it · **closed %** the share of its boundary that is shared · **gap** (in your units) open length with a parallel edge of the same zone close by — the two sides of one gap, usually a wall or floor thickness · **missing** (in your units) open length with no counterpart — a surface the zone does not have, such as a missing ceiling. Click a row to light the zone's surfaces.

EnergyPlus runs a zone that is not enclosed, with a warning; the QA shows where the boundary is open. To correct:
- **assign to** merges a zone into another — a stair or a corridor into the room it opens to, a void into its room; the surfaces between them become that zone's internal partitions. Staged in amber; **Apply** applies.
- **Extend Space to Space**: with **spaces** on in the top bar, right-click a room's face in a view and choose **Select Extend Space to Space**, then click the face of the room it should meet. The room's face moves to the other's; the room stays a closed solid.
- Gaps that come from walls are corrected in the **wall QA** (Extend to Surface).
- A **?** beside a space's name in LEVELS · SPACES asks where an attic's insulation is; right-click it to answer.

## BIM › corrections
Your corrections to the file: placement choices, edits to elements and spaces, glazing and void rulings. A ⚠ marks a correction that failed.

## SITE › location
The site's latitude, longitude and elevation from the IfcSite, or the position you located on the map.

## SITE › building type
The kind of building being modelled. It decides the inputs that follow: **Residential**, for example, marks bedrooms (the **Bed** checkboxes on ZONES), which set the whole-house ventilation rate, the occupants and the hot-water use.

Only **Residential** is active now. Commercial, Industrial, Healthcare, Laboratory and Other are listed greyed until their inputs are built.

## SITE › weather file
The typical-year weather file the run uses (`.epw`), from EnergyPlus's weather repository on the station map, or a file you picked. **Find…** opens the station map; **Browse…** picks a file.

## SITE › design days
The design days the `.ddy` beside the weather file states, and the ones picked for sizing the equipment.

## SITE › run period
The days of the year the run covers.

## SITE › ground temperature
The ground temperatures under the building's floors and walls, by month, and where they come from.

## SITE › solar studies
Turns on the site view with the terrain, the shading elements and the sun, for a month, day and hour you set.

## SITE › simulation
The engine's settings: timesteps per hour, the shadow calculation, the terrain and the solar distribution. The code defaults govern until you rule otherwise.

## SITE › energy code
The energy code your project is under: its edition and the climate zone your county's row in the code states, which you enter. Until you choose one, the project reads the **DOE/PNNL prototype values** that ship with Enthalix, for the 2021 IECC; **Choose…** offers every edition from 2006 to 2024. They are public domain, and hovering on the code's name shows the notice acknowledging DOE and PNNL. They are the prototypes' values, not a state's code. **Choose…** also has **Find…**, which opens the code adopted by your state and county in your browser, and **Edit values…**, which opens a table where you enter your own code's values, with the table or section of the code each is from: each U-factor, the SHGC, slab insulation, air leakage and the reference thermostat. You can also copy a prototype edition and change what differs. Your values are kept in `data/energy-codes/`. The code's values govern every input you have not ruled. If a code of your own is missing a value, the model is still built, so ZONES, SCHEDULES and SYSTEMS can be set up, but it cannot run, and RUN names the missing values.

## CONSTRUCTIONS › Roof
The roof's construction types (skylights included), with the area of each and what governs its U-factor.

## CONSTRUCTIONS › Ceiling
Ceilings between a space and an attic void above it.

## CONSTRUCTIONS › Wall
The wall construction types.

## CONSTRUCTIONS › Window
The window types: U-factor, SHGC and VT, from the file, the library or the code.

## CONSTRUCTIONS › Door
The door types, and the share of glass in each.

## CONSTRUCTIONS › Floors
The floor types, those on the ground included.

## SCHEDULES › assignment
The schedule each role runs on: the code default until you pick one of the engine's own schedules.

## SCHEDULES › library
The engine's own schedules, read from its files. Pick one for a role above.

## ZONES › ZONES ON THE SYSTEMS SHEET
The zones drawn on the SYSTEMS sheet, one card each, with the rooms it holds. Click a card for its settings in the frame below the view.

- **Creating a zone**: on SYSTEMS › MECHANICAL, drag a **Zone** card from the bench's ZONE EQUIPMENT shelf onto the sheet, or drag a room from LEVELS · SPACES onto an empty part of the sheet (that makes a zone holding it).
- **Deleting a zone**: right-click its card on the sheet and choose **Remove**; its rooms return to no zone.
- **Assigning rooms**: right-click a room that is in no zone (in LEVELS · SPACES, on any tab) and pick the zone; or drag the room onto the zone's card on the sheet. Right-click a room in a zone to **Un-assign** it.
- **Bed** (residential): tick each room that is a bedroom. The bedrooms set the whole-house ventilation rate (ASHRAE 62.2: bedrooms + 1), count in the occupants (Building America, 2014) and in the hot-water use of the dwelling (30 + 10 × bedrooms gal/day). Rooms named "Bed n" start ticked. Ticks are applied with **Apply gains**.

## SYSTEMS › system QA
Checks of the assembled systems: what is connected, what is missing, and what the writer would refuse.

## SYSTEMS › MECHANICAL
The selected component's settings. The code default governs each subsection until it is ruled; the engine's fields are read-only until then.

## SYSTEMS › ELECTRICAL
The electrical sheet: power, lighting and generation.

## SYSTEMS › PLUMBING
The plumbing sheet: domestic hot water and domestic water.

## RUN › the model, as written
The EnergyPlus input file as written from `idf.db` and your rulings: its zones, surfaces and lines.

## RUN › checks
Checks of the model as built: rules that pass, items to look at, and notes.

## RUN › run
Runs EnergyPlus on the model with the weather file in force. The last run's result is shown as Fatal / Severe / Warning counts.

## RUN › results
The annual energy by fuel and end use, from the last run.

## RUN › peak demand
The peak demand for each fuel and when it happened, and the design loads.

## RUN › unit sizing
The engine's own sizing of each unit and coil.

## RUN › runs
Every run on record, by date.

## BOM › BOM · OPERATIONS
BOM's column, step by step. **Print / Save PDF…** prints the tariff, the bills against the model and the months' cost.

## BOM › 1 · schedules
The operating schedules. For now the run uses the code's thermostat all year.

## BOM › 2 · tariff
The tariff and the PV. Select a tariff card in UTILITY (frame below) for its charges. Until you apply one, the Sample card prices the run. **Search…** finds the utility that serves the site, in your browser: the U.S. Utility Rate Database (OpenEI) for the ZIP code, and a web search for the county's utility. Enter its schedule as a card of your own (`data/tariffs/tariff.json`). The PV is on BEM › SYSTEMS › ELECTRICAL.

## BOM › 3 · bills
The bills: typed from the statement or imported as CSV, the weather they are compared under, and **Compare with the run**.

## BOM › 4 · calibration
The calibration year: the model run on that year's **actual weather** (a calibration-year file made from the station's measured hours and the archive's sun and sky — see WEATHER in the frame below) and compared with the bills by ASHRAE Guideline 14's statistics (CVRMSE and NMBE).

## BOM › against BEM's run
The typical-year run compared with the bills. This is a comparison, not a calibration: a typical year's weather is not the bills' weather.

## BOM › power cost adjustment
The power cost adjustment, typed from a bill: it changes month to month, so the tariff takes it from the bill.

## BOM › net metering
How the PV's exported energy is credited under the tariff's net-metering schedule.
