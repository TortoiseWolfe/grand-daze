import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Verify Email - Grand Daze',
  description: 'Verify your email address for Grand Daze',
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function VerifyEmailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
