import { useState } from 'react';

export default function UploadForm() {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<'idle' | 'requesting' | 'uploading' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFile(e.target.files[0]);
            setStatus('idle');
            setMessage('');
        }
    };

    const handleUpload = async () => {
        if (!file) return;

        try {
            setStatus('requesting');
            setMessage('Getting presigned URL...');

            const response = await fetch('/api/uploads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mimeType: file.type, sizeBytes: file.size }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to get upload URL');
            }

            const { url } = await response.json();

            setStatus('uploading');
            setMessage('Uploading directly to S3...');

            // CRITICAL FIX: Replace internal docker hostname with localhost for the browser
            const uploadUrl = url.replace('http://localstack:4566', 'http://localhost:4566');

            const uploadResponse = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': file.type,
                },
                body: file,
            });

            if (!uploadResponse.ok) {
                throw new Error(`Upload failed with status ${uploadResponse.status}`);
            }

            setStatus('success');
            setMessage('Upload successful!');
            setFile(null);
        } catch (err: any) {
            setStatus('error');
            setMessage(err.message || 'An unexpected error occurred');
        }
    };

    return (
        <div className="upload-container" style={{ border: '1px solid #ccc', padding: '1rem', marginTop: '1rem', borderRadius: '4px' }}>
            <h2>Upload Video</h2>
            <div style={{ marginBottom: '1rem' }}>
                <input
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm"
                    onChange={handleFileChange}
                    disabled={status === 'requesting' || status === 'uploading'}
                />
            </div>

            <button
                onClick={handleUpload}
                disabled={!file || status === 'requesting' || status === 'uploading'}
                style={{ padding: '0.5rem 1rem', cursor: (!file || status === 'requesting' || status === 'uploading') ? 'not-allowed' : 'pointer' }}
            >
                {status === 'requesting' ? 'Requesting URL...' :
                    status === 'uploading' ? 'Uploading...' : 'Upload'}
            </button>

            {message && (
                <div style={{
                    marginTop: '1rem', padding: '0.5rem',
                    backgroundColor: status === 'error' ? '#fee' : status === 'success' ? '#efe' : '#eef',
                    color: status === 'error' ? 'red' : status === 'success' ? 'green' : 'blue',
                    border: '1px solid currentColor', borderRadius: '4px'
                }}>
                    {message}
                </div>
            )}
        </div>
    );
}
