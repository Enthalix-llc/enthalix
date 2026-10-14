# Tariffs

Enthalix prices the simulated year, and your utility bills, with your utility's
own rate schedule. No schedule ships with the program: every utility publishes
its own, and you transcribe yours once.

1. Copy `tariff.template.json` to `data/tariffs/tariff.json` (create the
   folder). The `data/` folder holds your own files and is never committed.
2. Open your utility's published residential rate schedule and its net metering
   schedule, usually PDFs on the utility's website.
3. Fill in every `value`, with the schedule's section in `cite` and the
   document's address in `url`. A number without its citation is refused.
4. Set `summerMonths` and the `demandWindow` hours as the schedule states them.
5. Change `status` to `"in force"`.

The app reads the file when it starts. BOM › UTILITY lists the card, or says
which values it refused.

## What the arithmetic covers

- A monthly customer (access) charge.
- Delivery and supply charges per kWh, with summer and other-month supply rates.
- A demand charge per kW of billing demand, measured in the schedule's hours.
- A power cost adjustment per kWh, typed from your bills because it changes monthly.
- Net metering with monthly netting: surplus kWh are banked as credits and
  applied to later months. At the end of each 12-month net metering period,
  only credits up to that period's billed consumption carry forward.

Schedules with tiered energy blocks, time-of-use periods or other net metering
rules aren't covered yet.
