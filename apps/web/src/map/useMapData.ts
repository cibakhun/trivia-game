import { useMemo, useSyncExternalStore } from 'react';
import { api } from '../api/client.ts';
import { MapLoader } from './map-loader.ts';

/** Kartendaten der Instanz für die Oberfläche; die Buchführung steckt in `MapLoader`. */
export function useMapData(instanceId: string) {
  const loader = useMemo(
    () =>
      new MapLoader({
        mapStatic: (chunks) => api.mapStatic(instanceId, chunks),
        mapState: (chunks) => api.mapState(instanceId, chunks),
      }),
    [instanceId],
  );
  const { data, error } = useSyncExternalStore(loader.subscribe, loader.getSnapshot);
  // Methoden der Instanz sind stabil, solange sich `instanceId` nicht ändert
  const actions = useMemo(
    () => ({
      ensureChunks: loader.ensureChunks.bind(loader),
      refresh: loader.refresh.bind(loader),
    }),
    [loader],
  );
  return { data, error, ...actions };
}
