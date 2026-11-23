import { useLayoutEffect, useRef, type RefObject } from 'react';
import { HeroMap } from '../art/HeroMap.tsx';
import type { MatchScreenState } from './match-model.ts';
import { ghostOf } from './StageCentre.tsx';

/**
 * Auftakt der Partie (ADR-081): Aus der Aufstellung wird die Bühne nicht mit einem harten
 * Schnitt. Das Blatt der Aufstellung hebt sich als stilles Abbild ab, die Karte der Partie rollt
 * sich von der Mitte her zwischen zwei Rollen über dem Schmuckbild aus, danach schreiben sich
 * Spielstand und Blatt ein (`useOpening` in stage-live.ts, `.stage.opening` in stage.css).
 * Bewegt werden an Karte, Rändern und Zugfolge nur `opacity` und `clip-path`: Ihre Lage bleibt
 * vom ersten Bild an dieselbe.
 */

/**
 * Merkt sich das Blatt der Aufstellung, solange es steht (`centre` an die Mitte der Aufstellung).
 * Ist es fort, lebt sein Knoten noch und gibt das Abbild her (wie in `StageCentre`).
 */
export function useLobbySheet(state: MatchScreenState): {
  readonly centre: RefObject<HTMLDivElement | null>;
  readonly sheet: RefObject<Element | null>;
} {
  const centre = useRef<HTMLDivElement>(null);
  const sheet = useRef<Element | null>(null);
  useLayoutEffect(() => {
    if (state === 'lobby') sheet.current = centre.current?.firstElementChild ?? null;
  });
  return { centre, sheet };
}

/** Unter der Karte: das Schmuckbild der Aufstellung mit ihrem Schleier, über das sie sich rollt. */
export function OpeningCover() {
  return (
    <div className="opening-cover" aria-hidden="true">
      <HeroMap cover />
    </div>
  );
}

/**
 * Über der Karte: die beiden Rollen an den Kanten der Karte und das Abbild des Blatts der
 * Aufstellung, an derselben Stelle wie zuvor. Nichts davon nimmt Tipps an oder wird vorgelesen.
 */
export function OpeningLayer({ sheet }: { readonly sheet: RefObject<Element | null> }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const layer = host.current;
    const before = sheet.current;
    if (!layer || !before) return;
    layer.replaceChildren(ghostOf(before));
    return () => layer.replaceChildren();
  }, [sheet]);
  return (
    <>
      <div className="opening-rolls" aria-hidden="true">
        <span className="opening-roll roll-l" />
        <span className="opening-roll roll-r" />
      </div>
      <div ref={host} className="opening-lobby" aria-hidden="true" inert />
    </>
  );
}
