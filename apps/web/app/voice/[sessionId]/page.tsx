'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import { apiUrl } from '../../../lib/api';

type PageProps = {
  params: { sessionId: string };
};

type EphemeralTokenResponse = {
  token?: string;
  expiresAt?: string;
};

const pageStyle: CSSProperties = {
  margin: '0 auto',
  minHeight: '100vh',
  maxWidth: 960,
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont',
};

const cardStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 24,
  backgroundColor: '#ffffff',
  boxShadow: '0 10px 30px rgba(15, 23, 42, 0.05)',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const statusStyle: CSSProperties = {
  fontSize: 14,
  color: '#374151',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
};

const errorStyle: CSSProperties = {
  fontSize: 14,
  color: '#dc2626',
};

const buttonStyle: CSSProperties = {
  borderRadius: 8,
  padding: '10px 16px',
  fontSize: 14,
  fontWeight: 600,
  border: 'none',
  display: 'inline-flex',
  alignSelf: 'flex-start',
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  backgroundColor: '#2563eb',
  color: '#ffffff',
};

const secondaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  backgroundColor: '#e5e7eb',
  color: '#111827',
};

const audioContainerStyle: CSSProperties = {
  border: '1px dashed #cbd5f5',
  borderRadius: 12,
  padding: 16,
  backgroundColor: '#f9fafb',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const AUDIO_MODEL = 'gpt-4o-realtime-preview';
const REALTIME_URL = `https://api.openai.com/v1/realtime?model=${AUDIO_MODEL}`;

export default function VoiceSessionPage({ params }: PageProps) {
  const { sessionId } = params;
  const [connectionStatus, setConnectionStatus] = useState('Initializing…');
  const [error, setError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const formattedExpiry = useMemo(() => {
    if (!expiresAt) {
      return null;
    }
    try {
      const expiryDate = new Date(expiresAt);
      if (Number.isNaN(expiryDate.getTime())) {
        return null;
      }
      return expiryDate.toLocaleTimeString();
    } catch (err) {
      return null;
    }
  }, [expiresAt]);

  const cleanUpConnections = useCallback(() => {
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (err) {
        // Ignore errors while stopping tracks.
      }
    });
    localStreamRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
  }, []);

  const connectToRealtime = useCallback(async () => {
    if (isConnecting) {
      return;
    }

    setIsConnecting(true);
    setError(null);
    setExpiresAt(null);

    cleanUpConnections();

    setConnectionStatus('Requesting microphone access…');

    let localStream: MediaStream | null = null;
    let peerConnection: RTCPeerConnection | null = null;

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!localStream) {
        throw new Error('Microphone access was denied');
      }
      localStreamRef.current = localStream;
      setConnectionStatus('Fetching temporary access token…');

      const response = await fetch(apiUrl('/v1/realtime/ephemeral'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const payload = (await response.json().catch(() => ({}))) as EphemeralTokenResponse;
      if (!response.ok) {
        throw new Error(payload?.token ? 'Failed to initialize voice session' : 'Unable to fetch realtime token');
      }

      if (!payload?.token) {
        throw new Error('Realtime token missing in response');
      }

      setExpiresAt(payload.expiresAt ?? null);

      setConnectionStatus('Creating peer connection…');

      peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;

      const remoteStream = new MediaStream();

      peerConnection.addEventListener('track', (event) => {
        const [stream] = event.streams;
        const targetStream = stream ?? remoteStream;
        if (stream) {
          stream.getAudioTracks().forEach((track) => remoteStream.addTrack(track));
        } else {
          remoteStream.addTrack(event.track);
        }
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = targetStream;
          remoteAudioRef.current
            .play()
            .catch(() => {
              // Autoplay might fail if browser requires gesture; user can tap play.
            });
        }
      });

      peerConnection.addEventListener('connectionstatechange', () => {
        if (!peerConnection) {
          return;
        }
        if (peerConnection.connectionState === 'connected') {
          setConnectionStatus('Connected — speak normally and listen for responses.');
        } else if (peerConnection.connectionState === 'failed') {
          setConnectionStatus('Connection failed. You can retry.');
          setError('Peer connection failed.');
        }
      });

      localStream.getTracks().forEach((track) => {
        peerConnection?.addTrack(track, localStream as MediaStream);
      });

      peerConnection.createDataChannel('oai-events');

      setConnectionStatus('Creating session offer…');

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const sdpResponse = await fetch(REALTIME_URL, {
        method: 'POST',
        body: offer.sdp ?? '',
        headers: {
          Authorization: `Bearer ${payload.token}`,
          'Content-Type': 'application/sdp',
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      if (!sdpResponse.ok) {
        const text = await sdpResponse.text().catch(() => '');
        throw new Error(text || 'Failed to negotiate realtime session');
      }

      const answer = await sdpResponse.text();
      await peerConnection.setRemoteDescription({ type: 'answer', sdp: answer });

      setConnectionStatus('Voice link ready. Start speaking to chat with the agent.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error while connecting to realtime API';
      setError(message);
      setConnectionStatus('Unable to establish voice connection.');
      cleanUpConnections();
    } finally {
      setIsConnecting(false);
    }
  }, [cleanUpConnections, isConnecting]);

  useEffect(() => {
    connectToRealtime();

    return () => {
      cleanUpConnections();
    };
  }, [connectToRealtime, cleanUpConnections, attempt]);

  const handleRetry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return (
    <main style={pageStyle}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600 }}>Voice session</h1>
        <p style={{ fontSize: 14, color: '#4b5563', lineHeight: 1.6 }}>
          Speak naturally to chat with the agent. Your microphone audio is streamed securely to the realtime
          model, and the agent response will play back here.
        </p>
        <Link href={`/sessions/${encodeURIComponent(sessionId)}`} style={{ fontSize: 13, color: '#2563eb' }}>
          ← Switch to text chat
        </Link>
      </header>

      <section style={cardStyle}>
        <div style={audioContainerStyle}>
          <strong style={{ fontSize: 15, color: '#111827' }}>Live audio</strong>
          <audio ref={remoteAudioRef} playsInline controls autoPlay style={{ width: '100%' }} />
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            If playback is paused, tap play after granting microphone access.
          </span>
        </div>

        <p style={statusStyle}>{connectionStatus}</p>
        {formattedExpiry ? (
          <p style={{ fontSize: 13, color: '#6b7280' }}>Token expires at: {formattedExpiry}</p>
        ) : null}
        {error ? <p style={errorStyle}>{error}</p> : null}

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            type="button"
            onClick={connectToRealtime}
            disabled={isConnecting}
            style={{
              ...primaryButtonStyle,
              opacity: isConnecting ? 0.7 : 1,
              cursor: isConnecting ? 'wait' : 'pointer',
            }}
          >
            {isConnecting ? 'Connecting…' : 'Reconnect'}
          </button>
          <button
            type="button"
            onClick={handleRetry}
            disabled={isConnecting}
            style={{
              ...secondaryButtonStyle,
              opacity: isConnecting ? 0.7 : 1,
              cursor: isConnecting ? 'wait' : 'pointer',
            }}
          >
            Reset connection
          </button>
        </div>
      </section>
    </main>
  );
}
