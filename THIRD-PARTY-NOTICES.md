# Third-party notices

Enthalix depends on the open-source components below. Each remains under its
own licence. Enthalix does not modify or bundle them unless stated.

<!-- TODO before first code release: complete this table from the BIM-BEM-BOM
     dependency list (package.json, requirements, and the EnergyPlus install).
     Check each licence is compatible with Apache-2.0 distribution. -->

| Component | Licence | How Enthalix uses it |
| --- | --- | --- |
| [EnergyPlus](https://github.com/NREL/EnergyPlus) | BSD-3-Clause-style (EnergyPlus licence) | Simulation engine, installed separately and run as its own program. "EnergyPlus" is a DOE trademark; Enthalix is not endorsed by DOE. |
| [web-ifc](https://github.com/ThatOpen/engine_web-ifc) | MPL-2.0 | Reads IFC files. Any changes to web-ifc's own files must be published under MPL-2.0. |
| [@thatopen/components](https://github.com/ThatOpen/engine_components), [@thatopen/fragments](https://github.com/ThatOpen/engine_fragment) | MIT | 3D model viewer. |
| [IfcOpenShell](https://github.com/IfcOpenShell/IfcOpenShell) | LGPL-3.0 | IFC geometry processing, installed separately and user-replaceable. |
| _to be completed_ | | |
