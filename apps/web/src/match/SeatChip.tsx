import { SeatCrest } from '../art/SeatCrest.tsx';
import type { SeatName } from './match-text.ts';

/**
 * Ein Sitz als Plättchen in seiner Farbe: Wappen und Name. Steht in der Auflösung an der Antwort,
 * die der Sitz gegeben hat, und in der Ansage eines Duells (docs/ART_DIRECTION.md §4).
 */
export function SeatChip({ seat, name }: { readonly seat: number; readonly name: SeatName }) {
  return (
    <span className={`seat-chip seat-${seat}`} data-seat={seat}>
      <SeatCrest seat={seat} size={20} />
      <span className="seat-chip-name">{name(seat)}</span>
    </span>
  );
}
