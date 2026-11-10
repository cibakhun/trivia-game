import type { Axial } from '@rdw/game-core';
import { useEffect, useRef } from 'react';
import { t } from '../i18n/i18n.ts';
import type { Bounds } from './layout.ts';
import { MapView, type MapRegion } from './MapView.ts';

const ZOOM_STEP = 1.25;

function coarsePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/** React-Hülle der PixiJS-Karte; Daten und Auswahl kommen von außen. */
export function MapCanvas({
  regions,
  selected,
  highlighted,
  centre,
  onSelect,
  onViewport,
}: {
  readonly regions: readonly MapRegion[];
  readonly selected: string | null;
  readonly highlighted: string | null;
  /** Wechselt der Wert, wird die Karte darauf zentriert. */
  readonly centre: Axial | null;
  readonly onSelect: (regionId: string) => void;
  readonly onViewport: (bounds: Bounds) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<MapView | null>(null);
  const handlers = useRef({ onSelect, onViewport });
  handlers.current = { onSelect, onViewport };
  const latest = useRef({ regions, selected, highlighted, centre });
  latest.current = { regions, selected, highlighted, centre };

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let active = true;
    let created: MapView | null = null;
    void MapView.create(element, {
      onSelect: (id) => handlers.current.onSelect(id),
      onViewport: (bounds) => handlers.current.onViewport(bounds),
    }).then((mapView) => {
      created = mapView;
      if (!active) {
        mapView.destroy();
        return;
      }
      view.current = mapView;
      const state = latest.current;
      mapView.setRegions(state.regions);
      mapView.setSelected(state.selected);
      mapView.setHighlighted(state.highlighted);
      if (state.centre) mapView.centreOn(state.centre);
      else handlers.current.onViewport(mapView.viewport());
    });
    return () => {
      active = false;
      created?.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => view.current?.setRegions(regions), [regions]);
  useEffect(() => view.current?.setSelected(selected), [selected]);
  useEffect(() => view.current?.setHighlighted(highlighted), [highlighted]);
  useEffect(() => {
    if (centre) view.current?.centreOn(centre);
  }, [centre]);

  return (
    <div className="map-wrap">
      <div className="map" ref={host} role="img" aria-label={t('map.label')} />
      <div className="map-zoom">
        <button
          type="button"
          className="button"
          aria-label={t('map.zoomIn')}
          onClick={() => view.current?.zoomBy(ZOOM_STEP)}
        >
          +
        </button>
        <button
          type="button"
          className="button"
          aria-label={t('map.zoomOut')}
          onClick={() => view.current?.zoomBy(1 / ZOOM_STEP)}
        >
          −
        </button>
      </div>
      <p className="map-hint">{coarsePointer() ? t('map.hintTouch') : t('map.hint')}</p>
    </div>
  );
}
