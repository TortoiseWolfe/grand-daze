import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Forgot Password - Grand Daze',
  description: 'Reset your Grand Daze account password',
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
