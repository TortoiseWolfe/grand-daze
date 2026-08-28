import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In - Grand Daze',
  description: 'Sign in to your Grand Daze account',
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function SignInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
