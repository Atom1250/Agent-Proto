export default function Page() {
  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>Agent Proto</h1>
      <p>Monorepo is up. API health is at <code>/health</code> on port 3001.</p>
      <div style={{ marginTop: 24 }}>
        <a
          href="/sessions/start"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderRadius: 8,
            backgroundColor: '#2563eb',
            color: '#ffffff',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Start a session
        </a>
      </div>
    </main>
  );
}

