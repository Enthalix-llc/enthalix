# Setting up Enthalix

Enthalix is a public preview, run from source. It is developed and tested on
macOS (Apple silicon) with EnergyPlus 26.1.

You install each part yourself, from its own publisher and under its own terms.
To see what is installed and what is missing, run this in `program/`:

```bash
pnpm setup:check
```

The check only reads; it installs nothing.

## 1. The software

| Part | Where to get it | Notes |
| --- | --- | --- |
| Node.js 22 or newer | [nodejs.org](https://nodejs.org/) | |
| pnpm | [pnpm.io](https://pnpm.io/installation) | |
| EnergyPlus 26.1 | [EnergyPlus releases](https://github.com/NatLabRockies/EnergyPlus/releases) | Enthalix finds an installation in `/Applications`. To use another one, set `ENERGYPLUS` to its `energyplus` program. |

Then, in a copy of this repository:

```bash
cd program
pnpm install
pnpm dev
```

The first `pnpm dev` downloads Electron's binary.

## 2. A building

Use BIM › Open IFC… to open an IFC file. To try the program, open the sample
building `samples/Duplex_A_20110907.ifc` (see `samples/README.md` for its source
and licence).

Enthalix reads the rooms (IfcSpace), the walls, slabs, roofs, windows and doors,
and the site's position (IfcSite). A room-based model from an architect's
authoring tool works best.

## 3. Weather

In BEM › SITE, under "weather file", click "Find…". The map shows every location in
EnergyPlus's own weather repository
([energyplus.net/weather](https://energyplus.net/weather)). Click the station
nearest the site, and the app downloads its files into `Weather/`. Some data
sets in that repository have their own licence; the
[sources page](https://energyplus.net/weather/sources) says which.

You can also use "Browse…" to pick any `.epw` file, or put one with its `.ddy`
beside it in `Weather/`.

## 4. The energy code

Enthalix ships the DOE/PNNL residential prototype values for each IECC
edition (2006 to 2024), so a model runs from the start; a project reads the
2021 edition until you choose another. They are the prototypes' values, not a
state's code (see `references/energy-codes/README.md`). To use the code your
project is under as the code states it, enter its values:

1. Read the code; the IECC is free to read at
   [codes.iccsafe.org](https://codes.iccsafe.org/).
2. In BEM › SITE › energy code, click **Choose…**, then **Edit values…**. Give the code an id
   and a name, pick your climate zone's row, and enter each value with the
   table or section it is from. Save writes `data/energy-codes/`; the CSV
   format is in `references/energy-codes/README.md`, if you prefer to edit
   the files directly.
3. Click **Choose…**, choose the edition, enter the climate zone that your
   county's row in the code's table (IECC Table R301.1) states, and click Use.

If a code of your own is missing a value, the model is still built, so you can
set up zones, schedules and systems, but it cannot run, and the app names the
values that are missing.

## 5. Costs and calibration (optional)

- **Tariff:** copy `references/tariffs/tariff.template.json` to
  `data/tariffs/tariff.json` and fill it in from your utility's published rate
  schedule (`references/tariffs/README.md`).
- **Bills and PV:** type your bills in BOM, or import them as CSV, and import
  your PV system's daily production as CSV.
- **Actual-year weather:** for the calibration year, Enthalix builds a weather
  file from the hourly readings of the NOAA station nearest the site, plus the
  sun and sky from the Open-Meteo archive. **Open-Meteo's free API is for
  non-commercial use only.** For paid work, use an actual-year weather file you
  have the right to use, with "Run on my own weather file…" on the calibration
  card.

## Where your files are

| What | Where |
| --- | --- |
| Projects and your decisions | `projects.sqlite` in the app-data folder (on macOS, `~/Library/Application Support/Enthalix/`) |
| Models, runs and your own tables | `data/`, never committed |
| Weather files | `Weather/`, never committed |
| Settings | `data/settings.json`, for example `{ "geocoderUrl": "https://…/search" }` to use another Nominatim-compatible geocoder |
