import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reset Password - Grand Daze',
  description: 'Set a new password for your Grand Daze account',
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function ResetPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
