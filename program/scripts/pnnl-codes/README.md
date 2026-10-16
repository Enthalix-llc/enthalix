# The DOE/PNNL prototype values

`program/src/modules/bem/reference/pnnl-editions.csv` and `pnnl-values.csv` are
read from the DOE/PNNL Residential Prototype Building Models
(https://www.energycodes.gov/prototype-building-models) by these two scripts.

1. Download each climate zone's zip (`resstd_CZ1A.zip` … `resstd_CZ8.zip`)
   from that page into one folder.
2. `python3 -I extract.py <zips folder> <out folder>` reads, for every
   edition and zone, the single-family heat-pump prototypes (slab, crawl
   space, heated basement). It writes `pnnl.json` and names anything it
   could not read.
3. `python3 -I gen.py <out folder>/pnnl.json <out folder>` writes the two
   CSV files.

The zone's own file is read. For a zone whose every file is warm-humid (1A,
2A), the warm-humid file is read; the tropical variants are not. A zone's
sub-zone row (3B, 4C …) is written only where a value differs from the zone
number's row.
