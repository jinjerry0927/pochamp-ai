import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('앱 root 요소를 찾지 못했습니다.');

createRoot(root).render(window.pochamp
  ? <StrictMode><App /></StrictMode>
  : <main className="fatal"><h1>앱 연결을 시작하지 못했습니다.</h1><p>포챔 AI를 완전히 종료한 뒤 다시 실행하세요. 문제가 계속되면 새 버전으로 업데이트하세요.</p></main>);

