import { useState, useCallback, useEffect, useRef } from 'react';
import './DemoWidget.css';

export type DemoStatus =
  | 'idle'
  | 'requesting'
  | 'uploading'
  | 'creating-job'
  | 'polling'
  | 'succeeded'
  | 'failed'
  | 'error';

export interface JobResponse {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  inputKey: string;
  outputKeys: string[] | null;
  downloadUrl: string | null;
  error: string | null;
  updatedAt: string;
}

function fixLocalUrl(url: string): string {
  return url.replace('http://localstack:4566', 'http://localhost:4566');
}

function getActiveStep(status: DemoStatus): number {
  switch (status) {
    case 'idle': return 1;
    case 'requesting': return 2;
    case 'uploading': return 2;
    case 'creating-job': return 3;
    case 'polling': return 3;
    case 'succeeded': return 3;
    case 'failed': return 0;
    case 'error': return 0;
  }
}

function isStepCompleted(step: number, status: DemoStatus): boolean {
  const active = getActiveStep(status);
  if (status === 'error' || status === 'failed') return false;
  if (status === 'succeeded') return step <= 3;
  return step < active;
}

const ACCEPTED_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const POLL_INTERVAL_MS = 2000;

function validateFile(f: File): string | null {
  if (!ACCEPTED_TYPES.has(f.type)) {
    return 'Unsupported file type. Please use MP4, MOV, or WebM.';
  }
  if (f.size > MAX_FILE_SIZE) {
    return `File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max is 20 MB.`;
  }
  return null;
}

interface DemoWidgetProps {
  status: DemoStatus;
  setStatus: React.Dispatch<React.SetStateAction<DemoStatus>>;
  jobResponse: JobResponse | null;
  setJobResponse: React.Dispatch<React.SetStateAction<JobResponse | null>>;
}

