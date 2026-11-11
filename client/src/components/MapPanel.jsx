import { when } from './ui.jsx';

const q = encodeURIComponent;

/**
 * Route links and, only when the delivery partner has actually shared a location, an OpenStreetMap view of that point.
 * No coordinates are ever guessed: without a shared location we show addresses and navigation links only.
 */
export default function MapPanel({ pickup, destination, last }) {
  const gmaps = `https://www.google.com/maps/dir/?api=1&origin=${q(pickup || '')}&destination=${q(destination || '')}&travelmode=driving`;
  const lat = last ? Number(last.latitude) : null;
  const lon = last ? Number(last.longitude) : null;
  const d = 0.01;
  return (
    <div className="space-y-3">
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs uppercase text-slate-500">Pickup</dt><dd className="text-slate-800">{pickup || 'Not recorded'}</dd></div>
        <div><dt className="text-xs uppercase text-slate-500">Destination</dt><dd className="text-slate-800">{destination || 'Not recorded'}</dd></div>
      </dl>
      {last ? (
        <>
          <iframe title="Last shared location" loading="lazy" className="h-56 w-full rounded-lg border border-slate-200"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${lon - d},${lat - d},${lon + d},${lat + d}&layer=mapnik&marker=${lat},${lon}`} />
          <p className="text-xs text-slate-500">Last location shared {when(last.recorded_at)}. This is not live tracking: the position updates only while the partner's device shares it.</p>
        </>
      ) : <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">No live location has been shared. Status updates come from the delivery partner.</p>}
      {(pickup || destination) && <a className="inline-block text-sm font-medium text-brand-700 hover:underline" href={gmaps} target="_blank" rel="noreferrer">Open route in Google Maps ↗</a>}
    </div>
  );
}
