import * as Cesium from 'cesium';
import { decodePackGeoJSON } from '../../director/packs/geojson.js';
const xyz = (p) => Cesium.Cartesian3.fromDegrees(...p);
const lonLat = (p) => Cesium.Cartesian3.fromDegrees(p[0], p[1]);

/**
 * Render a bounded geometry pack in owned batches; no asynchronous entity geometry or update loop.
 * `placement.color` (#rrggbb or #rrggbbaa) colours every feature of the pack; cyan otherwise.
 * `placement.drape: true` paints lines and polygons onto terrain and 3D Tiles (Cesium
 * classification) instead of placing them at their ellipsoid heights; points keep their heights.
 */
export async function renderPackGeometry({ asset, pack }, handle) {
  if (!['application/json', 'application/geo+json'].includes(asset.mimeType))
    throw new Error('Expected GeoJSON');
  const features = decodePackGeoJSON(asset.bytes);
  const color = pack.placement?.color
    ? Cesium.Color.fromCssColorString(pack.placement.color)
    : Cesium.Color.CYAN;
  const fill = color.alpha < 1 ? color : color.withAlpha(0.35);
  const drape = pack.placement?.drape === true;
  if (drape) await Cesium.GroundPrimitive.initializeTerrainHeights();
  const polygons = [];
  const groundLines = [];
  let lines;
  for (const feature of features) {
    const id = { packId: pack.id, featureId: feature.id };
    if (feature.type === 'Point') {
      const entity = handle.add({
        name: `${pack.id} / ${feature.id}`,
        position: xyz(feature.coordinates),
        point: {
          pixelSize: 12,
          color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
        },
      });
      handle.feature?.(id, entity);
    } else if (feature.type === 'LineString') {
      handle.feature?.(id, id);
      if (drape) {
        groundLines.push(
          new Cesium.GeometryInstance({
            id,
            geometry: new Cesium.GroundPolylineGeometry({
              positions: feature.coordinates.map(lonLat),
              width: 4,
            }),
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
            },
          }),
        );
        continue;
      }
      if (!lines) {
        lines = new Cesium.PolylineCollection();
        handle.primitive(lines);
      }
      lines.add({
        id,
        positions: feature.coordinates.map(xyz),
        width: 4,
        material: Cesium.Material.fromType('Color', { color }),
      });
    } else {
      handle.feature?.(id, id);
      const toPos = drape ? lonLat : xyz;
      polygons.push(
        new Cesium.GeometryInstance({
          id,
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(
              feature.coordinates[0].map(toPos),
              feature.coordinates
                .slice(1)
                .map((ring) => new Cesium.PolygonHierarchy(ring.map(toPos))),
            ),
            perPositionHeight: !drape,
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
            arcType: Cesium.ArcType.GEODESIC,
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(fill),
          },
        }),
      );
    }
  }
  if (polygons.length)
    handle.primitive(
      drape
        ? new Cesium.GroundPrimitive({
            asynchronous: false,
            geometryInstances: polygons,
            classificationType: Cesium.ClassificationType.BOTH,
            appearance: new Cesium.PerInstanceColorAppearance({
              translucent: fill.alpha < 1,
              flat: true,
            }),
          })
        : new Cesium.Primitive({
            asynchronous: false,
            geometryInstances: polygons,
            appearance: new Cesium.PerInstanceColorAppearance({
              translucent: true,
              flat: true,
              closed: false,
            }),
          }),
    );
  if (groundLines.length)
    handle.primitive(
      new Cesium.GroundPolylinePrimitive({
        asynchronous: false,
        geometryInstances: groundLines,
        classificationType: Cesium.ClassificationType.BOTH,
        appearance: new Cesium.PolylineColorAppearance(),
      }),
    );
}