export default function DemoWidget({ status, setStatus, jobResponse, setJobResponse }: DemoWidgetProps) {
  const [submitterName, setSubmitterName] = useState('');
  const [resolution, setResolution] = useState('720p');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [dragging, setDragging] = useState(false);
  const pollRef = useRef<number | null>(null);

  const isBusy = status === 'requesting' || status === 'uploading' || status === 'creating-job';
  const isPolling = status === 'polling';
  const isTerminal = status === 'succeeded' || status === 'failed';

  // Cleanup polling on unmount or terminal state
  useEffect(() => {
    return () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback((jobId: string) => {
    stopPolling();
    setStatus('polling');
    setMessage('Waiting for worker to pick up job…');

    const intervalId = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) {
          throw new Error(`Failed to poll job status (${res.status})`);
        }
        const data: JobResponse = await res.json();
        setJobResponse(data);

        if (data.status === 'PROCESSING') {
          setMessage('Transcoding in progress…');
        } else if (data.status === 'SUCCEEDED') {
          stopPolling();
          setStatus('succeeded');
          setMessage('Transcode complete!');
        } else if (data.status === 'FAILED') {
          stopPolling();
          setStatus('failed');
          setMessage(data.error ?? 'Transcode failed.');
        }
      } catch (err: unknown) {
        stopPolling();
        setStatus('error');
        if (err instanceof Error) {
          setMessage(err.message);
        } else {
          setMessage('An unexpected error occurred while polling.');
        }
      }
    }, POLL_INTERVAL_MS);

    pollRef.current = intervalId;
  }, [stopPolling]);

  const resetAll = useCallback(() => {
    stopPolling();
    setSubmitterName('');
    setResolution('720p');
    setFile(null);
    setStatus('idle');
    setMessage('');
    setJobResponse(null);
  }, [stopPolling, setStatus, setJobResponse]);

  const selectFile = useCallback((f: File) => {
    const error = validateFile(f);
    if (error) {
      setStatus('error');
      setMessage(error);
      return;
    }
    setFile(f);
    setStatus('idle');
    setMessage('');
    setJobResponse(null);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      selectFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isBusy) setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (isBusy) return;
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      selectFile(droppedFile);
    }
  };

  const handleUpload = async () => {
    if (!file || !submitterName.trim()) return;

    try {
      // Step 1: Get presigned URL
      setStatus('requesting');
      setMessage('Requesting presigned upload URL…');

      const uploadRes = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mimeType: file.type, sizeBytes: file.size }),
      });

      if (!uploadRes.ok) {
        const errorData: { message?: string } = await uploadRes.json();
        throw new Error(errorData.message ?? `Upload request failed (${uploadRes.status})`);
      }

      const { url, inputKey }: { url: string; inputKey: string } = await uploadRes.json();

      // Step 2: Upload to S3 via presigned URL
      setStatus('uploading');
      setMessage('Uploading to S3…');

      const uploadUrl = fixLocalUrl(url);

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!putRes.ok) {
        throw new Error(`S3 upload failed (${putRes.status})`);
      }

      // Step 3: Create job
      setStatus('creating-job');
      setMessage('Creating transcode job…');

      const jobRes = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputKey, submitterName: submitterName.trim(), resolution }),
      });

      if (!jobRes.ok) {
        const errorData: { message?: string } = await jobRes.json();
        throw new Error(errorData.message ?? `Job creation failed (${jobRes.status})`);
      }

      const job: { id: string; status: string } = await jobRes.json();

      setJobResponse({
        id: job.id,
        status: job.status as JobResponse['status'],
        inputKey,
        outputKeys: null,
        downloadUrl: null,
        error: null,
        updatedAt: new Date().toISOString(),
      });

      // Start polling for status updates
      startPolling(job.id);
    } catch (err: unknown) {
      setStatus('error');
      if (err instanceof Error) {
        setMessage(err.message);
      } else {
        setMessage('An unexpected error occurred.');
      }
    }
  };

  const steps = [
    { num: 1, label: 'Name' },
    { num: 2, label: 'Upload' },
    { num: 3, label: 'Transcode' },
  ];

  const showUploadForm = !isPolling && !isTerminal;

  const statusVariant: 'info' | 'success' | 'error' =
    status === 'error' || status === 'failed'
      ? 'error'
      : status === 'succeeded'
        ? 'success'
        : 'info';

  return (
    <section className="demo section" id="demo">
      <p className="section-label">Live Demo</p>
      <h2 className="section-title">Try It Out</h2>

      <div className="demo-card">
        {/* Step indicators */}
        <div className="demo-steps">
          {steps.map((s) => {
            const completed = isStepCompleted(s.num, status);
            const active = getActiveStep(status) === s.num && !completed;
            const pulsing = active && isPolling;
            const className = [
              'demo-step',
              active ? 'active' : '',
              completed ? 'completed' : '',
              pulsing ? 'pulsing' : '',
            ].filter(Boolean).join(' ');

            return (
              <div key={s.num} className={className}>
                <span className="demo-step-number">
                  {completed ? '✓' : s.num}
                </span>
                {s.label}
              </div>
            );
          })}
        </div>

        {/* Upload form — hidden during polling/terminal states */}
        {showUploadForm && (
          <>
            {/* Name input */}
            <div className="demo-field-group">
              <label className="demo-label" htmlFor="submitter-name">
                Your Name
              </label>
              <input
                id="submitter-name"
                className="demo-input"
                type="text"
                placeholder="e.g. Jane Doe"
                value={submitterName}
                onChange={(e) => setSubmitterName(e.target.value)}
                disabled={isBusy}
                maxLength={100}
              />
            </div>

            {/* Resolution selector */}
            <div className="demo-field-group">
              <label className="demo-label" htmlFor="resolution">
                Output Resolution
              </label>
              <select
                id="resolution"
                className="demo-select"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                disabled={isBusy}
              >
                <option value="240p">240p</option>
                <option value="360p">360p</option>
                <option value="480p">480p</option>
                <option value="720p">720p (default)</option>
                <option value="1080p">1080p</option>
              </select>
            </div>

            {/* File picker */}
            <div
              className={[
                'demo-file-zone',
                isBusy ? 'disabled' : '',
                file ? 'has-file' : '',
                dragging ? 'dragging' : '',
              ].filter(Boolean).join(' ')}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                className="demo-file-input"
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                onChange={handleFileChange}
                disabled={isBusy}
              />
              {file ? (
                <>
                  <span className="demo-file-icon">🎬</span>
                  <span className="demo-file-name">{file.name}</span>
                </>
              ) : (
                <>
                  <span className="demo-file-icon">📁</span>
                  <span className="demo-file-text">
                    Drop a video or click to browse
                  </span>
                  <span className="demo-file-text" style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-xs)' }}>
                    MP4, MOV, or WebM · max 20 MB
                  </span>
                </>
              )}
            </div>

            {/* Upload button */}
            <button
              className="demo-upload-btn"
              onClick={handleUpload}
              disabled={!file || !submitterName.trim() || isBusy}
            >
              {isBusy ? 'Processing…' : 'Upload & Transcode'}
            </button>
          </>
        )}

        {/* Polling / result view */}
        {isPolling && (
          <div className="demo-result">
            <div className="demo-status info">
              <div className="demo-spinner" />
              <div className="demo-status-text">
                {message}
                {jobResponse && (
                  <>
                    <br />
                    Job ID: <code>{jobResponse.id}</code> · Status: <code>{jobResponse.status}</code>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Succeeded — video player */}
        {status === 'succeeded' && jobResponse?.downloadUrl && (
          <div className="demo-result">
            <div className="demo-status success">
              <span className="demo-status-icon">✓</span>
              <div className="demo-status-text">{message}</div>
            </div>
            <div className="demo-video-wrapper">
              <video
                className="demo-video"
                src={fixLocalUrl(jobResponse.downloadUrl)}
                controls
                autoPlay
                muted
                playsInline
              />
            </div>
            <div className="demo-actions">
              <a
                className="demo-download-btn"
                href={fixLocalUrl(jobResponse.downloadUrl)}
                target="_blank"
                rel="noopener noreferrer"
              >
                ↓ Download {resolution}
              </a>
              <button className="demo-reset-btn" onClick={resetAll}>
                Start Over
              </button>
            </div>
          </div>
        )}

        {/* Succeeded but no download URL (edge case) */}
        {status === 'succeeded' && (!jobResponse || !jobResponse.downloadUrl) && (
          <div className="demo-result">
            <div className="demo-status success">
              <span className="demo-status-icon">✓</span>
              <div className="demo-status-text">
                Transcode complete, but no download URL available.
              </div>
            </div>
            <div className="demo-actions">
              <button className="demo-reset-btn" onClick={resetAll}>
                Start Over
              </button>
            </div>
          </div>
        )}

        {/* Failed */}
        {status === 'failed' && (
          <div className="demo-result">
            <div className="demo-status error">
              <span className="demo-status-icon">✕</span>
              <div className="demo-status-text">
                {message}
                {jobResponse && (
                  <>
                    <br />
                    Job ID: <code>{jobResponse.id}</code>
                  </>
                )}
              </div>
            </div>
            <div className="demo-actions">
              <button className="demo-reset-btn" onClick={resetAll}>
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Pre-poll status messages (requesting, uploading, creating-job) */}
        {showUploadForm && message && (
          <div className={`demo-status ${statusVariant}`}>
            {isBusy && <div className="demo-spinner" />}
            {status === 'error' && <span className="demo-status-icon">✕</span>}
            <div className="demo-status-text">{message}</div>
          </div>
        )}
      </div>
    </section>
  );
}
