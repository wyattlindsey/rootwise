'use client';

import { useState } from 'react';

import type { PromptLocation } from '@/lib/chat/system-prompt';

export function LocationPicker({
  location,
  onChange,
}: {
  location: PromptLocation | null;
  onChange: (location: PromptLocation | null) => void;
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function useMyLocation(): void {
    if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
      setError('This browser cannot share a location. Type coordinates instead.');
      return;
    }

    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setBusy(false);
        onChange({
          latitude: Number(position.coords.latitude.toFixed(2)),
          longitude: Number(position.coords.longitude.toFixed(2)),
        });
      },
      () => {
        // Declining is normal. Degrade to manual entry rather than nagging.
        setBusy(false);
        setError('No location shared. You can type coordinates instead.');
      },
      { timeout: 10_000 },
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="opacity-60">Site:</span>

      {location === null ? (
        <span className="opacity-60">not set — timing answers need one</span>
      ) : (
        <span className="font-mono">
          {location.latitude}, {location.longitude}
        </span>
      )}

      <button
        type="button"
        onClick={useMyLocation}
        disabled={busy}
        className="rounded border border-black/15 px-2 py-1 hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
      >
        {busy ? 'Locating…' : 'Use my location'}
      </button>

      <label className="flex items-center gap-1">
        <span className="sr-only">Latitude</span>
        <input
          aria-label="Latitude"
          inputMode="decimal"
          placeholder="lat"
          defaultValue={location?.latitude ?? ''}
          onChange={(event) => {
            const latitude = Number(event.target.value);
            if (Number.isFinite(latitude) && event.target.value.trim() !== '') {
              onChange({ latitude, longitude: location?.longitude ?? 0 });
            }
          }}
          className="w-20 rounded border border-black/15 px-2 py-1 font-mono dark:border-white/20 dark:bg-transparent"
        />
      </label>

      <label className="flex items-center gap-1">
        <span className="sr-only">Longitude</span>
        <input
          aria-label="Longitude"
          inputMode="decimal"
          placeholder="lon"
          defaultValue={location?.longitude ?? ''}
          onChange={(event) => {
            const longitude = Number(event.target.value);
            if (Number.isFinite(longitude) && event.target.value.trim() !== '') {
              onChange({ latitude: location?.latitude ?? 0, longitude });
            }
          }}
          className="w-20 rounded border border-black/15 px-2 py-1 font-mono dark:border-white/20 dark:bg-transparent"
        />
      </label>

      {error === null ? null : (
        <span role="status" className="opacity-70">
          {error}
        </span>
      )}
    </div>
  );
}
