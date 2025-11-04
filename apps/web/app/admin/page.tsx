'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { apiUrl } from '../../lib/api';

type SessionSummary = {
  id: string;
  clientName: string;
  clientEmail: string | null;
  templateId: string | null;
  templateName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  percentComplete: number;
};

type SessionsResponse = {
  sessions: SessionSummary[];
  filters: {
    templates: { id: string; name: string }[];
    statuses: string[];
  };
};

type SessionDetail = {
  session: {
    id: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    clientName: string;
    clientEmail: string | null;
    templateName: string;
    percentComplete: number;
  };
  messages: { id: string; role: string; content: string; createdAt: string }[];
  responses: {
    id: string;
    slotKey: string;
    slotLabel: string;
    value: string;
    confidence: number | null;
    createdAt: string;
  }[];
  attachments: {
    id: string;
    filename: string | null;
    mimeType: string | null;
    size: number | null;
    checksum: string | null;
    createdAt: string;
    available: boolean;
    downloadUrl: string | null;
  }[];
};

type Filters = {
  templateId: string;
  status: string;
  startedAfter: string;
  startedBefore: string;
  search: string;
};

function formatDate(value: string | null | undefined) {
  if (!value) {
    return '—';
  }
  try {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
      return '—';
    }
    return date.toLocaleString();
  } catch {
    return '—';
  }
}

function formatConfidence(value: number | null) {
  if (value === null || value === undefined) {
    return '—';
  }
  return `${Math.round(value * 100)}%`;
}

