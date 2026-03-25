import { useState, useCallback } from 'react';
import './DemoWidget.css';

type DemoStatus = 'idle' | 'requesting' | 'uploading' | 'creating-job' | 'done' | 'error';

interface JobResult {
  id: string;
  status: string;
}

function getActiveStep(status: DemoStatus): number {
  switch (status) {
    case 'idle': return 1;
    case 'requesting': return 2;
    case 'uploading': return 2;
    case 'creating-job': return 3;
    case 'done': return 4;
    case 'error': return 0;
  }
}

function isStepCompleted(step: number, status: DemoStatus): boolean {
  const active = getActiveStep(status);
  if (status === 'error') return false;
  return step < active;
}

const ACCEPTED_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

function validateFile(f: File): string | null {
  if (!ACCEPTED_TYPES.has(f.type)) {
    return 'Unsupported file type. Please use MP4, MOV, or WebM.';
  }
  if (f.size > MAX_FILE_SIZE) {
    return `File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max is 20 MB.`;
  }
  return null;
}

export default function DemoWidget() {
  const [submitterName, setSubmitterName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<DemoStatus>('idle');
  const [message, setMessage] = useState('');
  const [jobResult, setJobResult] = useState<JobResult | null>(null);
  const [dragging, setDragging] = useState(false);

  const isBusy = status === 'requesting' || status === 'uploading' || status === 'creating-job';

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
    setJobResult(null);
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

      // Replace internal docker hostname with localhost for local dev
      const uploadUrl = url.replace('http://localstack:4566', 'http://localhost:4566');

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
        body: JSON.stringify({ inputKey, submitterName: submitterName.trim() }),
      });

      if (!jobRes.ok) {
        const errorData: { message?: string } = await jobRes.json();
        throw new Error(errorData.message ?? `Job creation failed (${jobRes.status})`);
      }

      const job: { id: string; status: string } = await jobRes.json();

      setJobResult({ id: job.id, status: job.status });
      setStatus('done');
      setMessage('Job created — transcoding will begin shortly.');
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

  const statusVariant: 'info' | 'success' | 'error' =
    status === 'error' ? 'error' : status === 'done' ? 'success' : 'info';

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
            const className = [
              'demo-step',
              active ? 'active' : '',
              completed ? 'completed' : '',
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

        {/* Status message */}
        {message && (
          <div className={`demo-status ${statusVariant}`}>
            {isBusy && <div className="demo-spinner" />}
            {status === 'done' && <span className="demo-status-icon">✓</span>}
            {status === 'error' && <span className="demo-status-icon">✕</span>}
            <div className="demo-status-text">
              {message}
              {jobResult && (
                <>
                  <br />
                  Job ID: <code>{jobResult.id}</code> · Status: <code>{jobResult.status}</code>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
