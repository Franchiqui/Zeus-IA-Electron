import { Audiowide } from 'next/font/google';

/** Fuente Audiowide de Google Fonts — sirve para el logo "Zeus IA" en el navbar.
 *  next/font la descarga en build time y la sirve localmente (funciona en empaquetado). */
export const audiowide = Audiowide({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-audiowide',
});