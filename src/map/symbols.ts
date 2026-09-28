/** Chart-style symbols for the map and the procedure chart, as SVG markup centred on 0,0. */
import type { FixKind } from '../model/types';

const hexagon = (r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

/** The navaid or fix symbol FAA charts use for a kind, `r` about its radius, in `ink`. */
export function fixSymbol(kind: FixKind, r: number, ink: string): string {
  const s = `stroke="${ink}" stroke-width="${(r / 5).toFixed(2)}" fill="none"`;
  switch (kind) {
    case 'waypoint': {
      // RNAV waypoint: a four-pointed star.
      const k = r * 0.28;
      return `<path d="M0 ${-r} L${k} ${-k} L${r} 0 L${k} ${k} L0 ${r} L${-k} ${k} L${-r} 0 L${-k} ${-k} Z" fill="${ink}"/>`;
    }
    case 'fix':
      return `<path d="M0 ${-r} L${r * 0.87} ${r * 0.5} L${-r * 0.87} ${r * 0.5} Z" ${s}/>`;
    case 'vor':
      return `<polygon points="${hexagon(r)}" ${s}/><circle r="${r / 6}" fill="${ink}"/>`;
    case 'vordme':
      return `<rect x="${-r * 1.1}" y="${-r}" width="${r * 2.2}" height="${r * 2}" ${s}/><polygon points="${hexagon(r * 0.8)}" ${s}/><circle r="${r / 6}" fill="${ink}"/>`;
    case 'vortac':
    case 'tacan': {
      const lobes = [90, 210, 330]
        .map((deg) => {
          const a = (deg * Math.PI) / 180;
          const cx = Math.cos(a) * r * 0.95;
          const cy = -Math.sin(a) * r * 0.95;
          return `<rect x="${(cx - r * 0.35).toFixed(2)}" y="${(cy - r * 0.18).toFixed(2)}" width="${(r * 0.7).toFixed(2)}" height="${(r * 0.36).toFixed(2)}" fill="${ink}" transform="rotate(${(90 - deg).toFixed(0)} ${cx.toFixed(2)} ${cy.toFixed(2)})"/>`;
        })
        .join('');
      return `${kind === 'vortac' ? `<polygon points="${hexagon(r * 0.8)}" ${s}/>` : ''}${lobes}<circle r="${r / 6}" fill="${ink}"/>`;
    }
    case 'dme':
      return `<rect x="${-r}" y="${-r * 0.8}" width="${r * 2}" height="${r * 1.6}" ${s}/><circle r="${r / 6}" fill="${ink}"/>`;
    case 'ndb': {
      const dots = Array.from({ length: 12 }, (_, i) => {
        const a = (Math.PI / 6) * i;
        return `<circle cx="${(Math.cos(a) * r).toFixed(2)}" cy="${(Math.sin(a) * r).toFixed(2)}" r="${(r / 9).toFixed(2)}" fill="${ink}"/>`;
      }).join('');
      return `${dots}<circle r="${r / 3}" fill="${ink}"/>`;
    }
  }
}
