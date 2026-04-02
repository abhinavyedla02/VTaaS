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

/**
 * Rewrite presigned S3 URLs for browser access.
 * In local dev, presigned URLs contain the Docker-internal hostname (e.g. http://localstack:4566).
 * VITE_S3_ENDPOINT maps this to a browser-reachable endpoint (e.g. http://localhost:4566).
 * In production (real AWS), presigned URLs are already browser-reachable — no rewrite needed.
 */
const S3_ENDPOINT = import.meta.env.VITE_S3_ENDPOINT as string | undefined;

function fixLocalUrl(url: string): string {
  if (!S3_ENDPOINT) return url;
  // Replace any http(s)://host:port before the first /bucket path segment
  return url.replace(/^https?:\/\/[^/]+/, S3_ENDPOINT);
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
const SAMPLE_VIDEO_URL =
  import.meta.env.VITE_SAMPLE_VIDEO_URL ||
  'https://vtaas-samples-339713128261.s3.us-east-1.amazonaws.com/sample-video.mp4';

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
  setDiagramStage: React.Dispatch<React.SetStateAction<number>>;
  diagramStage: number;
}

export default function DemoWidget({ status, setStatus, jobResponse, setJobResponse, setDiagramStage, diagramStage }: DemoWidgetProps) {
  const [submitterName, setSubmitterName] = useState('');
  const [resolution, setResolution] = useState('720p');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [dragging, setDragging] = useState(false);
  const [fetchingSample, setFetchingSample] = useState(false);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const originalUrlRef = useRef<string | null>(null);

  const isBusy = status === 'requesting' || status === 'uploading' || status === 'creating-job';
  const isPolling = status === 'polling';
  const isTerminal = status === 'succeeded' || status === 'failed';
  const diagramComplete = diagramStage >= 6;

  // Cleanup polling and blob URL on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (originalUrlRef.current) {
        URL.revokeObjectURL(originalUrlRef.current);
        originalUrlRef.current = null;
      }
    };
  }, []);

  // Scroll to diagram when polling starts — prompt user to click Next
  useEffect(() => {
    if (isPolling) {
      setTimeout(() => {
        document.getElementById('diagram')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 400);
    }
  }, [isPolling]);

  // Scroll back to demo panels when diagram walk-through completes
  useEffect(() => {
    if (diagramComplete && status === 'succeeded') {
      setTimeout(() => {
        document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
    }
  }, [diagramComplete, status]);

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
  }, [stopPolling, setStatus, setJobResponse]);

  const resetAll = useCallback(() => {
    stopPolling();
    if (originalUrlRef.current) {
      URL.revokeObjectURL(originalUrlRef.current);
      originalUrlRef.current = null;
    }
    setOriginalUrl(null);
    setSubmitterName('');
    setResolution('720p');
    setFile(null);
    setStatus('idle');
    setMessage('');
    setJobResponse(null);
    setDiagramStage(0);
    setFetchingSample(false);
  }, [stopPolling, setStatus, setJobResponse, setDiagramStage]);

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
  }, [setStatus, setJobResponse]);

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

  /** Shared upload pipeline — takes a File and runs presign → upload → create job → poll */
  const runUploadPipeline = async (uploadFile: File, name: string, res: string) => {
    // Create blob URL for original video preview — persists through polling and result
    if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
    const blobUrl = URL.createObjectURL(uploadFile);
    originalUrlRef.current = blobUrl;
    setOriginalUrl(blobUrl);

    // Auto-set diagram to stage 1 when pipeline starts
    setDiagramStage(1);

    // Step 1: Get presigned URL
    setStatus('requesting');
    setMessage('Requesting presigned upload URL…');

    const uploadRes = await fetch('/api/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType: uploadFile.type, sizeBytes: uploadFile.size }),
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
      headers: { 'Content-Type': uploadFile.type },
      body: uploadFile,
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
      body: JSON.stringify({ inputKey, submitterName: name, resolution: res }),
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
  };

  const handleUpload = async () => {
    if (!file || !submitterName.trim()) return;

    try {
      await runUploadPipeline(file, submitterName.trim(), resolution);
    } catch (err: unknown) {
      setStatus('error');
      if (err instanceof Error) {
        setMessage(err.message);
      } else {
        setMessage('An unexpected error occurred.');
      }
    }
  };

  const handleSampleUpload = async () => {
    try {
      setFetchingSample(true);

      // Pre-fill name if empty
      const name = submitterName.trim() || 'Demo User';
      if (!submitterName.trim()) {
        setSubmitterName('Demo User');
      }

      // Set resolution to 360p for fastest transcode
      const res = '360p';
      setResolution(res);

      // Fetch sample video from S3
      setMessage('Fetching sample video…');
      const fetchRes = await fetch(SAMPLE_VIDEO_URL);
      if (!fetchRes.ok) {
        throw new Error(`Failed to fetch sample video (${fetchRes.status})`);
      }
      const blob = await fetchRes.blob();
      const sampleFile = new File([blob], 'sample.mp4', { type: 'video/mp4' });

      setFile(sampleFile);
      setFetchingSample(false);

      // Run through the normal upload pipeline
      await runUploadPipeline(sampleFile, name, res);
    } catch (err: unknown) {
      setFetchingSample(false);
      setStatus('error');
      if (err instanceof Error) {
        setMessage(`Sample video unavailable — try uploading your own. (${err.message})`);
      } else {
        setMessage('Sample video unavailable — try uploading your own.');
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

  const stepsEl = (
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
  );

  return (
    <section className="demo section" id="demo">
      <p className="section-label">Live Demo</p>
      <h2 className="section-title">Try It Out</h2>

      {/* Form mode: single centered card, same as before */}
      {showUploadForm && (
        <div className="demo-card">
          {stepsEl}

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
              disabled={isBusy || fetchingSample}
              maxLength={100}
            />
          </div>

          {/* Resolution selector — options must match SUPPORTED_RESOLUTIONS in @vtaas/db */}
          <div className="demo-field-group">
            <label className="demo-label" htmlFor="resolution">
              Output Resolution
            </label>
            <select
              id="resolution"
              className="demo-select"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              disabled={isBusy || fetchingSample}
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
              isBusy || fetchingSample ? 'disabled' : '',
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
              disabled={isBusy || fetchingSample}
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
            disabled={!file || !submitterName.trim() || isBusy || fetchingSample}
          >
            {isBusy ? 'Processing…' : 'Upload & Transcode'}
          </button>

          {/* Sample video button */}
          {status === 'idle' && !file && (
            <div className="demo-sample-divider">
              <span>or</span>
            </div>
          )}
          {status === 'idle' && !file && (
            <button
              className="demo-sample-btn"
              onClick={handleSampleUpload}
              disabled={fetchingSample}
            >
              {fetchingSample ? 'Loading sample…' : '▶ Try with Sample Video'}
            </button>
          )}

          {/* Status messages (requesting, uploading, creating-job, error) */}
          {message && (
            <div className={`demo-status ${statusVariant}`}>
              {isBusy && <div className="demo-spinner" />}
              {status === 'error' && <span className="demo-status-icon">✕</span>}
              <div className="demo-status-text">{message}</div>
            </div>
          )}
        </div>
      )}

      {/* Panel mode: side-by-side original vs transcoded output */}
      {(isPolling || isTerminal) && (
        <>
          <div className="demo-steps-wide">
            {stepsEl}
          </div>

          <div className="demo-panels">
            {/* Left panel: original video */}
            <div className="demo-panel">
              <div className="demo-panel-header">
                <span className="demo-panel-label">Original</span>
                <span className="demo-panel-meta">{file?.name ?? 'source'}</span>
              </div>
              <div className="demo-video-wrapper">
                {originalUrl && (
                  <video
                    className="demo-video"
                    src={originalUrl}
                    controls
                    muted
                    playsInline
                  />
                )}
              </div>
            </div>

            {/* Right panel: status during transcode → output video when done */}
            <div className="demo-panel">
              <div className="demo-panel-header">
                <span className="demo-panel-label">Transcoded</span>
                {status === 'succeeded' && diagramComplete && (
                  <span className="demo-panel-meta">{resolution}</span>
                )}
              </div>

              {/* Polling or waiting for diagram to advance */}
              {(isPolling || (isTerminal && !diagramComplete)) && (
                <div className="demo-panel-status">
                  <div className="demo-status info">
                    <div className="demo-spinner" />
                    <div className="demo-status-text">
                      {isTerminal
                        ? 'Pipeline complete — click Next on the diagram to see each stage'
                        : message}
                      {jobResponse && !isTerminal && (
                        <>
                          <br />
                          Job ID: <code>{jobResponse.id}</code> · Status: <code>{jobResponse.status}</code>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Succeeded — output video */}
              {status === 'succeeded' && diagramComplete && jobResponse?.downloadUrl && (
                <>
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
                </>
              )}

              {/* Succeeded but no download URL (edge case) */}
              {status === 'succeeded' && diagramComplete && (!jobResponse || !jobResponse.downloadUrl) && (
                <div className="demo-panel-status">
                  <div className="demo-status success">
                    <span className="demo-status-icon">✓</span>
                    <div className="demo-status-text">
                      Transcode complete, but no download URL available.
                    </div>
                  </div>
                  <div className="demo-actions">
                    <button className="demo-reset-btn" onClick={resetAll}>Start Over</button>
                  </div>
                </div>
              )}

              {/* Failed */}
              {status === 'failed' && diagramComplete && (
                <div className="demo-panel-status">
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
                    <button className="demo-reset-btn" onClick={resetAll}>Try Again</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
