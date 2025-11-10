'use client';

import type { CSSProperties, FormEvent } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { apiUrl } from '../../../lib/api';

const containerStyle: CSSProperties = {
  margin: '0 auto',
  minHeight: '100vh',
  maxWidth: 640,
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont',
};

const cardStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  backgroundColor: '#ffffff',
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  boxShadow: '0 10px 30px rgba(15, 23, 42, 0.05)',
};

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const labelTextStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: '#374151',
};

const inputStyle: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 14,
  outline: 'none',
};

const buttonStyle: CSSProperties = {
  borderRadius: 8,
  padding: '12px 16px',
  fontSize: 14,
  fontWeight: 600,
  color: '#ffffff',
  backgroundColor: '#2563eb',
  border: 'none',
  display: 'inline-flex',
  justifyContent: 'center',
};

const secondaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  backgroundColor: '#111827',
};

const selectStyle: CSSProperties = {
  ...inputStyle,
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  backgroundImage:
    'linear-gradient(45deg, transparent 50%, #6b7280 50%), linear-gradient(135deg, #6b7280 50%, transparent 50%), linear-gradient(to right, #d1d5db, #d1d5db)',
  backgroundPosition: 'calc(100% - 20px) calc(1.1em), calc(100% - 15px) calc(1.1em), calc(100% - 2.5em) 0.5em',
  backgroundSize: '5px 5px, 5px 5px, 1px 1.6em',
  backgroundRepeat: 'no-repeat',
};

interface TemplateOption {
  id: string;
  key: string;
  name: string;
}

