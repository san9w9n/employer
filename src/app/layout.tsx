import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '오늘근무 · 우리 매장의 하루', description: '함께 일하는 하루, 간편한 출퇴근과 꼼꼼한 급여 관리', icons: { apple: '/icon-192.png' }, appleWebApp: { capable: true, statusBarStyle: 'default', title: '오늘근무' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', interactiveWidget: 'resizes-content', themeColor: '#204b3c' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ko"><body>{children}</body></html>; }
