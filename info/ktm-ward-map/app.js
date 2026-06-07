const CITY_BOUNDS = [
  [27.6679494, 85.2771438],
  [27.7500026, 85.3731257],
];

// Raster bounds are derived from the OSM city bbox and the detected colored
// ward extent in the source map image: x 557-1769, y 155-1328.
const RASTER_BOUNDS = [
  [27.6636124, 85.2552865],
  [27.7544795, 85.3944286],
];

const wardColors = [
  "#79c6d8", "#b8a8f4", "#70d1c4", "#dbe76a", "#f08fb6", "#c8a2ff", "#8b7ce9", "#86d7a4",
  "#9ddd74", "#f0bd70", "#ef8f70", "#7bd889", "#8bbfe0", "#a4de83", "#b0b5ee", "#77dba3",
  "#fac38e", "#75cde2", "#e8e76a", "#f28f8f", "#c8a7ef", "#ee83d2", "#758ce7", "#f1d76d",
  "#f0a8c8", "#ef7d8d", "#dda2f1", "#e581dd", "#ead85f", "#91d6df", "#ec78b5", "#948eea",
];

const dom = {
  basemap: document.querySelector("#basemap"),
  imageToggle: document.querySelector("#imageToggle"),
  wardToggle: document.querySelector("#wardToggle"),
  labelToggle: document.querySelector("#labelToggle"),
  opacity: document.querySelector("#opacity"),
  status: document.querySelector("#status"),
  wardSelect: document.querySelector("#wardSelect"),
};

const map = L.map("map", {
  zoomControl: false,
  preferCanvas: true,
  maxBoundsViscosity: 0.6,
});

L.control.zoom({ position: "bottomright" }).addTo(map);

const baseLayers = {
  streets: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 20,
    attribution: "OpenStreetMap contributors",
  }),
  light: L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    attribution: "OpenStreetMap contributors | CARTO",
  }),
  imagery: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles Esri",
  }),
};

let currentBase = baseLayers.streets.addTo(map);
let cityLayer = null;
let wardLayer = null;
let labelLayer = L.layerGroup().addTo(map);
let selectedWardLayer = null;
const wardIndex = new Map();

const rasterLayer = L.imageOverlay("kathmandu-ward-map-cropped.jpg", RASTER_BOUNDS, {
  opacity: Number(dom.opacity.value),
  className: "ward-raster",
  interactive: false,
}).addTo(map);

map.fitBounds(CITY_BOUNDS, { padding: [20, 20] });

dom.basemap.addEventListener("change", () => {
  map.removeLayer(currentBase);
  currentBase = baseLayers[dom.basemap.value].addTo(map);
  currentBase.bringToBack();
});

dom.imageToggle.addEventListener("change", () => {
  toggleLayer(rasterLayer, dom.imageToggle.checked);
});

dom.wardToggle.addEventListener("change", () => {
  if (wardLayer) toggleLayer(wardLayer, dom.wardToggle.checked);
});

dom.labelToggle.addEventListener("change", () => {
  toggleLayer(labelLayer, dom.labelToggle.checked);
});

dom.opacity.addEventListener("input", () => {
  rasterLayer.setOpacity(Number(dom.opacity.value));
});

dom.wardSelect.addEventListener("change", () => {
  const ward = dom.wardSelect.value;
  clearSelectedWard();

  if (!ward) {
    map.fitBounds(CITY_BOUNDS, { padding: [26, 26] });
    return;
  }

  selectedWardLayer = wardIndex.get(ward);
  if (!selectedWardLayer) return;

  selectedWardLayer.setStyle({
    weight: 3,
    color: "#0f172a",
    fillOpacity: 0.5,
  });
  selectedWardLayer.bringToFront();
  map.fitBounds(selectedWardLayer.getBounds(), { padding: [48, 48] });
});

loadWardBoundaries();

