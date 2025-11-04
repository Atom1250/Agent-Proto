'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import { apiUrl } from '../../../lib/api';

type StructuredOutput = {
  slot_updates?: Array<{ slotKey?: string; slot_key?: string; value?: unknown }>;
  slotUpdates?: Array<{ slotKey?: string; slot_key?: string; value?: unknown }>;
  next_question?: unknown;
  nextQuestion?: unknown;
  missing_required_slots?: unknown;
  missingRequiredSlots?: unknown;
};

type PageProps = {
  params: { sessionId: string };
};

type EphemeralTokenResponse = {
  token?: string;
  expiresAt?: string;
  model?: string;
};

type VoiceTurnPayload = {
  eventId?: string;
  role: 'user' | 'assistant';
  transcript: string;
  audioUrl?: string | null;
  audioId?: string | null;
  structuredOutput?: StructuredOutput | null;
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

function normalizeStructuredOutput(value: unknown): StructuredOutput | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rawSlotUpdates = record.slot_updates ?? record.slotUpdates ?? [];
  const slotUpdates: Array<{ slotKey: string; value: unknown }> = [];

  if (Array.isArray(rawSlotUpdates)) {
    for (const entry of rawSlotUpdates) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const slotRecord = entry as Record<string, unknown>;
      const slotKey =
        typeof slotRecord.slotKey === 'string'
          ? slotRecord.slotKey
          : typeof slotRecord.slot_key === 'string'
            ? slotRecord.slot_key
            : null;
      if (!slotKey) {
        continue;
      }
      const value = Object.prototype.hasOwnProperty.call(slotRecord, 'value') ? slotRecord.value : null;
      slotUpdates.push({ slotKey, value });
    }
  }

  const rawMissing = record.missing_required_slots ?? record.missingRequiredSlots ?? [];
  const missingRequiredSlots = Array.isArray(rawMissing)
    ? rawMissing.filter((slot): slot is string => typeof slot === 'string' && slot.length > 0)
    : [];

  const nextQuestion =
    typeof record.next_question === 'string'
      ? record.next_question
      : typeof record.nextQuestion === 'string'
        ? record.nextQuestion
        : null;

  if (slotUpdates.length === 0 && missingRequiredSlots.length === 0 && !nextQuestion) {
    return null;
  }

  return {
    slot_updates: slotUpdates,
    missing_required_slots: missingRequiredSlots,
    next_question: nextQuestion,
  } satisfies StructuredOutput;
}

