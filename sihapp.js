/* ==========================================================================
   CycloneLens — operations console logic
   Demonstration data for the North Indian Ocean basin. Every number rendered
   here comes from the DATA block below; nothing is written into the markup.
   ========================================================================== */

(function () {
  "use strict";

  /* ---------- configuration ---------------------------------------------- */

  // Public active-track feed. Left unset because browsers block cross-origin
  // reads of the NOAA IBTrACS files directly (no Access-Control-Allow-Origin,
  // and `file://` pages have a null origin). Point this at your own server-side
  // proxy of the IBTrACS active list and the fetch path below takes over.
  // Expected format: IBTrACS CSV, or JSON [{name, basin, lat, lon, wind, time}].
  var LIVE_TRACK_ENDPOINT = null;

  // Server-side briefing endpoint for the AI analyst. When null, the analyst
  // answers from the fused data already in the browser (see composeBriefing).
  // Expected: POST {question, context} -> {text} or a text/plain stream.
  var ANALYST_ENDPOINT = null;

  var FETCH_TIMEOUT_MS = 12000;

  /* ---------- helpers ----------------------------------------------------- */

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function svg(tag, attrs) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (var key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        node.setAttribute(key, attrs[key]);
      }
    }
    return node;
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function relativeTime(minutesAgo) {
    if (minutesAgo < 1) return "just now";
    if (minutesAgo < 60) return minutesAgo + " min ago";
    var hours = Math.round(minutesAgo / 60);
    if (hours < 24) return hours + " h ago";
    return Math.round(hours / 24) + " d ago";
  }

  var toastTimer = null;
  function toast(message, isError) {
    var node = $("toast");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("is-error", !!isError);
    node.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      node.classList.remove("is-visible");
    }, 3600);
  }

  /* ---------- IMD intensity scale ---------------------------------------- */

  var IMD_SCALE = [
    { min: 0,   max: 16,       code: "LP",   name: "Low pressure area" },
    { min: 17,  max: 27,       code: "D",    name: "Depression" },
    { min: 28,  max: 33,       code: "DD",   name: "Deep depression" },
    { min: 34,  max: 47,       code: "CS",   name: "Cyclonic storm" },
    { min: 48,  max: 63,       code: "SCS",  name: "Severe cyclonic storm" },
    { min: 64,  max: 89,       code: "VSCS", name: "Very severe cyclonic storm" },
    { min: 90,  max: 119,      code: "ESCS", name: "Extremely severe cyclonic storm" },
    { min: 120, max: Infinity, code: "SuCS", name: "Super cyclonic storm" }
  ];

  function classifyWind(windKt) {
    for (var i = 0; i < IMD_SCALE.length; i++) {
      if (windKt >= IMD_SCALE[i].min && windKt <= IMD_SCALE[i].max) return IMD_SCALE[i];
    }
    return IMD_SCALE[0];
  }

  // Atkinson–Holliday wind-pressure relationship, used here as an independent
  // cross-check on the wind figure rather than as the primary estimate.
  function windFromPressure(hPa) {
    var deficit = 1010 - hPa;
    if (deficit <= 0) return 0;
    return 6.7 * Math.pow(deficit, 0.644);
  }

  /* ---------- data -------------------------------------------------------- */

  var SYSTEMS = [
    {
      id: "biparjoy",
      name: "BIPARJOY",
      basin: "Arabian Sea",
      wind: 105,
      pressure: 940,
      risk: "critical",
      confidence: 94,
      motion: { dir: "NNE", speed: 11 },
      observed: [
        [68.9, 13.2], [68.5, 14.4], [68.0, 15.6], [67.6, 16.6],
        [67.2, 17.5], [66.8, 18.4], [66.4, 19.2]
      ],
      forecast: [
        [66.4, 19.2], [66.2, 20.1], [66.3, 21.0], [66.7, 21.9],
        [67.3, 22.8], [68.2, 23.5]
      ],
      landfall: "Saurashtra–Kutch coast, ~36 h",
      intensity: {
        observed: [82, 86, 90, 94, 97, 100, 102, 104, 105],
        forecast: [105, 106, 106, 104, 101, 97, 92, 86, 78]
      },
      attention: [
        ["IR brightness temperature", 0.31],
        ["Water vapour 6.7 µm", 0.23],
        ["Passive microwave 89 GHz", 0.18],
        ["Scatterometer surface wind", 0.14],
        ["Sea surface temperature", 0.09],
        ["Deep-layer vertical shear", 0.05]
      ]
    },
    {
      id: "mocha",
      name: "MOCHA",
      basin: "Bay of Bengal",
      wind: 78,
      pressure: 962,
      risk: "high",
      confidence: 89,
      motion: { dir: "NNE", speed: 9 },
      observed: [
        [88.0, 13.0], [88.3, 14.2], [88.7, 15.4], [89.1, 16.5], [89.6, 17.6]
      ],
      forecast: [
        [89.6, 17.6], [90.2, 18.6], [90.9, 19.5], [91.6, 20.4], [92.3, 21.0]
      ],
      landfall: "North Rakhine coast, ~30 h",
      intensity: {
        observed: [58, 62, 66, 69, 72, 74, 76, 77, 78],
        forecast: [78, 80, 82, 84, 85, 84, 80, 72, 60]
      },
      attention: [
        ["IR brightness temperature", 0.28],
        ["Passive microwave 89 GHz", 0.24],
        ["Water vapour 6.7 µm", 0.19],
        ["Scatterometer surface wind", 0.13],
        ["Sea surface temperature", 0.10],
        ["Deep-layer vertical shear", 0.06]
      ]
    },
    {
      id: "tej",
      name: "TEJ",
      basin: "Arabian Sea",
      wind: 45,
      pressure: 990,
      risk: "medium",
      confidence: 81,
      motion: { dir: "WNW", speed: 8 },
      observed: [
        [62.0, 14.2], [61.0, 14.6], [60.0, 15.0], [59.0, 15.4]
      ],
      forecast: [
        [59.0, 15.4], [58.0, 15.8], [57.0, 16.2], [56.0, 16.6], [55.2, 17.1]
      ],
      landfall: "Dhofar coast, ~54 h",
      intensity: {
        observed: [28, 31, 34, 36, 38, 41, 43, 44, 45],
        forecast: [45, 48, 50, 53, 55, 57, 58, 56, 52]
      },
      attention: [
        ["IR brightness temperature", 0.26],
        ["Sea surface temperature", 0.21],
        ["Deep-layer vertical shear", 0.19],
        ["Water vapour 6.7 µm", 0.15],
        ["Scatterometer surface wind", 0.12],
        ["Passive microwave 89 GHz", 0.07]
      ]
    },
    {
      id: "hamoon",
      name: "HAMOON",
      labelSide: "left",
      labelOffset: -22,
      basin: "Bay of Bengal",
      wind: 22,
      pressure: 1002,
      risk: "low",
      confidence: 73,
      motion: { dir: "NE", speed: 6 },
      observed: [
        [87.5, 17.0], [87.9, 17.6], [88.3, 18.2]
      ],
      forecast: [
        [88.3, 18.2], [88.8, 18.8], [89.3, 19.5], [89.9, 20.2]
      ],
      landfall: "No landfall within 72 h",
      intensity: {
        observed: [14, 15, 16, 18, 19, 20, 21, 22, 22],
        forecast: [22, 24, 25, 27, 28, 30, 31, 32, 33]
      },
      attention: [
        ["Sea surface temperature", 0.25],
        ["IR brightness temperature", 0.22],
        ["Deep-layer vertical shear", 0.20],
        ["Scatterometer surface wind", 0.14],
        ["Water vapour 6.7 µm", 0.12],
        ["Passive microwave 89 GHz", 0.07]
      ]
    }
  ];

  var ALERTS = [
    {
      system: "BIPARJOY",
      severity: "critical",
      title: "Landfall watch — Saurashtra–Kutch",
      body: "Fused guidance keeps the centre inside the 36-hour landfall window. Storm surge of 2–3 m above astronomical tide expected in low-lying Kutch talukas.",
      minutesAgo: 6,
      owner: "SEOC Gujarat"
    },
    {
      system: "BIPARJOY",
      severity: "critical",
      title: "Rapid-intensification flag cleared",
      body: "Structural classifier no longer meets the 30 kt / 24 h threshold. Peak intensity now expected within 6 hours, followed by shear-driven weakening.",
      minutesAgo: 24,
      owner: "Forecast desk"
    },
    {
      system: "MOCHA",
      severity: "high",
      title: "Eyewall replacement in progress",
      body: "89 GHz microwave shows a concentric ring forming at 55 km radius. Expect a short intensity plateau then re-strengthening before landfall.",
      minutesAgo: 41,
      owner: "Forecast desk"
    },
    {
      system: "MOCHA",
      severity: "high",
      title: "Fishing advisory extended",
      body: "Gale warning extended along the north Bay coast through the next two tide cycles. Small craft to remain in harbour.",
      minutesAgo: 88,
      owner: "Port control"
    },
    {
      system: "TEJ",
      severity: "medium",
      title: "Intensification trend confirmed",
      body: "Warm SST anomaly of +1.4 °C along the forecast path supports steady strengthening to severe cyclonic storm within 24 hours.",
      minutesAgo: 130,
      owner: "Forecast desk"
    },
    {
      system: "TEJ",
      severity: "medium",
      title: "Track spread above tolerance",
      body: "Cross-model along-track spread reached 148 km at 72 h. Treat the Dhofar landfall point as indicative only.",
      minutesAgo: 195,
      owner: "Model ops"
    },
    {
      system: "HAMOON",
      severity: "low",
      title: "System upgraded to depression",
      body: "Scatterometer pass confirms a closed circulation with 22 kt peak winds. Monitoring cadence increased to 3-hourly.",
      minutesAgo: 260,
      owner: "Watch officer"
    }
  ];

  var SOURCES = [
    {
      name: "INSAT-3DR imager",
      state: "live",
      note: "Half-hourly IR and water-vapour channels over the full disc, resampled to the basin grid.",
      cadence: "30 min",
      latency: "4.1 min",
      minutesAgo: 8
    },
    {
      name: "Oceansat-3 scatterometer",
      state: "live",
      note: "Surface wind vectors used to anchor the outer wind field and locate the circulation centre.",
      cadence: "Per pass",
      latency: "26 min",
      minutesAgo: 34
    },
    {
      name: "Metop-C ASCAT",
      state: "sync",
      note: "Secondary scatterometer swath. Currently backfilling a gap from the previous descending pass.",
      cadence: "Per pass",
      latency: "51 min",
      minutesAgo: 62
    },
    {
      name: "NOAA IBTrACS",
      state: "sync",
      note: "Historical best-track labels for training and verification. North Indian Ocean subset only.",
      cadence: "Daily",
      latency: "—",
      minutesAgo: 420
    },
    {
      name: "RSMC New Delhi bulletins",
      state: "live",
      note: "Official advisories held separately from model output and never blended into the fused track.",
      cadence: "3 h",
      latency: "9 min",
      minutesAgo: 17
    },
    {
      name: "GFS 0.25° analysis",
      state: "degraded",
      note: "Steering-flow and shear fields. Last cycle arrived late; the 06Z run is being used as fallback.",
      cadence: "6 h",
      latency: "2 h 12 min",
      minutesAgo: 132
    }
  ];

  // Bundled snapshot shown when no live endpoint is configured or reachable.
  var LIVE_SNAPSHOT = [
    { name: "BIPARJOY", basin: "North Indian", position: "19.2°N 66.4°E", wind: 105, updated: "0600 UTC" },
    { name: "MOCHA", basin: "North Indian", position: "17.6°N 89.6°E", wind: 78, updated: "0600 UTC" },
    { name: "TEJ", basin: "North Indian", position: "15.4°N 59.0°E", wind: 45, updated: "0600 UTC" },
    { name: "HAMOON", basin: "North Indian", position: "18.2°N 88.3°E", wind: 22, updated: "0600 UTC" }
  ];

  var FUSION_LATENCY = "2.4 s";

  var state = {
    focusId: SYSTEMS[0].id,
    alertFilter: "all",
    streaming: false
  };

  function focused() {
    for (var i = 0; i < SYSTEMS.length; i++) {
      if (SYSTEMS[i].id === state.focusId) return SYSTEMS[i];
    }
    return SYSTEMS[0];
  }

  /* ---------- map geometry ------------------------------------------------ */

  var MAP = { west: 46, east: 100, south: 0, north: 28, width: 1080, height: 560 };

  function project(lon, lat) {
    return [
      ((lon - MAP.west) / (MAP.east - MAP.west)) * MAP.width,
      ((MAP.north - lat) / (MAP.north - MAP.south)) * MAP.height
    ];
  }

  function pathFrom(points, close) {
    var d = "";
    for (var i = 0; i < points.length; i++) {
      var p = project(points[i][0], points[i][1]);
      d += (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1);
    }
    return d + (close ? "Z" : "");
  }

  // Simplified coastlines, closed against the frame edges.
  var LAND = [
    // Subcontinent, Indochina margin and the Makran coast.
    [[60.5, 28], [61.5, 25.2], [66.9, 24.8], [68.9, 23.6], [70.0, 22.2], [72.6, 21.6],
     [72.8, 19.1], [73.8, 15.9], [74.9, 12.9], [76.0, 10.0], [77.5, 8.1], [79.2, 9.3],
     [79.8, 10.3], [80.3, 13.1], [82.3, 16.6], [83.3, 17.7], [85.0, 19.5], [86.9, 21.0],
     [88.1, 21.6], [90.5, 22.0], [91.7, 22.4], [93.6, 20.0], [94.2, 18.0], [94.5, 16.0],
     [96.0, 16.5], [97.6, 16.4], [98.5, 14.0], [99.5, 11.5], [100, 10.0], [100, 28]],
    // Arabian peninsula.
    [[46, 28], [56.4, 26.5], [56.4, 24.8], [58.6, 23.6], [59.8, 22.5], [58.5, 20.4],
     [57.8, 18.9], [55.3, 17.5], [53.1, 16.6], [52.2, 15.6], [49.0, 14.0], [46.0, 12.8]],
    // Horn of Africa.
    [[46, 12.0], [49.0, 11.4], [51.3, 11.9], [50.5, 8.5], [48.0, 5.5], [46.0, 3.2]],
    // Sri Lanka.
    [[79.7, 9.8], [81.2, 8.5], [81.9, 7.3], [81.5, 6.4], [80.2, 5.95], [79.7, 7.0], [79.8, 8.9]],
    // Andaman and Nicobar chain.
    [[92.6, 13.6], [93.0, 12.9], [92.9, 11.6], [92.5, 11.8], [92.4, 13.0]],
    [[93.5, 8.0], [93.9, 7.3], [93.6, 6.8], [93.4, 7.6]]
  ];

  var SEA_LABELS = [
    { text: "ARABIAN SEA", lon: 61.5, lat: 12.5 },
    { text: "BAY OF BENGAL", lon: 85.5, lat: 12.0 },
    { text: "INDIA", lon: 77.5, lat: 21.5 },
    { text: "LACCADIVE SEA", lon: 73.5, lat: 6.0 }
  ];

  function conePath(points) {
    if (points.length < 2) return "";
    var pts = points.map(function (pair) { return project(pair[0], pair[1]); });

    function unit(from, to) {
      var dx = to[0] - from[0];
      var dy = to[1] - from[1];
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      return [dx / len, dy / len];
    }

    var left = [];
    var right = [];
    for (var i = 0; i < pts.length; i++) {
      // Bisect the incoming and outgoing directions so the offset stays smooth
      // through a course change instead of folding back on itself.
      var incoming = i > 0 ? unit(pts[i - 1], pts[i]) : unit(pts[0], pts[1]);
      var outgoing = i < pts.length - 1 ? unit(pts[i], pts[i + 1]) : incoming;
      var tx = incoming[0] + outgoing[0];
      var ty = incoming[1] + outgoing[1];
      var tlen = Math.sqrt(tx * tx + ty * ty) || 1;
      var nx = -ty / tlen;
      var ny = tx / tlen;
      var r = 7 + i * 11;
      left.push([pts[i][0] + nx * r, pts[i][1] + ny * r]);
      right.push([pts[i][0] - nx * r, pts[i][1] - ny * r]);
    }
    right.reverse();
    var all = left.concat(right);
    var d = "";
    for (var j = 0; j < all.length; j++) {
      d += (j === 0 ? "M" : "L") + all[j][0].toFixed(1) + " " + all[j][1].toFixed(1);
    }
    return d + "Z";
  }

  function stormGlyph(x, y, radius, colour) {
    // The translate lives on the outer group: a CSS transform on the animated
    // element would otherwise replace the positioning transform entirely.
    var anchor = svg("g", { transform: "translate(" + x + "," + y + ")" });
    var group = svg("g", { class: "storm-glyph" });
    anchor.appendChild(group);
    var r = radius;
    group.appendChild(svg("path", {
      class: "arm",
      stroke: colour,
      d: "M0 " + (-r * 0.25) + " C " + (-r * 0.75) + " " + (-r * 0.5) + ", " + (-r) + " " + (r * 0.25) + ", " + (-r * 0.5) + " " + r
    }));
    group.appendChild(svg("path", {
      class: "arm",
      stroke: colour,
      d: "M0 " + (r * 0.25) + " C " + (r * 0.75) + " " + (r * 0.5) + ", " + r + " " + (-r * 0.25) + ", " + (r * 0.5) + " " + (-r)
    }));
    group.appendChild(svg("circle", { class: "eye", cx: 0, cy: 0, r: Math.max(2.4, r * 0.2) }));
    group.appendChild(svg("circle", { cx: 0, cy: 0, r: Math.max(2.4, r * 0.2), fill: "none", stroke: colour, "stroke-width": 1.6 }));
    return anchor;
  }

  var RISK_COLOUR = {
    low: "#4ec9a0",
    medium: "#f0b429",
    high: "#ff8a3d",
    critical: "#ff4d6d"
  };

  function renderMap() {
    var host = $("map");
    if (!host) return;
    host.innerHTML = "";

    var root = svg("svg", {
      viewBox: "0 0 " + MAP.width + " " + MAP.height,
      preserveAspectRatio: "xMidYMid meet"
    });

    // Graticule. Lines sit under the coastlines, labels sit over them.
    var grid = svg("g", {});
    var gridLabels = svg("g", {});
    for (var lon = 50; lon <= 100; lon += 10) {
      var a = project(lon, MAP.north);
      var b = project(lon, MAP.south);
      grid.appendChild(svg("line", { class: "map-graticule", x1: a[0], y1: a[1], x2: b[0], y2: b[1] }));
      var lonLabel = svg("text", { class: "map-graticule-label", x: a[0] + 5, y: MAP.height - 10 });
      lonLabel.textContent = lon + "°E";
      gridLabels.appendChild(lonLabel);
    }
    for (var lat = 5; lat <= 25; lat += 5) {
      var c = project(MAP.west, lat);
      var d = project(MAP.east, lat);
      grid.appendChild(svg("line", { class: "map-graticule", x1: c[0], y1: c[1], x2: d[0], y2: d[1] }));
      var latLabel = svg("text", { class: "map-graticule-label", x: 10, y: c[1] - 7 });
      latLabel.textContent = lat + "°N";
      gridLabels.appendChild(latLabel);
    }
    root.appendChild(grid);

    // Land.
    var landGroup = svg("g", {});
    for (var i = 0; i < LAND.length; i++) {
      landGroup.appendChild(svg("path", { class: "map-land", d: pathFrom(LAND[i], true) }));
    }
    root.appendChild(landGroup);
    root.appendChild(gridLabels);

    for (var s = 0; s < SEA_LABELS.length; s++) {
      var pos = project(SEA_LABELS[s].lon, SEA_LABELS[s].lat);
      var label = svg("text", { class: "map-coast-label", x: pos[0], y: pos[1], "text-anchor": "middle" });
      label.textContent = SEA_LABELS[s].text;
      root.appendChild(label);
    }

    // Tracks.
    SYSTEMS.forEach(function (system) {
      var isFocused = system.id === state.focusId;
      var group = svg("g", {
        class: "track-group" + (isFocused ? " is-focused" : ""),
        tabindex: "0",
        role: "button",
        "aria-label": "Focus " + system.name
      });

      if (isFocused) {
        group.appendChild(svg("path", { class: "track-cone", d: conePath(system.forecast) }));
      }
      group.appendChild(svg("path", { class: "track-observed", d: pathFrom(system.observed, false) }));
      group.appendChild(svg("path", { class: "track-forecast", d: pathFrom(system.forecast, false) }));

      system.observed.slice(0, -1).forEach(function (point) {
        var p = project(point[0], point[1]);
        group.appendChild(svg("circle", { class: "track-point", cx: p[0], cy: p[1], r: 4 }));
      });

      var head = system.observed[system.observed.length - 1];
      var hp = project(head[0], head[1]);
      var radius = clamp(14 + system.wind / 7, 16, 34);
      group.appendChild(stormGlyph(hp[0], hp[1], radius, RISK_COLOUR[system.risk]));

      var left = system.labelSide === "left";
      var name = svg("text", {
        class: "storm-label",
        x: hp[0] + (left ? -(radius + 9) : radius + 9),
        y: hp[1] + (system.labelOffset || 0) + 6,
        "text-anchor": left ? "end" : "start"
      });
      name.textContent = system.name + " " + system.wind + " kt";
      group.appendChild(name);

      function focus() { setFocus(system.id); }
      group.addEventListener("click", focus);
      group.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          focus();
        }
      });

      root.appendChild(group);
    });

    host.appendChild(root);
  }

  /* ---------- system cards ------------------------------------------------ */

  function renderSystemCards() {
    var host = $("systemCards");
    if (!host) return;
    host.innerHTML = "";

    SYSTEMS.forEach(function (system) {
      var card = el("button", "system-card sev-" + system.risk);
      card.type = "button";
      card.setAttribute("aria-pressed", String(system.id === state.focusId));
      card.appendChild(el("strong", null, system.name));
      card.appendChild(el("span", null, system.wind + " kt · " + classifyWind(system.wind).code));
      card.appendChild(el("em", null, system.basin));
      card.addEventListener("click", function () { setFocus(system.id); });
      host.appendChild(card);
    });
  }

  /* ---------- focused system ---------------------------------------------- */

  function formatPosition(system) {
    var head = system.observed[system.observed.length - 1];
    return head[1].toFixed(1) + "°N, " + head[0].toFixed(1) + "°E";
  }

  function renderFocus() {
    var system = focused();
    var band = classifyWind(system.wind);

    $("focusTitle").textContent = system.name;
    $("chartCyclone").textContent = system.name;

    var badge = $("riskBadge");
    badge.className = "risk " + system.risk;
    badge.textContent = system.risk.toUpperCase() + " RISK";

    $("windValue").innerHTML = system.wind + " <small>kt</small>";
    $("pressureValue").innerHTML = system.pressure + " <small>hPa</small>";
    $("classValue").textContent = band.code;
    $("classValue").title = band.name;
    $("motionValue").textContent = system.motion.dir + " " + system.motion.speed + " kt";
    $("positionValue").textContent = formatPosition(system);
    $("confidenceValue").textContent = system.confidence + "% confidence";

    $("windInput").value = system.wind;
    $("pressureInput").value = system.pressure;
    var output = $("classificationOutput");
    output.classList.remove("is-visible");
    output.innerHTML = "";
  }

  /* ---------- intensity chart --------------------------------------------- */

  function renderChart() {
    var host = $("intensityChart");
    if (!host) return;
    host.innerHTML = "";

    var system = focused();
    var observed = system.intensity.observed;
    var forecast = system.intensity.forecast;
    var W = 720;
    var H = 260;
    var pad = { top: 16, right: 16, bottom: 28, left: 40 };
    var plotW = W - pad.left - pad.right;
    var plotH = H - pad.top - pad.bottom;

    var all = observed.concat(forecast);
    var maxWind = Math.max.apply(null, all);
    var yMax = Math.ceil((maxWind * 1.25) / 20) * 20;
    var yMin = 0;
    var totalPoints = observed.length + forecast.length - 1;

    function x(index) { return pad.left + (index / (totalPoints - 1)) * plotW; }
    function y(value) { return pad.top + plotH - ((value - yMin) / (yMax - yMin)) * plotH; }

    var root = svg("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "xMidYMid meet" });

    // Horizontal grid and y labels.
    for (var v = 0; v <= yMax; v += 20) {
      root.appendChild(svg("line", { class: "chart-grid", x1: pad.left, y1: y(v), x2: W - pad.right, y2: y(v) }));
      var yl = svg("text", { class: "chart-axis", x: pad.left - 8, y: y(v) + 3, "text-anchor": "end" });
      yl.textContent = v;
      root.appendChild(yl);
    }

    // IMD threshold reference for the current band.
    var band = classifyWind(system.wind);
    if (band.min > 0 && band.min < yMax) {
      root.appendChild(svg("line", { class: "chart-threshold", x1: pad.left, y1: y(band.min), x2: W - pad.right, y2: y(band.min) }));
      var tl = svg("text", { class: "chart-threshold-label", x: pad.left + 4, y: y(band.min) - 6, "text-anchor": "start" });
      tl.textContent = band.code + " threshold " + band.min + " kt";
      root.appendChild(tl);
    }

    // Forecast spread band.
    var upper = "";
    var lower = [];
    for (var f = 0; f < forecast.length; f++) {
      var idx = observed.length - 1 + f;
      var spread = forecast[f] * (0.04 + f * 0.022);
      upper += (f === 0 ? "M" : "L") + x(idx).toFixed(1) + " " + y(Math.min(yMax, forecast[f] + spread)).toFixed(1);
      lower.push([x(idx), y(Math.max(0, forecast[f] - spread))]);
    }
    lower.reverse();
    for (var l = 0; l < lower.length; l++) {
      upper += "L" + lower[l][0].toFixed(1) + " " + lower[l][1].toFixed(1);
    }
    root.appendChild(svg("path", { class: "chart-band", d: upper + "Z" }));

    // Lines.
    var obsPath = "";
    observed.forEach(function (value, index) {
      obsPath += (index === 0 ? "M" : "L") + x(index).toFixed(1) + " " + y(value).toFixed(1);
    });
    root.appendChild(svg("path", { class: "chart-line-observed", d: obsPath }));

    var fcPath = "";
    forecast.forEach(function (value, index) {
      var idx = observed.length - 1 + index;
      fcPath += (index === 0 ? "M" : "L") + x(idx).toFixed(1) + " " + y(value).toFixed(1);
    });
    root.appendChild(svg("path", { class: "chart-line-forecast", d: fcPath }));

    // Analysis time marker.
    var nowX = x(observed.length - 1);
    root.appendChild(svg("line", { class: "chart-now", x1: nowX, y1: pad.top, x2: nowX, y2: pad.top + plotH }));
    var nowLabel = svg("text", { class: "chart-now-label", x: nowX + 5, y: pad.top + 10 });
    nowLabel.textContent = "ANALYSIS";
    root.appendChild(nowLabel);
    root.appendChild(svg("circle", { class: "chart-dot", cx: nowX, cy: y(system.wind), r: 4 }));

    // Time axis.
    var hours = [-24, -18, -12, -6, 0, 6, 12, 18, 24];
    hours.forEach(function (hour) {
      var index = (hour + 24) / 3;
      var tick = svg("text", { class: "chart-axis", x: x(index), y: H - 9, "text-anchor": "middle" });
      tick.textContent = hour === 0 ? "T0" : (hour > 0 ? "+" + hour : hour) + "h";
      root.appendChild(tick);
    });

    host.appendChild(root);
  }

  /* ---------- channel attention ------------------------------------------- */

  function renderAttention() {
    var host = $("attentionBars");
    if (!host) return;
    host.innerHTML = "";

    var system = focused();
    var lead = Math.max.apply(null, system.attention.map(function (row) { return row[1]; }));

    system.attention.forEach(function (row, index) {
      var wrapper = el("div", "attention-row" + (row[1] === lead ? " is-lead" : ""));
      var header = el("header");
      header.appendChild(el("span", null, row[0]));
      header.appendChild(el("b", null, Math.round(row[1] * 100) + "%"));
      wrapper.appendChild(header);

      var track = el("div", "attention-track");
      var fill = el("div", "attention-fill");
      fill.style.width = "0%";
      track.appendChild(fill);
      wrapper.appendChild(track);
      host.appendChild(wrapper);

      window.setTimeout(function () {
        fill.style.width = Math.round((row[1] / lead) * 100) + "%";
      }, 40 + index * 45);
    });
  }

  /* ---------- alerts ------------------------------------------------------- */

  function visibleAlerts() {
    if (state.alertFilter === "all") return ALERTS;
    return ALERTS.filter(function (alert) { return alert.severity === state.alertFilter; });
  }

  function renderAlerts() {
    var host = $("alerts");
    if (!host) return;
    host.innerHTML = "";

    var rows = visibleAlerts();
    if (!rows.length) {
      host.appendChild(el("div", "empty-state", "No alerts at this severity. Switch the filter to see the rest of the queue."));
      return;
    }

    rows.forEach(function (alert) {
      var item = el("article", "alert sev-" + alert.severity);
      var header = el("header");
      header.appendChild(el("h3", null, alert.title));
      var time = el("time", null, relativeTime(alert.minutesAgo));
      header.appendChild(time);
      item.appendChild(header);
      item.appendChild(el("p", null, alert.body));

      var footer = el("footer");
      footer.appendChild(el("span", "tag", alert.severity.toUpperCase()));
      footer.appendChild(el("span", null, alert.system));
      footer.appendChild(el("span", "owner", alert.owner));
      item.appendChild(footer);

      host.appendChild(item);
    });
  }

  function bindAlertFilters() {
    var group = $("alertFilters");
    if (!group) return;
    group.addEventListener("click", function (event) {
      var button = event.target.closest(".filter");
      if (!button) return;
      state.alertFilter = button.dataset.severity;
      Array.prototype.forEach.call(group.querySelectorAll(".filter"), function (node) {
        node.classList.toggle("active", node === button);
      });
      renderAlerts();
    });
  }

  /* ---------- sources ------------------------------------------------------ */

  var STATE_LABEL = { live: "LIVE", sync: "SYNCING", degraded: "DEGRADED", offline: "OFFLINE" };

  function renderSources() {
    var host = $("sourceList");
    if (!host) return;
    host.innerHTML = "";

    SOURCES.forEach(function (source) {
      var card = el("article", "source state-" + source.state);
      var header = el("header");
      header.appendChild(el("h3", null, source.name));
      header.appendChild(el("span", "state", STATE_LABEL[source.state]));
      card.appendChild(header);
      card.appendChild(el("p", null, source.note));

      var list = el("dl");
      [["Cadence", source.cadence], ["Latency", source.latency], ["Last file", relativeTime(source.minutesAgo)]]
        .forEach(function (pair) {
          var cell = el("div");
          cell.appendChild(el("dt", null, pair[0]));
          cell.appendChild(el("dd", null, pair[1]));
          list.appendChild(cell);
        });
      card.appendChild(list);
      host.appendChild(card);
    });
  }

  /* ---------- KPIs and clock ----------------------------------------------- */

  function renderKpis() {
    var critical = ALERTS.filter(function (a) { return a.severity === "critical"; }).length;
    var online = SOURCES.filter(function (s) { return s.state === "live" || s.state === "sync"; }).length;

    $("kpiSystems").textContent = SYSTEMS.length;
    $("kpiAlerts").textContent = critical;
    $("kpiSources").textContent = online + "/" + SOURCES.length;
    $("kpiLatency").textContent = FUSION_LATENCY;
    $("systemCount").textContent = SYSTEMS.length;
  }

  function tickClock() {
    var node = $("updatedAt");
    if (!node) return;
    var now = new Date();
    var utc = now.toISOString().slice(11, 16);
    node.textContent = "SYNCED " + utc + " UTC";
  }

  /* ---------- what-if classifier ------------------------------------------- */

  function bindClassifier() {
    var form = $("classifyForm");
    if (!form) return;

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var wind = Number($("windInput").value);
      var pressure = Number($("pressureInput").value);
      var output = $("classificationOutput");

      if (!Number.isFinite(wind) || wind < 1) {
        output.textContent = "Enter a wind speed between 1 and 250 kt.";
        output.classList.add("is-visible");
        return;
      }

      var band = classifyWind(wind);
      var implied = windFromPressure(pressure);
      var delta = wind - implied;
      var agrees = Math.abs(delta) <= 8;

      output.innerHTML = "";
      var line = el("div");
      line.appendChild(document.createTextNode("IMD category: "));
      line.appendChild(el("strong", null, band.code));
      line.appendChild(document.createTextNode(" — " + band.name.toLowerCase()));
      output.appendChild(line);

      var detail = el("span", null,
        "Pressure implies " + Math.round(implied) + " kt (Atkinson–Holliday). " +
        (agrees
          ? "Wind and pressure agree within tolerance."
          : "Disagreement of " + Math.abs(Math.round(delta)) + " kt — check the centre fix before issuing."));
      output.appendChild(detail);
      output.classList.add("is-visible");
    });
  }

  /* ---------- AI analyst ---------------------------------------------------- */

  function contextSnapshot() {
    var system = focused();
    return {
      system: system.name,
      basin: system.basin,
      wind: system.wind,
      pressure: system.pressure,
      category: classifyWind(system.wind).code,
      motion: system.motion,
      position: formatPosition(system),
      landfall: system.landfall,
      confidence: system.confidence,
      openAlerts: ALERTS.filter(function (a) { return a.system === system.name; }).length
    };
  }

  // Lower-cases a label for mid-sentence use, but leaves an acronym first word
  // ("IR brightness temperature") alone.
  function softLower(text) {
    var first = text.split(" ")[0];
    if (first === first.toUpperCase() && /[A-Z]/.test(first)) return text;
    return text.charAt(0).toLowerCase() + text.slice(1);
  }

  function composeBriefing(question) {
    var system = focused();
    var band = classifyWind(system.wind);
    var peak = Math.max.apply(null, system.intensity.forecast);
    var end = system.intensity.forecast[system.intensity.forecast.length - 1];
    var own = ALERTS.filter(function (a) { return a.system === system.name; });
    var q = question.toLowerCase();

    if (/wind|intensity|strength|pressure|kt|weaken|strengthen/.test(q)) {
      return system.name + " is analysed at " + system.wind + " kt and " + system.pressure +
        " hPa, which places it in the " + band.name.toLowerCase() + " band (" + band.code + "). " +
        "Guidance peaks at " + peak + " kt inside the next 24 hours and falls to about " + end +
        " kt by the end of the window. Confidence on the structural classification is " +
        system.confidence + "%.";
    }

    if (/track|path|where|landfall|move|motion|direction|coast/.test(q)) {
      return system.name + " is centred near " + formatPosition(system) + " in the " +
        system.basin + ", moving " + system.motion.dir + " at " + system.motion.speed +
        " kt. Fused guidance takes it toward " + system.landfall +
        ". The forecast cone widens to roughly 150 km either side of the centre by 72 hours, so treat " +
        "the endpoint as indicative rather than a fixed position.";
    }

    if (/alert|warn|risk|action|evacuat|advisory/.test(q)) {
      if (!own.length) {
        return "No alerts are currently open against " + system.name +
          ". The queue holds " + ALERTS.length + " items across the other systems in the basin.";
      }
      var lines = own.map(function (a) {
        return "• " + a.severity.toUpperCase() + " — " + a.title + " (" + a.owner + ", " +
          relativeTime(a.minutesAgo) + ")";
      });
      return own.length + " alert" + (own.length > 1 ? "s are" : " is") + " open against " +
        system.name + ", at " + system.risk + " overall risk:\n" + lines.join("\n");
    }

    if (/source|data|feed|ingest|latency|satellite|insat|scatterometer/.test(q)) {
      var live = SOURCES.filter(function (s) { return s.state === "live"; }).length;
      var bad = SOURCES.filter(function (s) { return s.state === "degraded" || s.state === "offline"; });
      return live + " of " + SOURCES.length + " sources are live and the fusion cycle is completing in " +
        FUSION_LATENCY + ". " + (bad.length
          ? bad[0].name + " is " + bad[0].state + ": " + bad[0].note
          : "No source is currently degraded.");
    }

    if (/model|attention|channel|confidence|why|explain/.test(q)) {
      var top = system.attention[0];
      var second = system.attention[1];
      return "FusionCNN-v2.4 assigns " + Math.round(top[1] * 100) + "% of the classification weight to " +
        softLower(top[0]) + " and " + Math.round(second[1] * 100) + "% to " + softLower(second[0]) +
        " for this system. Overall confidence is " + system.confidence +
        "%. Channel attention is diagnostic only and is not blended into the official advisory.";
    }

    return "Brief on " + system.name + ": " + band.name.toLowerCase() + " (" + band.code + ") at " +
      system.wind + " kt and " + system.pressure + " hPa, centred near " + formatPosition(system) +
      " and moving " + system.motion.dir + " at " + system.motion.speed + " kt. Expected track: " +
      system.landfall + ". " + own.length + " alert" + (own.length === 1 ? "" : "s") +
      " open, overall risk " + system.risk + ". Ask about intensity, track, alerts, sources or the model " +
      "for a focused answer.";
  }

  function streamInto(node, text, done) {
    var words = text.split(/(\s+)/);
    var index = 0;
    node.classList.add("is-typing");
    var panel = document.querySelector(".analyst-panel");
    if (panel) panel.classList.add("is-streaming");

    var log = $("chatLog");

    // Readers who ask for reduced motion get the finished brief, not a
    // character-by-character reveal they have to sit through.
    var stillMotion = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (stillMotion) {
      node.textContent = text;
      node.classList.remove("is-typing");
      if (panel) panel.classList.remove("is-streaming");
      if (log) log.scrollTop = log.scrollHeight;
      state.streaming = false;
      if (done) done();
      return;
    }

    var timer = window.setInterval(function () {
      node.textContent += words[index];
      index += 1;
      if (log) log.scrollTop = log.scrollHeight;
      if (index >= words.length) {
        window.clearInterval(timer);
        node.classList.remove("is-typing");
        if (panel) panel.classList.remove("is-streaming");
        state.streaming = false;
        if (done) done();
      }
    }, 26);
  }

  function askAnalyst(question) {
    var log = $("chatLog");
    if (!log || state.streaming) return;
    state.streaming = true;

    log.appendChild(el("div", "user-message", question));
    var reply = el("div", "analyst-message", "");
    log.appendChild(reply);
    log.scrollTop = log.scrollHeight;

    if (!ANALYST_ENDPOINT) {
      streamInto(reply, composeBriefing(question));
      return;
    }

    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);

    fetch(ANALYST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: question, context: contextSnapshot() }),
      signal: controller.signal
    })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (data) {
        window.clearTimeout(timeout);
        streamInto(reply, data.text || composeBriefing(question));
      })
      .catch(function () {
        window.clearTimeout(timeout);
        streamInto(reply, composeBriefing(question), function () {
          toast("Analyst endpoint unreachable — answered from local fused data.", true);
        });
      });
  }

  function bindChat() {
    var form = $("chatForm");
    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var input = $("chatInput");
      var question = input.value.trim();
      if (!question) return;
      input.value = "";
      askAnalyst(question);
    });
  }

  /* ---------- NetCDF upload -------------------------------------------------- */

  var NETCDF_SIGNATURES = [
    { bytes: [0x43, 0x44, 0x46, 0x01], label: "NetCDF classic (CDF-1)" },
    { bytes: [0x43, 0x44, 0x46, 0x02], label: "NetCDF 64-bit offset (CDF-2)" },
    { bytes: [0x43, 0x44, 0x46, 0x05], label: "NetCDF CDF-5" },
    { bytes: [0x89, 0x48, 0x44, 0x46], label: "NetCDF-4 / HDF5" }
  ];

  function identifySignature(buffer) {
    var head = new Uint8Array(buffer.slice(0, 4));
    for (var i = 0; i < NETCDF_SIGNATURES.length; i++) {
      var sig = NETCDF_SIGNATURES[i].bytes;
      var match = true;
      for (var b = 0; b < sig.length; b++) {
        if (head[b] !== sig[b]) { match = false; break; }
      }
      if (match) return NETCDF_SIGNATURES[i].label;
    }
    return null;
  }

  function bindUpload() {
    var button = $("uploadButton");
    var input = $("netcdfInput");
    if (!button || !input) return;

    button.addEventListener("click", function () { input.click(); });

    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;

      file.slice(0, 8).arrayBuffer().then(function (buffer) {
        var kind = identifySignature(buffer);
        if (!kind) {
          toast(file.name + " is not a NetCDF or HDF5 file.", true);
          input.value = "";
          return;
        }

        var mb = (file.size / (1024 * 1024)).toFixed(1);
        SOURCES.unshift({
          name: file.name,
          state: "sync",
          note: kind + ", uploaded from this browser. Variable decoding runs server-side once the file is queued.",
          cadence: "Manual",
          latency: "queued",
          minutesAgo: 0
        });
        renderSources();
        renderKpis();
        toast(kind + " accepted — " + mb + " MB queued for ingestion.");
        input.value = "";
      }).catch(function () {
        toast("Could not read that file.", true);
        input.value = "";
      });
    });
  }

  /* ---------- public live tracks ---------------------------------------------- */

  function renderLiveTracks(rows, sourceLabel) {
    var host = $("liveTrackList");
    if (!host) return;
    host.innerHTML = "";

    rows.forEach(function (row) {
      var card = el("article", "live-track");
      card.appendChild(el("strong", null, row.name));
      card.appendChild(el("span", null, row.position + " · " + row.wind + " kt"));
      card.appendChild(el("em", null, row.basin + " · " + row.updated + " · " + sourceLabel));
      host.appendChild(card);
    });
  }

  function setLiveStatus(html, kind) {
    var node = $("liveFeedStatus");
    if (!node) return;
    node.className = "live-status" + (kind ? " is-" + kind : "");
    node.innerHTML = html;
  }

  function parseLiveResponse(text) {
    // JSON array of track objects.
    try {
      var parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.slice(0, 8).map(function (row) {
          return {
            name: String(row.name || row.NAME || "UNNAMED").toUpperCase(),
            basin: row.basin || row.BASIN || "—",
            position: Number(row.lat).toFixed(1) + "°N " + Number(row.lon).toFixed(1) + "°E",
            wind: Math.round(Number(row.wind) || 0),
            updated: row.time || row.ISO_TIME || "—"
          };
        });
      }
    } catch (error) { /* fall through to CSV */ }

    // IBTrACS CSV: SID, SEASON, NUMBER, BASIN, ..., NAME, ISO_TIME, LAT, LON, WMO_WIND
    var lines = text.trim().split(/\r?\n/);
    if (lines.length < 3) return [];
    var header = lines[0].split(",");
    var idx = {
      name: header.indexOf("NAME"),
      basin: header.indexOf("BASIN"),
      time: header.indexOf("ISO_TIME"),
      lat: header.indexOf("LAT"),
      lon: header.indexOf("LON"),
      wind: header.indexOf("WMO_WIND")
    };
    if (idx.name < 0 || idx.lat < 0) return [];

    var latest = {};
    for (var i = 2; i < lines.length; i++) {
      var cells = lines[i].split(",");
      var name = (cells[idx.name] || "").trim().toUpperCase();
      if (!name || name === "NOT_NAMED") continue;
      latest[name] = {
        name: name,
        basin: (cells[idx.basin] || "—").trim(),
        position: parseFloat(cells[idx.lat]).toFixed(1) + "°N " + parseFloat(cells[idx.lon]).toFixed(1) + "°E",
        wind: Math.round(parseFloat(cells[idx.wind]) || 0),
        updated: (cells[idx.time] || "—").trim()
      };
    }
    return Object.keys(latest).slice(-8).map(function (key) { return latest[key]; });
  }

  function refreshLiveTracks() {
    var button = $("refreshLive");

    if (!LIVE_TRACK_ENDPOINT) {
      setLiveStatus(
        "No live endpoint configured, so the four systems below are the bundled snapshot. " +
        "Set <code>LIVE_TRACK_ENDPOINT</code> in <code>app.js</code> to a server-side proxy of the " +
        "NOAA IBTrACS active list — browsers cannot read those files cross-origin directly.",
        "warn"
      );
      renderLiveTracks(LIVE_SNAPSHOT, "bundled snapshot");
      return;
    }

    if (button) { button.disabled = true; button.textContent = "Refreshing…"; }
    setLiveStatus("Requesting the public active-track feed…", null);

    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);

    fetch(LIVE_TRACK_ENDPOINT, { signal: controller.signal, cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.text();
      })
      .then(function (text) {
        window.clearTimeout(timeout);
        var rows = parseLiveResponse(text);
        if (!rows.length) throw new Error("no usable rows");
        setLiveStatus("Public feed reachable. Showing the " + rows.length + " most recent named systems.", "ok");
        renderLiveTracks(rows, "public feed");
        toast("Public tracks refreshed.");
      })
      .catch(function (error) {
        window.clearTimeout(timeout);
        var reason = error.name === "AbortError"
          ? "the request timed out"
          : "the browser blocked or rejected it (" + error.message + ")";
        setLiveStatus(
          "Could not read the public feed — " + reason + ". Showing the bundled snapshot instead. " +
          "A server-side proxy that adds CORS headers resolves this.",
          "error"
        );
        renderLiveTracks(LIVE_SNAPSHOT, "bundled snapshot");
      })
      .then(function () {
        if (button) { button.disabled = false; button.textContent = "Refresh public tracks"; }
      });
  }

  /* ---------- navigation ------------------------------------------------------ */

  function bindNav() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".nav-link"));
    var targets = links
      .map(function (link) { return document.querySelector(link.getAttribute("href")); })
      .filter(Boolean);

    if (!("IntersectionObserver" in window) || !targets.length) return;

    var inView = Object.create(null);

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { inView[entry.target.id] = entry.isIntersecting; });

      // Several sections can straddle the band at once; the topmost one wins.
      var current = null;
      for (var i = 0; i < targets.length; i++) {
        if (inView[targets[i].id]) { current = targets[i].id; break; }
      }
      if (!current) return;
      links.forEach(function (link) {
        link.classList.toggle("active", link.getAttribute("href") === "#" + current);
      });
    }, { rootMargin: "-8% 0px -72% 0px" });

    targets.forEach(function (target) { observer.observe(target); });
  }

  /* ---------- focus switching -------------------------------------------------- */

  function setFocus(id) {
    if (state.focusId === id) return;
    state.focusId = id;
    renderMap();
    renderSystemCards();
    renderFocus();
    renderChart();
    renderAttention();
  }

  /* ---------- init -------------------------------------------------------------- */

  function init() {
    renderKpis();
    renderMap();
    renderSystemCards();
    renderFocus();
    renderChart();
    renderAttention();
    renderAlerts();
    renderSources();
    bindAlertFilters();
    bindClassifier();
    bindChat();
    bindUpload();
    bindNav();
    tickClock();
    window.setInterval(tickClock, 30000);

    var refresh = $("refreshLive");
    if (refresh) refresh.addEventListener("click", refreshLiveTracks);
    refreshLiveTracks();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
