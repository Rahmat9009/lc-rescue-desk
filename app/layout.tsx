import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'LC Rescue Desk',description:'Investigate discrepancies. Coordinate corrections. Verify the next document version.',icons:{icon:'/favicon.svg'}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
