import React, { useEffect, useState } from 'react';

export const AuthCallbackView: React.FC = () => {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    if (error) {
      setStatus('error');
      setErrorMessage(error);
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setErrorMessage('Missing OAuth authorization code or state parameter');
      return;
    }

    // Handled by backend callback redirect
    setStatus('success');
  }, []);

  return (
    <div className="auth-callback-container">
      {status === 'loading' && <p>Processing authentication callback...</p>}
      {status === 'success' && <p>Authentication successful! Redirecting to dashboard...</p>}
      {status === 'error' && <p className="error">Authentication failed: {errorMessage}</p>}
    </div>
  );
};
