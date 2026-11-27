// Vite's development entry. Packaged apps continue to use build.ts and renderer/index.html.
import { PAGE_CSS, UPDATE_CSS } from '../../../../packages/library-page/src/styles.ts';
import './ui.css';
import './app.css';
import './main.tsx';

const styles = document.createElement('style');
styles.textContent = `${PAGE_CSS}\n${UPDATE_CSS}`;
document.head.append(styles);
