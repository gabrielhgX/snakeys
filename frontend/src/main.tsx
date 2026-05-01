import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Lobby from './pages/Lobby';
import Login from './pages/Login';
import Game from './pages/Game';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/lobby" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Login initialMode="register" />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/game" element={<Game />} />
        <Route path="*" element={<Navigate to="/lobby" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
