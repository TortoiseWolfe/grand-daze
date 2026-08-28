import React from 'react';
import Image from 'next/image';

export interface GrandDazeLogoProps {
  className?: string;
  width?: number;
  height?: number;
}

export const GrandDazeLogo: React.FC<GrandDazeLogoProps> = ({
  className = 'w-full h-full',
  width = 400,
  height = 400,
}) => {
  return (
    <Image
      src="/grand-daze-logo.svg"
      alt="Grand Daze Logo"
      width={width}
      height={height}
      className={className}
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      priority
    />
  );
};

GrandDazeLogo.displayName = 'GrandDazeLogo';