export default function StartSessionPage() {
  const router = useRouter();
  const [clientId, setClientId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [isGeneratingClient, setIsGeneratingClient] = useState(false);
  const [lastGeneratedClientName, setLastGeneratedClientName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function hydrateTemplates() {
      setIsInitializing(true);
      setInitializationError(null);

      try {
        const templateList = await fetchTemplates();
        if (!cancelled && templateList.length > 0) {
          setTemplates(templateList);
          setTemplateId((prev) => prev || templateList[0]?.id ?? '');
          return;
        }

        const ensured = await bootstrapTemplates();
        if (!cancelled) {
          setTemplates(ensured);
          setTemplateId((prev) => prev || ensured[0]?.id ?? '');
        }
      } catch (err) {
        if (!cancelled) {
          setInitializationError(
            err instanceof Error ? err.message : 'Failed to load templates. Please try again.',
          );
        }
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    }

    void hydrateTemplates();

    return () => {
      cancelled = true;
    };
  }, []);

  async function fetchTemplates(): Promise<TemplateOption[]> {
    const response = await fetch(apiUrl('/v1/templates'));
    if (!response.ok) {
      throw new Error('Unable to fetch templates');
    }

    const payload = (await response.json()) as { templates?: TemplateOption[] };
    return Array.isArray(payload?.templates) ? payload.templates : [];
  }

  async function bootstrapTemplates(): Promise<TemplateOption[]> {
    const response = await fetch(apiUrl('/v1/setup/bootstrap'), { method: 'POST' });
    if (!response.ok) {
      throw new Error('Unable to initialize templates');
    }

    const payload = (await response.json()) as { templates?: TemplateOption[] };
    return Array.isArray(payload?.templates) ? payload.templates : [];
  }

  async function handleGenerateClient() {
    setIsGeneratingClient(true);
    setError(null);

    try {
      const response = await fetch(apiUrl('/v1/clients'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const payload = await response
        .json()
        .catch(() => ({ client: undefined, error: 'Invalid response from server' }));

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to create client');
      }

      const client = payload?.client as { id?: string; name?: string | null } | undefined;
      if (!client || typeof client.id !== 'string') {
        throw new Error('Client ID missing in response');
      }

      setClientId(client.id);
      setLastGeneratedClientName(client.name ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setIsGeneratingClient(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientId || !templateId) {
      setError('Client ID and Template selection are required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(apiUrl('/v1/sessions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, templateId }),
      });

      const payload = await response
        .json()
        .catch(() => ({ sessionId: undefined, error: 'Invalid response from server' }));

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to start session');
      }

      const sessionId = payload?.sessionId ?? payload?.id;
      if (!sessionId || typeof sessionId !== 'string') {
        throw new Error('Session ID missing in response');
      }

      router.push(`/sessions/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={containerStyle}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600 }}>Start a new onboarding session</h1>
        <p style={{ fontSize: 14, color: '#4b5563', lineHeight: 1.5 }}>
          Provide the client and template identifiers to create a new session, then start chatting to
          collect the required information.
        </p>
        <Link href="/" style={{ fontSize: 13, color: '#2563eb' }}>
          ← Back to home
        </Link>
      </header>
      <section style={cardStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Quick setup</h2>
        <p style={{ fontSize: 14, color: '#4b5563', lineHeight: 1.5 }}>
          Use these helpers to generate the IDs you need. Templates are initialized automatically on
          first load.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            type="button"
            onClick={() => void handleGenerateClient()}
            disabled={isGeneratingClient}
            style={{
              ...secondaryButtonStyle,
              opacity: isGeneratingClient ? 0.7 : 1,
              cursor: isGeneratingClient ? 'wait' : 'pointer',
            }}
          >
            {isGeneratingClient ? 'Generating client…' : 'Generate client ID'}
          </button>
          {lastGeneratedClientName ? (
            <p style={{ fontSize: 13, color: '#059669' }}>
              Created client <strong>{lastGeneratedClientName}</strong>
            </p>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={labelTextStyle}>Templates</span>
          {isInitializing ? (
            <p style={{ fontSize: 13, color: '#6b7280' }}>Loading templates…</p>
          ) : templates.length > 0 ? (
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              style={selectStyle}
            >
              <option value="" disabled>
                Select a template
              </option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template.key})
                </option>
              ))}
            </select>
          ) : (
            <p style={{ fontSize: 13, color: '#dc2626' }}>
              No templates available. Retry initialization below.
            </p>
          )}
          {initializationError ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 13, color: '#dc2626' }}>{initializationError}</p>
              <button
                type="button"
                onClick={() => {
                  setTemplates([]);
                  setInitializationError(null);
                  setIsInitializing(true);
                  void (async () => {
                    try {
                      const hydrated = await bootstrapTemplates();
                      setTemplates(hydrated);
                      setTemplateId((prev) => prev || hydrated[0]?.id ?? '');
                    } catch (err) {
                      setInitializationError(
                        err instanceof Error
                          ? err.message
                          : 'Failed to initialize templates. Please try again.',
                      );
                    } finally {
                      setIsInitializing(false);
                    }
                  })();
                }}
                style={{
                  ...secondaryButtonStyle,
                  backgroundColor: '#2563eb',
                  cursor: 'pointer',
                }}
              >
                Retry initialization
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <form onSubmit={handleSubmit} style={cardStyle}>
        <label style={labelStyle}>
          <span style={labelTextStyle}>Client ID</span>
          <input
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="Enter client ID"
            style={{ ...inputStyle, borderColor: error && !clientId ? '#dc2626' : '#d1d5db' }}
          />
        </label>

        <label style={labelStyle}>
          <span style={labelTextStyle}>Template</span>
          <select
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
            style={{
              ...selectStyle,
              borderColor: error && !templateId ? '#dc2626' : '#d1d5db',
              color: templateId ? '#111827' : '#6b7280',
            }}
            disabled={isInitializing || templates.length === 0}
          >
            <option value="" disabled>
              {isInitializing ? 'Loading templates…' : 'Select a template'}
            </option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} ({template.key})
              </option>
            ))}
          </select>
        </label>

        {error ? <p style={{ fontSize: 13, color: '#dc2626' }}>{error}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting || isInitializing || !templateId}
          style={{
            ...buttonStyle,
            opacity: isSubmitting || isInitializing || !templateId ? 0.7 : 1,
            cursor: isSubmitting || isInitializing || !templateId ? 'not-allowed' : 'pointer',
          }}
        >
          {isSubmitting ? 'Starting session…' : 'Start session'}
        </button>
      </form>
    </main>
  );
}
