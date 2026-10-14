# Energy code values

Enthalix reads the prescriptive values of the energy code your project is under
from tables you enter. These cover the envelope U-factors, the window SHGC, slab
insulation, air leakage and the reference thermostat.

**No code table ships with Enthalix**, because each code belongs to its
publisher. The IECC is free to read online, read-only, at
[codes.iccsafe.org](https://codes.iccsafe.org/). Many states also publish the
code they adopted.

If a value the model needs is missing from your table, the model stops with a
message naming that value. Enthalix never invents a value.

## Setting up

1. Create the folder `data/energy-codes/` in the repository and copy the four
   CSV files from this folder into it. `data/` holds your own files and is never
   committed.
2. In `editions.csv`, add one row for each code edition you use, for example
   `IECC-2021,2021 IECC,IECC-2021,International Code Council,,<the page you read>,<date>,<what you read>`.
3. In `values.csv`, add one row for each edition, zone and factor (see the
   tables below). Every row needs its `unit` and its `cite` (the table or
   section); a row without them is refused.
4. `state-adoptions.csv` and `state-overrides.csv` are optional. Use them to list
   a state's adoptions with their dates, and the values a state amended.
5. Start Enthalix. In BEM › SITE, open the energy code, choose the edition, enter
   the climate zone that your county's row in the code's climate-zone table
   states (IECC Table R301.1), and click Use.

## Factors

| factor | unit | zone column | what it is |
| --- | --- | --- | --- |
| `fenestrationU` | Btu/h·ft²·°F | zone number | window U-factor |
| `skylightU` | Btu/h·ft²·°F | zone number | skylight U-factor |
| `ceilingU` | Btu/h·ft²·°F | zone number | ceiling U-factor |
| `frameWallU` | Btu/h·ft²·°F | zone number | wood frame wall U-factor |
| `massWallU` | Btu/h·ft²·°F | zone number | mass wall U-factor |
| `floorU` | Btu/h·ft²·°F | zone number | floor U-factor |
| `basementWallU` | Btu/h·ft²·°F | zone number | basement wall U-factor |
| `crawlWallU` | Btu/h·ft²·°F | zone number | crawl space wall U-factor |
| `fenestrationSHGC` | `-` | zone number | glazed fenestration SHGC; leave `value` empty where the code says NR |
| `slabR` | h·ft²·°F/Btu | zone number | slab edge insulation R-value (0 if none required) |
| `slabDepthFt` | ft | zone number | slab insulation depth (0 where no slab insulation is required) |
| `ach50` | ACH50 | zone number, or `all` | air leakage limit |
| `heatingSetpointF` | °F | `all` | standard reference design heating thermostat |
| `coolingSetpointF` | °F | `all` | standard reference design cooling thermostat |

A zone row is keyed by the zone number (`4`, not `4A`). For example, where the
code's table has one row for "5 and Marine 4", enter it as zone `5`; Enthalix
reads Marine 4 from it.

## Where each factor is in the IECC (residential)

| factor | 2009 | 2012 | 2015 | 2018 | 2021 | 2024 |
| --- | --- | --- | --- | --- | --- | --- |
| U-factors | Table 402.1.3 | Table R402.1.3 | Table R402.1.4 | Table R402.1.4 | Table R402.1.2 | Table R402.1.2 |
| SHGC, slab R and depth | Table 402.1.1 | Table R402.1.1 | Table R402.1.2 | Table R402.1.2 | Table R402.1.3 | Table R402.1.3 |
| Air leakage | 402.4.2.1 | R402.4.1.2 | R402.4.1.2 | R402.4.1.2 | R402.4.1.3 | R402.5.1.3 |
| Reference thermostat | Table 405.5.2(1) | Table R405.5.2(1) | Table R405.5.2(1) | Table R405.5.2(1) | Table R405.4.2(1) | Table R405.4.2(1) |
