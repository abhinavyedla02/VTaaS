import { useState, useEffect } from 'react';
import UploadForm from './components/UploadForm';

function App() {
  const [loading, setLoading] = useState(true);
  const [healthData, setHealthData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        setHealthData(JSON.stringify(data, null, 2));
        setError(null);
      })
      .catch(err => {
        setError(err.message);
        setHealthData(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
      <h1>VTaaS</h1>

      <div style={{ marginBottom: '2rem', padding: '1rem', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
        <h3>API Health</h3>
        {loading && <p>Loading...</p>}
        {error && <p style={{ color: 'red' }}>Error: {error}</p>}
        {healthData && <pre style={{ margin: 0 }}>{healthData}</pre>}
      </div>

      <UploadForm />
    </div>
  );
}

export default App;
