/** Machine types BatchGuard can onboard: what they are, what we watch, how they fail. */

export type MachineTypeInfo = {
  id: string;
  name: string;
  tagline: string;
  image: string;
  description: string;
  monitors: { param: string; why: string }[];
  faults: { name: string; signature: string }[];
  firstChecks: string[];
  typicalUse: string;
};

export const MACHINE_TYPES: MachineTypeInfo[] = [
  {
    id: "conveyor",
    name: "Belt conveyor",
    tagline: "Moves product between stations; its drive motor is the usual point of failure.",
    image: "/machines/conveyor.jpg",
    description:
      "A belt running over a drive drum and return rollers, powered by a geared electric motor. On a packaging line it carries product from the feeder to inspection and sealing. Most conveyor incidents start in the drive end: bearings, belt tension or the cooling of the motor.",
    monitors: [
      { param: "belt_speed", why: "Drops when the belt slips or the motor stalls; set-point drift hurts downstream quality." },
      { param: "motor_temp", why: "Rises with load, lost cooling or a failing bearing. The critical limit comes from the motor's insulation class." },
      { param: "motor_current", why: "Tracks mechanical load. Up with a jam or bearing drag, down with belt slip." },
      { param: "vibration_rms", why: "The earliest sign of bearing wear — rises minutes to hours before temperature." },
      { param: "load", why: "Product mass on the belt; over-feed from upstream shows here first." },
    ],
    faults: [
      { name: "Bearing wear", signature: "vibration up first, then temperature; current slightly up; speed normal" },
      { name: "Belt slip / low tension", signature: "speed down while current falls; vibration normal" },
      { name: "Overload / jam", signature: "load and current spike, speed to zero, jam event" },
      { name: "Cooling fan failure", signature: "temperature up while current and vibration stay normal" },
    ],
    firstChecks: ["IR-gun the drive-end bearing housing", "Check belt tension and drum surface", "Confirm the motor fan is spinning and the shroud is clear"],
    typicalUse: "Packaging, food & beverage, logistics, assembly lines",
  },
  {
    id: "motor",
    name: "Electric motor",
    tagline: "Three-phase induction motor driving a pump, fan, mixer or gearbox.",
    image: "/machines/motor.jpg",
    description:
      "The workhorse of every plant. A squirrel-cage induction motor converts electrical power to rotation; it fails through bearings, winding insulation (heat) and misalignment. Monitoring temperature, current, vibration and speed together catches most problems before a trip.",
    monitors: [
      { param: "temperature", why: "Winding insulation life halves for every ~10 °C above rating." },
      { param: "current", why: "Load and phase imbalance; a rising current at constant speed means mechanical drag." },
      { param: "vibration_rms", why: "Bearings, misalignment, unbalance — ISO 10816 bands give the limits." },
      { param: "rpm", why: "Slip increases under load; a drop at constant current points to a mechanical problem." },
    ],
    faults: [
      { name: "Bearing wear", signature: "vibration rises slowly, then temperature" },
      { name: "Overheating / blocked cooling", signature: "temperature up, current and vibration flat" },
      { name: "Overload", signature: "current and temperature up together, rpm slightly down" },
      { name: "Misalignment", signature: "vibration step-change after maintenance, temperature normal" },
    ],
    firstChecks: ["Measure housing temperature at both bearings", "Clamp-meter all three phases", "Check coupling alignment and fan cover"],
    typicalUse: "Pumps, fans, compressors, mixers, conveyors",
  },
  {
    id: "pump",
    name: "Centrifugal pump",
    tagline: "Moves coolant, water or process fluid; cavitation and seal wear are the classic faults.",
    image: "/machines/pump.jpg",
    description:
      "An impeller inside a volute converts motor rotation into fluid pressure. Pressure and flow together describe its operating point; bearing temperature and vibration describe its health. Running away from the best-efficiency point (closed valves, starved suction) is what shortens its life.",
    monitors: [
      { param: "discharge_pressure", why: "Falls with impeller wear or a leak, rises with a blocked line." },
      { param: "flow_rate", why: "With pressure, pins the operating point; a drop at constant pressure means blockage or cavitation." },
      { param: "bearing_temp", why: "Lubrication and bearing condition." },
      { param: "vibration_rms", why: "Cavitation, unbalance and bearing wear all show up here first." },
    ],
    faults: [
      { name: "Cavitation", signature: "vibration and noise up, flow unstable, pressure slightly down" },
      { name: "Bearing wear", signature: "vibration up then bearing temperature" },
      { name: "Blocked discharge", signature: "pressure up, flow down, current down" },
      { name: "Seal leak", signature: "pressure and flow drift down together" },
    ],
    firstChecks: ["Check suction strainer and NPSH", "Inspect mechanical seal for leakage", "Compare pressure/flow with the pump curve"],
    typicalUse: "Cooling loops, process transfer, utilities",
  },
  {
    id: "compressor",
    name: "Air compressor",
    tagline: "Supplies the plant's compressed air; pressure, oil temperature and current tell the story.",
    image: "/machines/compressor.jpg",
    description:
      "A rotary-screw or piston compressor feeding the air receiver that runs sealers, cylinders and valves across the line. It is one of the largest energy users in a plant, so drift in pressure or current is money as well as reliability.",
    monitors: [
      { param: "outlet_pressure", why: "Air demand vs supply; a sag starves every pneumatic machine downstream." },
      { param: "oil_temp", why: "Cooling and lubrication; high oil temperature precedes bearing and seal failures." },
      { param: "motor_current", why: "Load and efficiency — a slow rise at constant pressure means wear or a leak somewhere." },
      { param: "vibration_rms", why: "Screw element and bearing condition." },
    ],
    faults: [
      { name: "Air leak downstream", signature: "pressure down, current up, long load cycles" },
      { name: "Cooler fouling", signature: "oil temperature rises, everything else flat" },
      { name: "Bearing wear", signature: "vibration up, then oil temperature" },
      { name: "Intake filter blocked", signature: "current up, delivered pressure slightly down" },
    ],
    firstChecks: ["Listen for leaks at the receiver and manifolds", "Check oil cooler fins and fan", "Inspect intake filter differential pressure"],
    typicalUse: "Plant utilities, pneumatic actuators, sealers",
  },
  {
    id: "hopper",
    name: "Feeder hopper",
    tagline: "Meters product onto the line; its feed rate sets the load on everything downstream.",
    image: "/machines/hopper.jpg",
    description:
      "A hopper with a vibratory or screw feeder that drops items onto the conveyor at a set rate. Over-feeding is a cross-machine problem: it looks like a conveyor overload downstream, which is exactly why BatchGuard reasons across the line order you define in the workflow.",
    monitors: [
      { param: "feed_rate", why: "The set-point for the whole line; a creep up overloads the conveyor." },
      { param: "hopper_level", why: "Running empty starves the line; overfilling bridges the outlet." },
      { param: "vibration_rms", why: "Vibratory drive health and tray fatigue." },
    ],
    faults: [
      { name: "Upstream over-feed", signature: "feed rate up first, then conveyor load and current" },
      { name: "Bridging / starvation", signature: "level steady but feed rate drops to zero" },
      { name: "Drive wear", signature: "vibration rises at constant feed rate" },
    ],
    firstChecks: ["Compare feed-rate set-point with conveyor rated capacity", "Look for bridging at the outlet", "Check tray springs and drive mounts"],
    typicalUse: "Packaging, pharma, food processing",
  },
  {
    id: "sealer",
    name: "Sealer / packer",
    tagline: "Heat-seals and packs the product; seal temperature drives reject rate at inspection.",
    image: "/machines/sealer.jpg",
    description:
      "A heated jaw or band presses film to make the seal, then the item is packed. Heater elements degrade slowly, thermocouples drift, and cycle time stretches as mechanics wear — all of which show up as rejects one station downstream. This is the quality link in the PRD.",
    monitors: [
      { param: "seal_temp", why: "Too low and the seal fails; too high and the film burns. The window comes from the film datasheet." },
      { param: "cycle_time", why: "Throughput and mechanical health; a slow creep means wear or air-pressure sag." },
      { param: "items_packed", why: "Production count for OEE and shift reports." },
    ],
    faults: [
      { name: "Heater degradation", signature: "seal temperature drifts down, reject rate climbs downstream" },
      { name: "Thermocouple drift", signature: "reported temperature stable while rejects rise" },
      { name: "Air pressure sag", signature: "cycle time up, seal temperature normal" },
    ],
    firstChecks: ["Verify seal temperature with a reference probe", "Measure heater element resistance", "Check compressed-air supply at the machine"],
    typicalUse: "Packaging lines, pouch and tray sealing",
  },
  {
    id: "inspection",
    name: "Inspection station",
    tagline: "Checkweigher or vision station that rejects bad product; its reject rate is the quality signal.",
    image: "/machines/inspection.jpg",
    description:
      "Weighs or images every item and pushes rejects aside. Its own health matters less than what its numbers say about the machines before it: a rising reject rate is usually the sealer or the feeder, not the inspector.",
    monitors: [
      { param: "item_weight", why: "Fill accuracy; drift means a dosing or feed problem upstream." },
      { param: "reject_rate", why: "The line's quality KPI; BatchGuard links a rise back to the responsible upstream machine." },
    ],
    faults: [
      { name: "Upstream seal failure", signature: "reject rate climbs while weight stays stable" },
      { name: "Dosing drift", signature: "mean weight drifts, rejects rise at one tail" },
      { name: "Sensor failure", signature: "weight flat-lines or jumps to an impossible value" },
    ],
    firstChecks: ["Zero and span the scale with test weights", "Review reject reasons by category", "Walk upstream to the sealer and feeder"],
    typicalUse: "Packaging, food, pharma QA",
  },
];

export const machineType = (id: string) => MACHINE_TYPES.find((t) => t.id === id);