async function loadWardBoundaries() {
  try {
    const response = await fetch("data/kathmandu-wards.geojson");
    if (!response.ok) {
      throw new Error(`Local ward GeoJSON returned ${response.status}`);
    }

    const geojson = await response.json();
    const cityFeatures = geojson.features.filter((feature) => {
      const props = feature.properties || {};
      return props.id === "relation/12394677" || props.osm_id === 12394677;
    });
    const wardFeatures = geojson.features
      .filter((feature) => String(feature.properties?.admin_level || "") === "9")
      .sort((a, b) => wardNumber(a.properties) - wardNumber(b.properties));

    drawCityBoundary(cityFeatures);
    drawWardBoundaries(wardFeatures);
    populateWardSelect(wardFeatures);
    const loadedWards = new Set(wardFeatures.map((feature) => wardNumber(feature.properties)));
    setStatus(
      loadedWards.size === 32
        ? "32 OSM ward polygons"
        : `${loadedWards.size}/32 OSM wards | raster shows all`,
      loadedWards.size !== 32,
    );
  } catch (error) {
    console.error(error);
    dom.wardToggle.checked = false;
    dom.wardToggle.disabled = true;
    dom.labelToggle.checked = false;
    dom.labelToggle.disabled = true;
    setStatus("Image overlay active", true);
  }
}

function drawCityBoundary(features) {
  if (!features.length) return;

  cityLayer = L.geoJSON(features, {
    interactive: false,
    style: {
      color: "#111827",
      weight: 2.5,
      opacity: 0.9,
      fillOpacity: 0,
    },
  }).addTo(map);
}

function drawWardBoundaries(features) {
  wardLayer = L.geoJSON(features, {
    style: wardStyle,
    onEachFeature(feature, layer) {
      const ward = wardNumber(feature.properties);
      wardIndex.set(String(ward), layer);
      layer.bindPopup(popupMarkup(feature.properties, ward));
      layer.on({
        mouseover: () => {
          if (selectedWardLayer !== layer) {
            layer.setStyle({ weight: 2.4, fillOpacity: 0.42 });
            layer.bringToFront();
          }
        },
        mouseout: () => {
          if (selectedWardLayer !== layer) {
            wardLayer.resetStyle(layer);
          }
        },
      });

      const center = layer.getBounds().getCenter();
      L.marker(center, {
        interactive: false,
        icon: L.divIcon({
          className: "ward-label",
          html: ward,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
      }).addTo(labelLayer);
    },
  }).addTo(map);
}

function populateWardSelect(features) {
  const fragment = document.createDocumentFragment();
  const vectorWards = new Set(
    features
      .map((feature) => wardNumber(feature.properties))
      .filter((ward) => Number.isFinite(ward)),
  );

  for (let ward = 1; ward <= 32; ward += 1) {
    const option = document.createElement("option");
    option.value = String(ward);
    option.textContent = vectorWards.has(ward) ? `Ward ${ward}` : `Ward ${ward} (raster)`;
    option.disabled = !vectorWards.has(ward);
    fragment.append(option);
  }

  dom.wardSelect.append(fragment);
}

function wardStyle(feature) {
  const ward = wardNumber(feature.properties);
  const color = wardColors[(ward - 1) % wardColors.length];

  return {
    color: "#1f2937",
    weight: 1.35,
    opacity: 0.85,
    fillColor: color,
    fillOpacity: 0.28,
  };
}

function wardNumber(properties = {}) {
  const fields = [
    properties.ref,
    properties.name,
    properties["name:en"],
    properties.ward,
    properties["addr:ward"],
  ].filter(Boolean);

  for (const field of fields) {
    const match = String(field).match(/\b([1-9]|[12][0-9]|3[0-2])\b/);
    if (match) return Number(match[1]);
  }

  const idMatch = String(properties.id || "").match(/(\d+)$/);
  return idMatch ? Number(idMatch[1]) : 0;
}

function popupMarkup(properties, ward) {
  const name = properties["name:en"] || properties.name || `Ward ${ward}`;
  const osmId = properties.id || "OSM relation";

  return `
    <div class="popup-title">Ward ${ward}</div>
    <div>${escapeHtml(name)}</div>
    <div class="popup-meta">${escapeHtml(osmId)}</div>
  `;
}

function clearSelectedWard() {
  if (selectedWardLayer && wardLayer) {
    wardLayer.resetStyle(selectedWardLayer);
  }
  selectedWardLayer = null;
}

function toggleLayer(layer, enabled) {
  if (enabled && !map.hasLayer(layer)) {
    layer.addTo(map);
  } else if (!enabled && map.hasLayer(layer)) {
    map.removeLayer(layer);
  }
}

function setStatus(message, warning = false) {
  dom.status.textContent = message;
  dom.status.classList.toggle("is-warning", warning);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
