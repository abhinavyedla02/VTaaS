import { useState, useEffect } from 'react';

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
    <div>
      <h1>VTaaS</h1>
      {loading && <p>Loading...</p>}
      {error && <p>Error: {error}</p>}
      {healthData && <pre>{healthData}</pre>}
    </div>
  );
}

export default App;
