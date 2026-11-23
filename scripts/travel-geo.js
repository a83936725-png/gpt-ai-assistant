/**
 * Builds web/travel-geo.js: for every country on the map, its ISO code, a point to put the name on,
 * and the place flights usually land, so the page can label the map and estimate flight times.
 *
 *   npm pack world-countries@5.0.0 && tar xzf world-countries-5.0.0.tgz package/countries.json
 *   node scripts/travel-geo.js package/countries.json
 *
 * world-countries is ODbL; only codes and rough coordinates are taken from it.
 */
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import vm from 'vm';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const load = (file) => {
  const sandbox = {};
  vm.runInNewContext(readFileSync(path.join(ROOT, file), 'utf8'), sandbox);
  return sandbox;
};
const { d3 } = load('web/vendor/d3.min.js');
const { topojson } = load('web/vendor/topojson-client.min.js');

// Where flights to a large country usually land; elsewhere the label point is close enough.
/* eslint-disable object-property-newline */
const HUBS = {
  US: [34.05, -118.24], CA: [49.28, -123.12], RU: [55.75, 37.62], CN: [31.23, 121.47], BR: [-23.55, -46.63], AU: [-33.87, 151.21],
  IN: [28.61, 77.21], AR: [-34.6, -58.38], KZ: [43.24, 76.89], ID: [-8.65, 115.22], MX: [19.43, -99.13], CL: [-33.45, -70.67],
  SA: [24.71, 46.68], DZ: [36.75, 3.06], CD: [-4.32, 15.31], LY: [32.89, 13.19], SD: [15.5, 32.56], EG: [30.04, 31.24],
  MN: [47.89, 106.91], PE: [-12.05, -77.04], CO: [4.71, -74.07], ZA: [-26.2, 28.05], NG: [6.52, 3.38], ET: [8.98, 38.76],
  TZ: [-6.79, 39.21], KE: [-1.29, 36.82], IR: [35.69, 51.39], TR: [41.01, 28.98], NO: [59.91, 10.75], SE: [59.33, 18.07],
  FI: [60.17, 24.94], GL: [64.18, -51.72], NZ: [-36.85, 174.76], JP: [35.68, 139.76], VN: [10.82, 106.63], MY: [3.14, 101.69],
  PH: [14.6, 120.98], TH: [13.76, 100.5], IT: [41.9, 12.5], ES: [40.42, -3.7], FR: [48.86, 2.35], GB: [51.51, -0.13],
  DE: [50.11, 8.68], PK: [24.86, 67.0], MA: [33.57, -7.59], VE: [10.48, -66.9], BO: [-16.5, -68.15], MG: [-18.88, 47.51],
};
/* eslint-enable object-property-newline */

const main = (countriesFile) => {
  const list = JSON.parse(readFileSync(countriesFile, 'utf8'));
  const byNum = Object.fromEntries(list.filter((c) => c.ccn3).map((c) => [c.ccn3, c]));
  const topo = JSON.parse(readFileSync(path.join(ROOT, 'web/vendor/countries-50m.json'), 'utf8'));
  const { features } = topojson.feature(topo, topo.objects.countries);
  const out = {};
  features.forEach((f) => {
    const c = byNum[f.id];
    if (!c) return;
    // The biggest piece of the country, so France is labelled in Europe rather than between Europe and Guiana.
    const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    const biggest = polys.map((coordinates) => ({ type: 'Polygon', coordinates })).sort((a, b) => d3.geoArea(b) - d3.geoArea(a))[0];
    const candidates = [[c.latlng[1], c.latlng[0]], d3.geoCentroid(biggest)];
    const label = candidates.find((p) => d3.geoContains(biggest, p)) || candidates[1];
    const hub = HUBS[c.cca2] ? [HUBS[c.cca2][1], HUBS[c.cca2][0]] : label;
    const round = (v) => Math.round(v * 100) / 100;
    // [ISO code, label lng, label lat, area of the main piece in km², hub lng, hub lat]
    out[f.id] = [c.cca2, round(label[0]), round(label[1]), Math.round(d3.geoArea(biggest) * 6371 * 6371), round(hub[0]), round(hub[1])];
  });
  const body = `/* 由 scripts/travel-geo.js 產生：地圖國名位置與航班落地城市。國家代碼與座標取自 world-countries（ODbL）。 */
(function geo(global) {
  // eslint-disable-next-line
  global.TRAVEL_GEO = ${JSON.stringify(out)};
}(typeof window !== 'undefined' ? window : globalThis));
`;
  writeFileSync(path.join(ROOT, 'web/travel-geo.js'), body);
  console.log(`${Object.keys(out).length} countries`);
};

main(process.argv[2]);
