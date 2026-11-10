import type { ChunkCoord } from '@rdw/game-core';
import { useCallback, useMemo, useState } from 'react';
import { api } from '../api/client.ts';
import { MapLoader } from './map-loader.ts';

/** Kartendaten der Instanz für die Oberfläche; die Buchführung steckt in `MapLoader`. */
export function useMapData(instanceId: string) {
  const [, setVersion] = useState(0);
  const loader = useMemo(
    () =>
      new MapLoader(
        {
          mapStatic: (chunks) => api.mapStatic(instanceId, chunks),
          mapState: (chunks) => api.mapState(instanceId, chunks),
        },
        () => setVersion((version) => version + 1),
      ),
    [instanceId],
  );
  const ensureChunks = useCallback(
    (chunks: readonly ChunkCoord[]) => loader.ensureChunks(chunks),
    [loader],
  );
  const refresh = useCallback(() => loader.refresh(), [loader]);
  return { data: loader.data, error: loader.error, ensureChunks, refresh };
}
