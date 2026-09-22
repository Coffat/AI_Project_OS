import React from 'react';

export interface LoginButtonProps {
  provider: 'github' | 'google';
  onLoginClick?: () => void;
}

export const LoginButton: React.FC<LoginButtonProps> = ({ provider, onLoginClick }) => {
  const handleClick = () => {
    if (onLoginClick) {
      onLoginClick();
    } else {
      window.location.href = `/api/auth/login?provider=${provider}`;
    }
  };

  return (
    <button
      className={`login-btn login-btn-${provider}`}
      onClick={handleClick}
      type="button"
    >
      Sign in with {provider.toUpperCase()}
    </button>
  );
};