function extractContentDetails(content: unknown): {
  transcript: string | null;
  audioUrl: string | null;
  audioId: string | null;
  structuredOutput: StructuredOutput | null;
} {
  const transcriptSegments: string[] = [];
  let audioUrl: string | null = null;
  let audioId: string | null = null;
  let structuredOutput: StructuredOutput | null = null;

  const visit = (value: unknown) => {
    if (value === null || value === undefined) {
      return;
    }
    if (typeof value === 'string') {
      if (value.trim()) {
        transcriptSegments.push(value.trim());
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object') {
      return;
    }

    const record = value as Record<string, unknown>;
    const maybeText = record.text ?? record.message ?? record.value ?? record.output;
    if (typeof maybeText === 'string' && maybeText.trim()) {
      transcriptSegments.push(maybeText.trim());
    }
    if (typeof record.transcript === 'string' && record.transcript.trim()) {
      transcriptSegments.push(record.transcript.trim());
    }
    if (Array.isArray(record.transcripts)) {
      record.transcripts.forEach(visit);
    }

    if (!audioUrl) {
      const candidate =
        typeof record.audio_url === 'string'
          ? record.audio_url
          : typeof record.url === 'string'
            ? record.url
            : typeof record.href === 'string'
              ? record.href
              : null;
      if (candidate && candidate.trim()) {
        audioUrl = candidate.trim();
      }
    }

    const type = typeof record.type === 'string' ? record.type : null;
    if (!audioId && typeof record.id === 'string' && record.id.trim() && type && type.includes('audio')) {
      audioId = record.id.trim();
    }

    if (!structuredOutput && type === 'structured_output') {
      structuredOutput = normalizeStructuredOutput(record.output ?? record.data ?? record.value ?? null);
    }
    if (!structuredOutput && record.structured_output) {
      structuredOutput = normalizeStructuredOutput(record.structured_output);
    }
    if (!structuredOutput && record.output && typeof record.output === 'object') {
      structuredOutput = normalizeStructuredOutput(record.output);
    }

    if (record.content) {
      visit(record.content);
    }
    if (record.parts) {
      visit(record.parts);
    }
    if (record.delta) {
      visit(record.delta);
    }
  };

  visit(content);

  const transcript = transcriptSegments.join('\n').trim();

  return {
    transcript: transcript || null,
    audioUrl,
    audioId,
    structuredOutput,
  };
}

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
  const processedVoiceEventsRef = useRef<Set<string>>(new Set());

  const sendVoiceTurns = useCallback(
    async (turns: VoiceTurnPayload[]) => {
      if (turns.length === 0) {
        return;
      }

      try {
        await fetch(apiUrl(`/v1/sessions/${sessionId}/voice-turns`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(turns),
          keepalive: true,
        });
      } catch (err) {
        console.error('Failed to persist voice turns', err);
      }
    },
    [sessionId],
  );

  const enqueueVoiceTurns = useCallback(
    (turns: VoiceTurnPayload | VoiceTurnPayload[]) => {
      const entries = Array.isArray(turns) ? turns : [turns];
      const unique: VoiceTurnPayload[] = [];

      entries.forEach((entry) => {
        if (!entry || typeof entry.transcript !== 'string') {
          return;
        }

        const transcript = entry.transcript.trim();
        if (!transcript) {
          return;
        }

        const key = entry.eventId && entry.eventId.trim() ? entry.eventId.trim() : `${entry.role}:${transcript}`;
        if (processedVoiceEventsRef.current.has(key)) {
          return;
        }
        processedVoiceEventsRef.current.add(key);

        const normalizedEventId = entry.eventId && typeof entry.eventId === 'string' && entry.eventId.trim()
          ? entry.eventId.trim()
          : undefined;
        const normalizedAudioUrl =
          typeof entry.audioUrl === 'string' && entry.audioUrl.trim() ? entry.audioUrl.trim() : undefined;
        const normalizedAudioId =
          typeof entry.audioId === 'string' && entry.audioId.trim() ? entry.audioId.trim() : undefined;

        unique.push({
          ...entry,
          eventId: normalizedEventId,
          transcript,
          audioUrl: normalizedAudioUrl,
          audioId: normalizedAudioId,
          structuredOutput: entry.structuredOutput ?? undefined,
        });
      });

      if (unique.length > 0) {
        void sendVoiceTurns(unique);
      }
    },
    [sendVoiceTurns],
  );

  const handleRealtimeEvent = useCallback(
    (payload: unknown) => {
      if (!payload || typeof payload !== 'object') {
        return;
      }

      const record = payload as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : null;
      if (!type) {
        return;
      }

      if (type === 'conversation.item.completed') {
        const item = record.item;
        if (!item || typeof item !== 'object') {
          return;
        }
        const itemRecord = item as Record<string, unknown>;
        const roleRaw = typeof itemRecord.role === 'string' ? itemRecord.role : null;
        if (!roleRaw) {
          return;
        }
        const role = roleRaw.toLowerCase() === 'user' ? 'user' : roleRaw.toLowerCase() === 'assistant' ? 'assistant' : null;
        if (!role) {
          return;
        }

        const { transcript, audioUrl, audioId, structuredOutput } = extractContentDetails(itemRecord.content);
        if (!transcript) {
          return;
        }

        const eventId = typeof itemRecord.id === 'string' ? itemRecord.id : undefined;
        enqueueVoiceTurns({
          eventId,
          role,
          transcript,
          audioUrl,
          audioId,
          structuredOutput,
        });
        return;
      }

      if (type === 'response.completed') {
        const response = record.response;
        if (!response || typeof response !== 'object') {
          return;
        }
        const responseRecord = response as Record<string, unknown>;
        const responseId = typeof responseRecord.id === 'string' ? responseRecord.id : undefined;
        const outputs = Array.isArray(responseRecord.output)
          ? responseRecord.output
          : responseRecord.output
            ? [responseRecord.output]
            : [];

        const turns: VoiceTurnPayload[] = [];
        outputs.forEach((item, index) => {
          if (!item || typeof item !== 'object') {
            return;
          }
          const itemRecord = item as Record<string, unknown>;
          const roleRaw = typeof itemRecord.role === 'string' ? itemRecord.role : 'assistant';
          const role = roleRaw.toLowerCase() === 'user' ? 'user' : 'assistant';

          const { transcript, audioUrl, audioId, structuredOutput } = extractContentDetails(
            itemRecord.content ?? itemRecord.delta,
          );
          if (!transcript) {
            return;
          }

          const outputId = typeof itemRecord.id === 'string' ? itemRecord.id : undefined;
          const eventId = responseId ? `${responseId}:${outputId ?? index}` : outputId;

          turns.push({
            eventId,
            role,
            transcript,
            audioUrl,
            audioId,
            structuredOutput,
          });
        });

        if (turns.length > 0) {
          enqueueVoiceTurns(turns);
        }
      }
    },
    [enqueueVoiceTurns],
  );

  const handleDataChannelMessage = useCallback(
    (data: unknown) => {
      if (typeof data !== 'string') {
        return;
      }

      const lines = data
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      lines.forEach((line) => {
        try {
          const parsed = JSON.parse(line);
          handleRealtimeEvent(parsed);
        } catch (error) {
          // Ignore malformed lines
        }
      });
    },
    [handleRealtimeEvent],
  );

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

      const model = typeof payload.model === 'string' && payload.model.trim().length > 0
        ? payload.model.trim()
        : 'gpt-4o-realtime-preview-2024-12-17';
      const realtimeUrl = `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;

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

      const eventChannel = peerConnection.createDataChannel('oai-events');
      eventChannel.addEventListener('message', (event) => {
        handleDataChannelMessage(event.data);
      });

      peerConnection.addEventListener('datachannel', (event) => {
        const channel = event.channel;
        if (channel.label !== 'oai-events') {
          return;
        }
        channel.addEventListener('message', (message) => {
          handleDataChannelMessage(message.data);
        });
      });

      setConnectionStatus('Creating session offer…');

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const sdpResponse = await fetch(realtimeUrl, {
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
  }, [cleanUpConnections, handleDataChannelMessage, isConnecting]);

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