function formatFileSize(bytes: number | null) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) {
    return '—';
  }
  if (bytes === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionsPayload, setSessionsPayload] = useState<SessionsResponse | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    templateId: '',
    status: '',
    startedAfter: '',
    startedBefore: '',
    search: '',
  });

  const selectedSession = useMemo(() => {
    if (!selectedSessionId || !sessionsPayload) {
      return null;
    }
    return sessionsPayload.sessions.find((session) => session.id === selectedSessionId) ?? null;
  }, [selectedSessionId, sessionsPayload]);

  const loadSessions = useCallback(
    async (activePassword: string, activeFilters: Filters) => {
      if (!activePassword) {
        return;
      }

      setIsLoading(true);
      setAuthError(null);

      try {
        const params = new URLSearchParams();
        if (activeFilters.templateId) {
          params.set('templateId', activeFilters.templateId);
        }
        if (activeFilters.status) {
          params.set('status', activeFilters.status);
        }
        if (activeFilters.startedAfter) {
          params.set('startedAfter', activeFilters.startedAfter);
        }
        if (activeFilters.startedBefore) {
          params.set('startedBefore', activeFilters.startedBefore);
        }
        if (activeFilters.search.trim()) {
          params.set('search', activeFilters.search.trim());
        }

        const url = apiUrl(`/v1/admin/sessions${params.toString() ? `?${params.toString()}` : ''}`);
        const response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            'x-admin-secret': activePassword,
          },
        });

        if (response.status === 401) {
          setAuthError('Incorrect admin password.');
          setIsUnlocked(false);
          setSessionsPayload(null);
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed to load sessions (${response.status})`);
        }

        const payload = (await response.json()) as SessionsResponse;
        setSessionsPayload(payload);
        setIsUnlocked(true);
        setAuthError(null);
      } catch (error) {
        console.error(error);
        setAuthError(error instanceof Error ? error.message : 'Unable to load sessions.');
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const unlockAdmin = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!password) {
        setAuthError('Enter the admin password.');
        return;
      }

      setSelectedSessionId(null);
      setSessionDetail(null);
      await loadSessions(password, filters);
    },
    [filters, loadSessions, password],
  );

  useEffect(() => {
    if (!isUnlocked || !password) {
      return;
    }
    void loadSessions(password, filters);
  }, [filters, isUnlocked, loadSessions, password]);

  const loadDetail = useCallback(
    async (sessionId: string, activePassword: string) => {
      setDetailError(null);
      setSessionDetail(null);
      try {
        const response = await fetch(apiUrl(`/v1/admin/sessions/${sessionId}/responses`), {
          headers: { 'x-admin-secret': activePassword },
        });

        if (response.status === 401) {
          setAuthError('Session expired, please re-enter the admin password.');
          setIsUnlocked(false);
          setSessionsPayload(null);
          return;
        }

        if (!response.ok) {
          throw new Error(`Unable to load session (${response.status})`);
        }

        const payload = (await response.json()) as SessionDetail;
        setSessionDetail(payload);
      } catch (error) {
        console.error(error);
        setDetailError(error instanceof Error ? error.message : 'Unable to load session detail.');
      }
    },
    [],
  );

  useEffect(() => {
    if (!selectedSessionId || !password || !isUnlocked) {
      return;
    }
    void loadDetail(selectedSessionId, password);
  }, [isUnlocked, loadDetail, password, selectedSessionId]);

  const onFilterChange = useCallback(
    (field: keyof Filters) =>
      (event: ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
        const value = event.target.value;
        setFilters((prev) => ({ ...prev, [field]: value }));
      },
    [],
  );

  const exportResponses = useCallback(
    async (format: 'json' | 'csv') => {
      if (!selectedSessionId || !password) {
        return;
      }

      try {
        const params = new URLSearchParams({ sessionId: selectedSessionId, format });
        const response = await fetch(apiUrl(`/v1/admin/export?${params.toString()}`), {
          headers: { 'x-admin-secret': password },
        });

        if (response.status === 401) {
          setAuthError('Session expired, please re-enter the admin password.');
          setIsUnlocked(false);
          setSessionsPayload(null);
        return;
      }

      if (!response.ok) {
        throw new Error(`Export failed (${response.status})`);
      }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `session-${selectedSessionId}-responses.${format}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (error) {
        console.error(error);
        setDetailError(error instanceof Error ? error.message : 'Unable to export responses.');
      }
    },
    [password, selectedSessionId],
  );

  const downloadAttachment = useCallback(
    async (attachment: { id: string; filename: string | null; downloadUrl: string | null }) => {
      if (!password || !attachment.downloadUrl) {
        return;
      }

      try {
        setDetailError(null);
        const response = await fetch(apiUrl(attachment.downloadUrl), {
          headers: { 'x-admin-secret': password },
        });

        if (response.status === 401) {
          setAuthError('Session expired, please re-enter the admin password.');
          setIsUnlocked(false);
          setSessionsPayload(null);
          return;
        }

        if (!response.ok) {
          throw new Error(`Attachment download failed (${response.status})`);
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.filename ? attachment.filename : `attachment-${attachment.id}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (error) {
        console.error(error);
        setDetailError(error instanceof Error ? error.message : 'Unable to download attachment.');
      }
    },
    [password, setAuthError, setDetailError, setIsUnlocked, setSessionsPayload],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        padding: '32px 40px',
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont',
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>Admin Console</h1>
        <p style={{ color: '#4b5563', margin: 0 }}>Inspect sessions, review transcripts, and export normalized responses.</p>
      </header>

      <section
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 16,
          border: '1px solid #e5e7eb',
          padding: 24,
          maxWidth: 480,
          boxShadow: '0 20px 50px rgba(15, 23, 42, 0.08)',
        }}
      >
        <form onSubmit={unlockAdmin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontWeight: 600 }}>Admin password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
              style={{
                borderRadius: 10,
                border: '1px solid #d1d5db',
                padding: '10px 12px',
                fontSize: 16,
              }}
            />
          </label>
          <button
            type="submit"
            style={{
              borderRadius: 10,
              backgroundColor: '#1d4ed8',
              color: '#ffffff',
              border: 'none',
              padding: '10px 16px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {isUnlocked ? 'Refresh sessions' : 'Unlock console'}
          </button>
          {authError ? <p style={{ color: '#dc2626', margin: 0 }}>{authError}</p> : null}
        </form>
      </section>

      {isUnlocked ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <a
            href="/admin/diagnostics"
            style={{
              fontSize: 14,
              color: '#1d4ed8',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            View diagnostics →
          </a>
        </div>
      ) : null}

      {isUnlocked && sessionsPayload ? (
        <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)' }}>
          <section
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              border: '1px solid #e5e7eb',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              height: 'fit-content',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Sessions</h2>
              {isLoading ? <span style={{ fontSize: 12, color: '#6b7280' }}>Loading…</span> : null}
            </div>

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, color: '#4b5563' }}>Template</span>
                <select
                  value={filters.templateId}
                  onChange={onFilterChange('templateId')}
                  style={{ borderRadius: 8, border: '1px solid #d1d5db', padding: '8px 10px' }}
                >
                  <option value="">All templates</option>
                  {sessionsPayload.filters.templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, color: '#4b5563' }}>Status</span>
                <select
                  value={filters.status}
                  onChange={onFilterChange('status')}
                  style={{ borderRadius: 8, border: '1px solid #d1d5db', padding: '8px 10px' }}
                >
                  <option value="">All statuses</option>
                  {sessionsPayload.filters.statuses.map((statusOption) => (
                    <option key={statusOption} value={statusOption}>
                      {statusOption}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, color: '#4b5563' }}>Started after</span>
                <input
                  type="date"
                  value={filters.startedAfter}
                  onChange={onFilterChange('startedAfter')}
                  style={{ borderRadius: 8, border: '1px solid #d1d5db', padding: '8px 10px' }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, color: '#4b5563' }}>Started before</span>
                <input
                  type="date"
                  value={filters.startedBefore}
                  onChange={onFilterChange('startedBefore')}
                  style={{ borderRadius: 8, border: '1px solid #d1d5db', padding: '8px 10px' }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, color: '#4b5563' }}>Search transcript</span>
                <input
                  type="search"
                  placeholder="Find message text"
                  value={filters.search}
                  onChange={onFilterChange('search')}
                  style={{ borderRadius: 8, border: '1px solid #d1d5db', padding: '8px 10px' }}
                />
              </label>
            </div>

            <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f3f4f6', textAlign: 'left', fontSize: 13 }}>
                    <th style={{ padding: '10px 12px' }}>Client</th>
                    <th style={{ padding: '10px 12px' }}>Template</th>
                    <th style={{ padding: '10px 12px' }}>Started</th>
                    <th style={{ padding: '10px 12px' }}>Last activity</th>
                    <th style={{ padding: '10px 12px' }}>% complete</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionsPayload.sessions.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '16px', textAlign: 'center', color: '#6b7280' }}>
                        No sessions found for the selected filters.
                      </td>
                    </tr>
                  ) : (
                    sessionsPayload.sessions.map((session) => {
                      const isActive = session.id === selectedSessionId;
                      return (
                        <tr
                          key={session.id}
                          onClick={() => {
                            setDetailError(null);
                            setSelectedSessionId(session.id);
                          }}
                          style={{
                            cursor: 'pointer',
                            backgroundColor: isActive ? '#eff6ff' : 'transparent',
                            borderBottom: '1px solid #e5e7eb',
                          }}
                        >
                          <td style={{ padding: '10px 12px', fontWeight: 500 }}>{session.clientName}</td>
                          <td style={{ padding: '10px 12px', color: '#4b5563' }}>{session.templateName || '—'}</td>
                          <td style={{ padding: '10px 12px', color: '#4b5563' }}>{formatDate(session.createdAt)}</td>
                          <td style={{ padding: '10px 12px', color: '#4b5563' }}>{formatDate(session.updatedAt)}</td>
                          <td style={{ padding: '10px 12px', color: '#1d4ed8', fontWeight: 600 }}>{session.percentComplete}%</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              border: '1px solid #e5e7eb',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              minHeight: 360,
            }}
          >
            {selectedSession && sessionDetail ? (
              <>
                <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{selectedSession.clientName}</h2>
                    <span style={{ color: '#4b5563', fontSize: 14 }}>
                      {selectedSession.templateName || 'No template'} • {selectedSession.status}
                    </span>
                    <span style={{ color: '#2563eb', fontSize: 13, fontWeight: 600 }}>
                      {sessionDetail.session.percentComplete}% complete
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => exportResponses('json')}
                      style={{
                        borderRadius: 8,
                        border: '1px solid #1d4ed8',
                        backgroundColor: '#1d4ed8',
                        color: '#ffffff',
                        padding: '8px 14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Export JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => exportResponses('csv')}
                      style={{
                        borderRadius: 8,
                        border: '1px solid #0f172a',
                        backgroundColor: '#ffffff',
                        color: '#0f172a',
                        padding: '8px 14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
                      }}
                    >
                      Export CSV
                    </button>
                  </div>
                </header>

                <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Transcript</h3>
                    <div
                      style={{
                        border: '1px solid #e5e7eb',
                        borderRadius: 12,
                        padding: 12,
                        maxHeight: 320,
                        overflowY: 'auto',
                        backgroundColor: '#f9fafb',
                      }}
                    >
                      {sessionDetail.messages.length === 0 ? (
                        <p style={{ color: '#6b7280', fontSize: 14 }}>No messages captured yet.</p>
                      ) : (
                        sessionDetail.messages.map((message) => (
                          <div key={message.id} style={{ marginBottom: 12 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: '#1f2937' }}>
                              {message.role} • {formatDate(message.createdAt)}
                            </div>
                            <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', color: '#111827' }}>{message.content}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Form view</h3>
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#f3f4f6', textAlign: 'left', fontSize: 13 }}>
                            <th style={{ padding: '8px 10px' }}>Slot</th>
                            <th style={{ padding: '8px 10px' }}>Value</th>
                            <th style={{ padding: '8px 10px' }}>Confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sessionDetail.responses.length === 0 ? (
                            <tr>
                              <td colSpan={3} style={{ padding: '14px', textAlign: 'center', color: '#6b7280' }}>
                                No slot responses captured yet.
                              </td>
                            </tr>
                          ) : (
                            sessionDetail.responses.map((response) => (
                              <tr key={response.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                                <td style={{ padding: '8px 10px', fontWeight: 500 }}>{response.slotLabel}</td>
                                <td style={{ padding: '8px 10px', fontSize: 14, color: '#111827' }}>{response.value || '—'}</td>
                                <td style={{ padding: '8px 10px', color: '#1d4ed8', fontWeight: 600 }}>
                                  {formatConfidence(response.confidence)}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Attachments</h3>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f3f4f6', textAlign: 'left', fontSize: 13 }}>
                          <th style={{ padding: '8px 10px' }}>File name</th>
                          <th style={{ padding: '8px 10px' }}>Type</th>
                          <th style={{ padding: '8px 10px' }}>Size</th>
                          <th style={{ padding: '8px 10px' }}>Checksum</th>
                          <th style={{ padding: '8px 10px' }}>Added</th>
                          <th style={{ padding: '8px 10px' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sessionDetail.attachments.length === 0 ? (
                          <tr>
                            <td colSpan={6} style={{ padding: '14px', textAlign: 'center', color: '#6b7280' }}>
                              No attachments captured.
                            </td>
                          </tr>
                        ) : (
                          sessionDetail.attachments.map((attachment) => (
                            <tr key={attachment.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                                <td style={{ padding: '8px 10px', fontWeight: 500 }}>
                                  {attachment.filename || 'Attachment'}
                                </td>
                                <td style={{ padding: '8px 10px', fontSize: 13, color: '#4b5563' }}>
                                  {attachment.mimeType || '—'}
                                </td>
                                <td style={{ padding: '8px 10px', fontSize: 13, color: '#4b5563' }}>
                                  {formatFileSize(attachment.size)}
                                </td>
                                <td style={{ padding: '8px 10px', fontSize: 12, color: '#111827', wordBreak: 'break-all' }}>
                                  {attachment.checksum || '—'}
                                </td>
                                <td style={{ padding: '8px 10px', fontSize: 13, color: '#4b5563' }}>
                                  {formatDate(attachment.createdAt)}
                                </td>
                                <td style={{ padding: '8px 10px', fontSize: 13 }}>
                                  {attachment.available && attachment.downloadUrl ? (
                                    <button
                                      type="button"
                                      onClick={() => downloadAttachment(attachment)}
                                      style={{
                                        border: 'none',
                                        background: 'none',
                                        color: '#1d4ed8',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        padding: 0,
                                      }}
                                    >
                                      Download
                                    </button>
                                  ) : (
                                    <span style={{ color: '#9ca3af' }}>Processing</span>
                                  )}
                                </td>
                              </tr>
                            ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {detailError ? <p style={{ color: '#dc2626' }}>{detailError}</p> : null}
              </>
            ) : selectedSessionId ? (
              <p style={{ color: '#6b7280' }}>Loading session details…</p>
            ) : (
              <p style={{ color: '#6b7280' }}>Select a session to review its transcript and responses.</p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

