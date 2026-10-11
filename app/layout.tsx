import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'LC Rescue Desk',description:'Investigate discrepancies. Coordinate corrections. Verify the next document version.',icons:{icon:'/logo-mark.png'}};
const fonts='https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap';
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><head><link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin=""/><link rel="stylesheet" href={fonts}/></head><body>{children}</body></html>;}
