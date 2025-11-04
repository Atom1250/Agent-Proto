'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

import { apiUrl } from '../../../lib/api';

type DiagnosticsPayload = {
  version: string;
  buildSha: string;
  database: {
    status: 'ok' | 'error';
    latencyMs: number | null;
  };
};

function formatLatency(latencyMs: number | null) {
  if (latencyMs === null || Number.isNaN(latencyMs)) {
    return '—';
  }
  return `${latencyMs.toFixed(latencyMs >= 10 ? 0 : 1)} ms`;
}

export default function DiagnosticsPage() {
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsPayload | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!password) {
      setError('Admin password is required.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(apiUrl('/v1/admin/diagnostics'), {
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': password,
        },
      });

      if (response.status === 401) {
        setError('Incorrect admin password.');
        setDiagnostics(null);
        return;
      }

      if (!response.ok) {
        throw new Error(`Diagnostics request failed (${response.status})`);
      }

      const payload = (await response.json()) as DiagnosticsPayload;
      setDiagnostics(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diagnostics.');
      setDiagnostics(null);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin diagnostics</h1>
        <Link className="text-sm text-blue-600 hover:underline" href="/admin">
          ← Back to admin console
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded border border-gray-200 p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-sm">
          Admin password
          <input
            className="rounded border border-gray-300 px-3 py-2 text-base"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isLoading}
          />
        </label>
        <button
          className="w-fit rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          type="submit"
          disabled={isLoading}
        >
          {isLoading ? 'Loading…' : 'Load diagnostics'}
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>

      {diagnostics ? (
        <section className="space-y-3 rounded border border-gray-200 p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Application</h2>
          <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
            <div>
              <div className="font-medium text-gray-600">Version</div>
              <div className="text-gray-900">{diagnostics.version}</div>
            </div>
            <div>
              <div className="font-medium text-gray-600">Build SHA</div>
              <div className="font-mono text-gray-900">{diagnostics.buildSha}</div>
            </div>
            <div>
              <div className="font-medium text-gray-600">Database status</div>
              <div className={diagnostics.database.status === 'ok' ? 'text-green-600' : 'text-red-600'}>
                {diagnostics.database.status === 'ok' ? 'Healthy' : 'Unavailable'}
              </div>
            </div>
            <div>
              <div className="font-medium text-gray-600">Database latency</div>
              <div className="text-gray-900">{formatLatency(diagnostics.database.latencyMs)}</div>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
