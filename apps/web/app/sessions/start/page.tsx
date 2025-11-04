'use client';

import type { CSSProperties, FormEvent } from 'react';
import { useState } from 'react';
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

export default function StartSessionPage() {
  const router = useRouter();
  const [clientId, setClientId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientId || !templateId) {
      setError('Client ID and Template ID are required.');
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
          <span style={labelTextStyle}>Template ID</span>
          <input
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
            placeholder="Enter template ID"
            style={{ ...inputStyle, borderColor: error && !templateId ? '#dc2626' : '#d1d5db' }}
          />
        </label>

        {error ? <p style={{ fontSize: 13, color: '#dc2626' }}>{error}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting}
          style={{ ...buttonStyle, opacity: isSubmitting ? 0.7 : 1, cursor: isSubmitting ? 'wait' : 'pointer' }}
        >
          {isSubmitting ? 'Starting session…' : 'Start session'}
        </button>
      </form>
    </main>
  );
}
